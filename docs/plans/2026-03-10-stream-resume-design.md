# 流式任务断线恢复设计方案

## 背景

当前实现中，当客户端从前台切换到后台时，SSE 连接会断开。服务器检测到连接断开后会立即终止 Claude 进程，导致任务丢失。

## 目标

1. 连接断开后，AI 请求继续在服务器端运行
2. 流式输出实时保存到 Session
3. 客户端重连后可恢复接收（Poll + SSE 混合方案）

## 设计方案

### 核心架构变更

```
当前：
客户端断开 → res.on('close') → child.kill('SIGTERM') → 任务丢失

目标：
客户端断开 → res.on('close') → 标记连接断开 → 任务继续运行
                                              ↓
                                       实时保存到 Session
                                              ↓
                               客户端通过 Session ID 恢复
```

### 数据存储变更

#### Session 消息结构增强

```javascript
{
  role: 'assistant',
  content: '已累积的内容（实时更新）',
  status: 'streaming' | 'completed',  // 新增：消息状态
  metadata: {
    stream_id: 'uuid',           // 新增：流式任务标识
    started_at: 'timestamp',
    completed_at: 'timestamp',
    cost_usd: 0,
    model: 'string'
  }
}
```

### 核心流程

#### 1. 流式请求处理

```
客户端 POST /api/sessions/:id/continue/stream
           ↓
    创建 stream_id，写入 Session（status: 'streaming'）
           ↓
    启动 Claude 进程，开始流式输出
           ↓
    每个 chunk → 实时更新 Session 消息内容
           ↓
    客户端断开？不再杀进程，继续更新 Session
           ↓
    进程完成 → 更新消息 status: 'completed'
```

#### 2. 客户端重连

```
客户端恢复到前台
           ↓
    GET /api/sessions/:id/messages
           ↓
    返回所有消息（包括 status: 'streaming' 的消息）
           ↓
    有 streaming 状态的消息？
    - 有：建立 SSE 连接继续接收
    - 无：任务已完成，直接显示结果
```

### API 接口设计

#### 现有接口变更

**POST /api/sessions/:id/continue/stream**
- 响应头新增 `X-Stream-Id: <uuid>` 供客户端保存

**GET /api/sessions/:id/messages**
- 响应增加消息的 `status` 字段

#### 新增接口

**GET /api/sessions/:id/stream/resume**
```javascript
// 请求参数
?stream_id=<uuid>

// 响应 - SSE 流
event: message
data: {"type": "content", "text": "已累积的内容...", "is_resumed": true}

event: message
data: {"type": "content", "text": "新内容..."}

event: done
data: {"session_id": "xxx", "duration_ms": 5000, "cost_usd": 0.01}
```

**GET /api/sessions/:id/stream/status**（可选）
```javascript
// 快速查询流式任务状态
{
  "stream_id": "uuid",
  "status": "streaming" | "completed",
  "has_content": true,
  "content_length": 1234
}
```

### 文件变更清单

#### 需要修改的文件

| 文件 | 变更内容 |
|------|---------|
| `src/services/claudeStreamExecutor.js` | 移除断开杀进程逻辑，改为持续更新 Session |
| `src/services/sessionManager.js` | 新增流式消息的增量和状态更新方法 |
| `src/storage/messageStore.js` | 支持消息 status 字段和增量更新 |
| `src/routes/sessions.js` | 新增 `/stream/resume` 端点，修改 messages 响应 |

#### 新增文件

| 文件 | 内容 |
|------|------|
| `src/services/streamManager.js` | 管理活跃流式任务，支持重连和事件分发 |

### StreamManager 核心设计

```javascript
class StreamManager {
  // 跟踪活跃的流式任务
  activeStreams: Map<stream_id, {
    session_id,
    childProcess,
    clients: Response[],  // 支持多客户端同时监听
    content: string       // 已累积内容
  }>

  // 方法
  registerStream(sessionId, childProcess) → streamId
  addClient(streamId, response)           // 添加 SSE 客户端
  removeClient(streamId, response)        // 移除断开的客户端
  updateContent(streamId, chunk)          // 更新内容并广播
  completeStream(streamId, metadata)      // 完成并清理
  resumeStream(streamId, response)        // 重连恢复
}
```

## 实现优先级

1. **P0 - 核心功能**
   - StreamManager 服务
   - 修改 claudeStreamExecutor 断开逻辑
   - 消息实时存储到 Session

2. **P1 - 恢复能力**
   - `/stream/resume` 端点
   - `/stream/status` 端点

3. **P2 - 增强**
   - 多客户端同时监听
   - 流式任务超时清理
