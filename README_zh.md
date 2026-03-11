# Claude Code Server

> 为 Claude CLI 提供企业级 HTTP API 封装，支持会话管理、异步任务、统计监控等完整功能

[![npm version](https://img.shields.io/npm/v/@csdwd/ccs.svg)](https://www.npmjs.com/package/@csdwd/ccs)
[![Node.js](https://img.shields.io/node/v/@csdwd/ccs.svg)](https://nodejs.org/)
[![License](https://img.shields.io/npm/l/@csdwd/ccs.svg)](LICENSE)

简体中文 | [**English**](README.md)

---

Claude Code Server 是一个功能完整的 HTTP API 服务，将 Anthropic Claude CLI 封装为易用的 RESTful API。支持多轮对话、异步任务队列、统计分析、Webhook 回调等企业级功能，并配有直观的 TUI 管理工具。

## ✨ 特性

### 核心功能
- 🚀 **HTTP API** - 简洁的 RESTful API 接口
- 💬 **会话管理** - 自动创建和管理多轮对话上下文
- ⚡ **异步任务** - 基于优先级的任务队列系统
- 📊 **统计分析** - 实时统计请求、成本和资源使用
- 🔔 **Webhook 回调** - 异步任务完成自动通知
- 🌊 **流式输出** - 基于 SSE 的实时 Claude 响应流

### 高级功能
- 🎯 **任务优先级** - 支持 1-10 级优先级调度
- 🔄 **批量处理** - 一次处理最多 10 个请求
- 🚦 **速率限制** - 可配置的 API 访问频率控制
- 📝 **MCP 支持** - Model Context Protocol 配置支持
- 💾 **文件存储** - 基于持久化 JSON 文件存储会话、任务和统计数据
- ⚙ **配置热重载** - 无需重启更新配置
- 🖥️ **TUI 管理工具** - 可视化服务器管理和监控
- 🛑 **任务取消** - 实时取消运行中的任务
- 💾 **消息存储** - 存储和检索对话消息
- ⚖️ **负载均衡** - 多 API Key 支持，会话绑定，轮询/权重策略，自动故障转移

## 🚀 快速开始

### 使用 npx（推荐）

最简单的使用方式 - 无需安装：

```bash
# 直接使用 npx 运行
npx @csdwd/ccs
```

这将启动 TUI 管理工具，你可以：
- 启动/停止服务器
- 配置设置
- 查看日志和统计
- 管理会话和任务

### 全局安装

```bash
# 全局安装
npm install -g @csdwd/ccs

# 然后可以在任意位置运行启动 TUI 管理工具
ccs

# 直接命令
ccs start      # 启动服务器
ccs stop       # 停止服务器
ccs status     # 查看服务器状态
```

### CLI 命令

| 命令 | 说明 |
|------|------|
| `npx @csdwd/ccs` | 启动 TUI 管理工具（交互式） |
| `npx @csdwd/ccs start` | 启动服务器 |
| `npx @csdwd/ccs stop` | 停止服务器 |
| `npx @csdwd/ccs status` | 查看服务器状态 |

## 🛠️ 运行项目

### 前置要求

- **Node.js** >= 18.0.0
- **npm** 或 **yarn**
- **Claude CLI** - 已安装并配置

### 本地开发

```bash
# 克隆项目
git clone https://github.com/csdwd/claude-code-server.git
cd claude-code-server

# 安装依赖
npm install

# 运行 TUI
node cli.js

# 或使用直接命令
node cli.js start    # 启动服务器
node cli.js stop     # 停止服务器
node cli.js status   # 查看服务器状态
```

## ⚙️ 配置

配置文件位于 `~/.claude-code-server/config.json`（首次启动自动生成）：

```json
{
  "port": 5546,
  "host": "0.0.0.0",
  "claudePath": "claude",
  "nodeBinDir": null,
  "defaultProjectPath": "~/workspace",
  "logFile": "~/.claude-code-server/logs/server.log",
  "pidFile": "~/.claude-code-server/server.pid",
  "dataDir": "~/.claude-code-server/data",
  "taskQueue": {
    "concurrency": 3,
    "defaultTimeout": 300000
  },
  "webhook": {
    "enabled": false,
    "defaultUrl": null,
    "timeout": 5000,
    "retries": 3
  },
  "statistics": {
    "enabled": true,
    "collectionInterval": 60000
  },
  "rateLimit": {
    "enabled": true,
    "windowMs": 60000,
    "maxRequests": 100
  }
}
```

**注意：**
- `claudePath` 默认为 `claude`，表示使用系统 PATH 中的 Claude CLI
- `nodeBinDir` 为可选配置，仅在需要指定特定 Node.js 版本时设置
- 如果通过 NVM 安装 Node.js，配置示例：
  ```json
  "claudePath": "claude",
  "nodeBinDir": "~/.nvm/versions/node/v22.21.0/bin"
  ```
- 如果使用系统默认 Node.js，保持 `nodeBinDir` 为 `null` 即可

### 验证安装

```bash
# 健康检查
curl http://localhost:5546/health

# 测试 API（同步）
curl -X POST http://localhost:5546/api/messages \
  -H "Content-Type: application/json" \
  -d '{"prompt": "解释一下什么是 HTTP"}'
```

## 📚 API 文档

### 交互式 API 文档

服务器包含由 Swagger UI 提供支持的交互式 API 文档。访问地址：

**http://localhost:5546/api-docs**

功能：
- 📖 浏览所有可用的 API 端点
- 🧪 直接在浏览器中测试 API
- 📝 查看详细的请求/响应模式
- 🔍 搜索和过滤端点
- 📄 下载 OpenAPI 规范：http://localhost:5546/api-docs.json

### 快速示例

```bash
curl -X POST http://localhost:5546/api/messages \
  -H "Content-Type: application/json" \
  -d '{"prompt": "解释一下什么是 HTTP"}'
```

**响应：**
```json
{
  "success": true,
  "result": "HTTP 是超文本传输协议...",
  "duration_ms": 1953,
  "cost_usd": 0.0975,
  "session_id": "auto-created-or-provided"
}
```

完整的 API 参考文档（包括所有端点、参数和响应代码），请访问位于 **http://localhost:5546/api-docs** 的**交互式 Swagger UI**。

### 流式 API (SSE)

使用 Server-Sent Events 获取实时流式响应：

```bash
curl -X POST http://localhost:5546/api/sessions/{session_id}/continue/stream \
  -H "Content-Type: application/json" \
  -d '{"prompt": "写一首关于编程的短诗"}'
```

**SSE 事件类型：**
- `event: message` - 实时 Claude 输出片段（JSON 格式）
- `event: done` - 执行完成，包含成本和耗时
- `event: error` - 执行过程中发生错误

**JavaScript 示例：**
```javascript
const eventSource = new EventSource('/api/sessions/my-session/continue/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: '你好！' })
});

eventSource.addEventListener('message', (e) => {
  console.log('输出片段:', JSON.parse(e.data));
});

eventSource.addEventListener('done', (e) => {
  console.log('完成:', JSON.parse(e.data));
  eventSource.close();
});

eventSource.addEventListener('error', (e) => {
  console.error('错误:', e.data);
  eventSource.close();
});
```

**流式参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `prompt` | string | 用户提示（必填） |
| `system_prompt` | string | 系统提示覆盖 |
| `max_budget_usd` | number | 本次请求最大预算 |
| `allowed_tools` | string[] | 允许的工具白名单 |
| `disallowed_tools` | string[] | 禁用的工具黑名单 |

## ⚖️ 负载均衡

Claude Code Server 支持多 Provider 负载均衡与会话绑定，可以将请求分发到多个 Anthropic API Key 或第三方兼容端点。

### 配置方法

在 `~/.claude-code-server/config.json` 中添加 `providers` 和 `loadBalance` 配置：

```json
{
  "providers": [
    {
      "id": "main",
      "name": "主 API Key",
      "apiKey": "sk-ant-api03-xxx",
      "baseUrl": "https://api.anthropic.com",
      "weight": 3,
      "enabled": true
    },
    {
      "id": "zhipu",
      "name": "智谱 GLM",
      "apiKey": "your-zhipu-api-key",
      "baseUrl": "https://open.bigmodel.cn/api/anthropic",
      "env": {
        "ANTHROPIC_API_KEY": "",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": "glm-5",
        "ANTHROPIC_DEFAULT_OPUS_MODEL": "glm-5",
        "ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-5",
        "ANTHROPIC_MODEL": "glm-5",
        "ANTHROPIC_REASONING_MODEL": "glm-5",
        "API_TIMEOUT_MS": "3000000",
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
        "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
      },
      "weight": 1,
      "enabled": true
    }
  ],
  "loadBalance": {
    "strategy": "weighted",
    "failover": true,
    "failureThreshold": 3,
    "recoveryTimeout": 60
  }
}
```

### 配置项说明

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `providers[].id` | string | 必填 | Provider 唯一标识 |
| `providers[].name` | string | 必填 | 显示名称 |
| `providers[].apiKey` | string | 必填 | Anthropic API Key（注入为 `ANTHROPIC_API_KEY`） |
| `providers[].baseUrl` | string | 可选 | API 端点 URL（注入为 `ANTHROPIC_BASE_URL`） |
| `providers[].env` | object | 可选 | 额外的环境变量配置 |
| `providers[].weight` | number | 1 | 权重策略的权重值（1-10） |
| `providers[].enabled` | boolean | true | 是否启用 |
| `loadBalance.strategy` | string | "round-robin" | 策略："round-robin"（轮询）或 "weighted"（权重） |
| `loadBalance.failover` | boolean | false | 是否启用自动故障转移 |
| `loadBalance.failureThreshold` | number | 3 | 连续失败多少次标记为不健康 |
| `loadBalance.recoveryTimeout` | number | 60 | 不健康后多少秒尝试恢复 |

### 环境变量配置

`providers[].env` 对象允许在为该 Provider 启动 Claude CLI 时注入额外的环境变量。常见用途：

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_API_KEY` | 备用认证令牌 |
| `ANTHROPIC_MODEL` | 默认模型覆盖 |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | 默认 Sonnet 模型 |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | 默认 Haiku 模型 |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | 默认 Opus 模型 |
| `ANTHROPIC_REASONING_MODEL` | 推理模型覆盖 |
| `API_TIMEOUT_MS` | API 超时时间（毫秒） |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | 禁用非必要的网络流量 |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | 启用实验性 Agent Teams |

### 功能特性

**会话绑定**：相同的 `session_id` 始终路由到同一个 Provider，确保对话连续性。

**策略模式**：
- **轮询（Round-Robin）**：均匀分配请求到所有启用的 Provider
- **权重（Weighted）**：按权重比例分配请求（如权重 3:1 = 75%:25%）

**自动故障转移**：启用后，当绑定的 Provider 变为不健康状态时，自动切换会话到健康的 Provider。

### 管理 API

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/load-balance/status` | GET | 查看所有 Provider 健康状态、请求数、绑定数 |
| `/api/load-balance/bindings` | GET | 查看当前会话-Provider 绑定关系 |
| `/api/load-balance/providers/:id/reset` | POST | 重置 Provider 健康状态 |
| `/api/load-balance/providers/:id/enable` | POST | 启用 Provider |
| `/api/load-balance/providers/:id/disable` | POST | 禁用 Provider |

**示例 - 查看状态：**
```bash
curl http://localhost:5546/api/load-balance/status
```

**响应示例：**
```json
{
  "success": true,
  "strategy": "weighted",
  "failover": true,
  "providers": [
    {
      "id": "main",
      "name": "主 API Key",
      "weight": 3,
      "enabled": true,
      "healthy": true,
      "consecutiveFailures": 0,
      "totalRequests": 42,
      "boundSessions": 5
    },
    {
      "id": "backup",
      "name": "备用 API Key",
      "weight": 1,
      "enabled": true,
      "healthy": false,
      "consecutiveFailures": 3,
      "totalRequests": 8,
      "boundSessions": 1
    }
  ]
}
```

**示例 - 重置不健康的 Provider：**
```bash
curl -X POST http://localhost:5546/api/load-balance/providers/backup/reset
```

### 向后兼容

当未配置 `providers` 时，系统行为与之前完全一致，使用默认的 Claude CLI 配置。

## 🖥️ TUI 管理工具

Claude Code Server 配有功能完整的 TUI 管理工具：

### 主菜单功能

- **▶ 启动服务** - 启动后台服务器进程
- **■ 停止服务** - 优雅关闭服务器
- **● 查看状态** - 显示运行状态和端口
- **💬 会话管理** - 列出/查看/删除会话
- **📊 查看统计** - 查看使用统计摘要
- **📋 任务列表** - 查看任务、调整优先级
- **📋 查看日志** - 格式化日志显示、搜索
- **📖 查看接口文档** - 在浏览器中打开交互式 Swagger UI
- **📝 配置设置** - 可视化配置编辑器，分类管理所有选项
- **🧪 测试 API** - 快速测试 API 接口

### 可视化配置编辑器

TUI 包含一个可视化配置编辑器，将所有设置按类别组织：

**📦 基本配置**
- 服务端口、监听地址
- Claude CLI 路径（默认使用系统 PATH）
- Node.js bin 目录（可选，仅在需要指定 Node.js 版本时配置）
- 默认项目路径
- 会话保留天数
- 日志级别、最大预算

**🔄 Webhook 配置**
- 启用/禁用 Webhook
- 默认 Webhook URL
- 超时和重试设置

**📋 任务队列配置**
- 队列并发数（1-10）
- 任务超时设置

**⚡ 速率限制配置**
- 启用/禁用速率限制
- 时间窗口和最大请求数

**📊 统计配置**
- 启用/禁用统计收集
- 收集间隔

**🔐 安全配置**
- **启用 API 认证** - 为所有接口启用 API Key 认证
- **健康检查绕过认证** - 允许健康检查接口无需认证（推荐：启用）
- **跳过权限检查** - 调用 Claude CLI 时添加 `--dangerously-skip-permissions` 标志（⚠️ 安全风险，生产环境建议关闭）

### 启动 TUI

```bash
# 使用 npx（推荐）
npx @csdwd/ccs

# 或本地开发
node cli.js
```

## ⚙️ 配置说明

### 完整配置选项

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `port` | number | 5546 | 服务端口 |
| `host` | string | "0.0.0.0" | 监听地址 |
| `claudePath` | string | "claude" | Claude CLI 可执行文件路径 |
| `nodeBinDir` | string | null | Node.js bin 目录（可选） |
| `defaultProjectPath` | string | - | 默认项目路径 |
| `logFile` | string | "~/.claude-code-server/logs/server.log" | 日志文件路径 |
| `pidFile` | string | "~/.claude-code-server/server.pid" | PID 文件路径 |
| `dataDir` | string | "~/.claude-code-server/data" | 数据存储目录 |
| `sessionRetentionDays` | number | 30 | 会话保留天数 |
| `taskQueue.concurrency` | number | 3 | 任务队列并发数 |
| `taskQueue.defaultTimeout` | number | 300000 | 任务超时时间（毫秒） |
| `webhook.enabled` | boolean | false | 是否启用 Webhook |
| `webhook.defaultUrl` | string | null | 默认 Webhook URL |
| `webhook.timeout` | number | 5000 | Webhook 超时（毫秒） |
| `webhook.retries` | number | 3 | Webhook 重试次数 |
| `rateLimit.enabled` | boolean | true | 是否启用速率限制 |
| `rateLimit.windowMs` | number | 60000 | 时间窗口（毫秒） |
| `rateLimit.maxRequests` | number | 100 | 最大请求数 |
| `defaultModel` | string | "claude-sonnet-4-5" | 默认模型 |
| `maxBudgetUsd` | number | 10.0 | 最大预算（美元） |
| `statistics.enabled` | boolean | true | 是否启用统计 |
| `statistics.collectionInterval` | number | 60000 | 统计收集间隔（毫秒） |
| `mcp.enabled` | boolean | false | 是否启用 MCP |
| `mcp.configPath` | string | null | MCP 配置文件路径 |
| `logLevel` | string | "info" | 日志级别 |
| `security.auth.enabled` | boolean | false | 启用 API 认证 |
| `security.auth.secretKey` | string | null | API 认证密钥 |
| `security.auth.bypassHealthCheck` | boolean | true | 健康检查是否绕过认证 |
| `allowDangerouslySkipPermissions` | boolean | false | 跳过 CLI 权限检查（⚠️ 安全风险） |

### 配置文件位置

配置文件自动保存在：`~/.claude-code-server/config.json`

## 🚀 生产部署

### 使用 PM2

```bash
# 安装 PM2
npm install -g pm2

# 启动服务
pm2 start server.js --name claude-code-server

# 设置开机自启
pm2 startup
pm2 save

# 查看日志
pm2 logs claude-code-server

# 重启服务
pm2 restart claude-code-server
```

### Systemd 服务

创建 `/etc/systemd/system/claude-code-server.service`：

```ini
[Unit]
Description=Claude Code Server
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/claude-api-server
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable claude-code-server
sudo systemctl start claude-code-server
```

## 🔧 故障排查

### 服务无法启动

```bash
# 检查端口占用
lsof -i :5546

# 检查日志
tail -f ~/.claude-code-server/logs/server.log

# 检查配置
cat ~/.claude-code-server/config.json
```

### 任务一直处于 pending 状态

```bash
# 检查队列状态
curl http://localhost:5546/api/tasks/queue/status

# 检查配置的并发数
cat ~/.claude-code-server/config.json | grep concurrency
```

### 日志重复输出

确认服务器已重启并加载新代码：

```bash
# 强制终止所有 node 进程
pkill -9 node

# 重新启动
node cli.js
```

## 📂 项目结构

```
claude-code-server/
├── server.js                 # 主服务器入口
├── cli.js                    # TUI 管理工具
├── package.json
├── src/
│   ├── routes/              # API 路由
│   │   ├── health.js
│   │   ├── config.js
│   │   ├── claude.js        # 同步/异步消息路由
│   │   ├── sessions.js      # 会话管理 & 流式输出
│   │   ├── statistics.js    # 统计查询
│   │   └── tasks.js         # 任务管理
│   ├── services/
│   │   ├── claudeExecutor.js    # Claude 执行器
│   │   ├── claudeStreamExecutor.js  # 流式执行器
│   │   ├── sessionManager.js    # 会话管理
│   │   ├── taskQueue.js         # 任务队列
│   │   ├── rateLimiter.js       # 速率限制
│   │   ├── statisticsCollector.js  # 统计收集
│   │   └── webhookNotifier.js   # Webhook 通知
│   ├── storage/
│   │   ├── sessionStore.js       # 会话存储
│   │   ├── taskStore.js          # 任务存储
│   │   ├── statsStore.js         # 统计存储
│   │   └── messageStore.js       # 消息存储
│   └── utils/
│       ├── logger.js
│       └── validators.js
└── README_zh.md
```

**数据和配置文件位置：**

所有配置和数据文件都存储在 `~/.claude-code-server/` 目录下：
- `config.json` - 配置文件
- `logs/` - 日志文件目录
- `server.pid` - 进程 ID 文件
- `data/` - 数据存储（会话、任务、统计）

## 🔒 安全建议

1. **API 认证** - 在反向代理层添加 API 密钥或 OAuth 认证
2. **CORS 配置** - 根据需要配置跨域资源共享
3. **速率限制** - 已内置速率限制，可根据需求调整
4. **输入验证** - 所有请求都经过 Joi 验证
5. **预算控制** - 使用 `maxBudgetUsd` 防止意外超支

## 📊 性能指标

- **并发任务**：可配置 1-10 个并发任务
- **请求速率**：默认 100 请求/分钟
- **任务超时**：默认 5 分钟，可配置
- **会话保留**：默认 30 天自动清理

## 📄 许可证

MIT

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📮 联系方式

如有问题或建议，请提交 GitHub Issue。
