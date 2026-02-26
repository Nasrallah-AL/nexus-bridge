# Claude Code Server

> 为 Claude CLI 提供企业级 HTTP API 封装，支持会话管理、异步任务、统计监控等完整功能

[![Node.js](https://img.shields.io/node/v/claude-code-server.svg)](https://nodejs.org/)
[![License](https://img.shields.io/npm/l/claude-code-server.svg)](LICENSE)

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

### 高级功能
- 🎯 **任务优先级** - 支持 1-10 级优先级调度
- 🔄 **批量处理** - 一次处理最多 10 个请求
- 🚦 **速率限制** - 可配置的 API 访问频率控制
- 📝 **MCP 支持** - Model Context Protocol 配置支持
- 💾 **文件存储** - 基于持久化 JSON 文件存储会话、任务和统计数据
- ⚙ **配置热重载** - 无需重启更新配置
- 🖥️ **TUI 管理工具** - 可视化服务器管理和监控

## 📦 安装

### 前置要求

- **Node.js** >= 18.0.0
- **npm** 或 **yarn**
- **Claude CLI** - 已安装并配置

### 安装步骤

```bash
# 克隆或下载项目
cd claude-code-server

# 安装依赖
npm install

# 或使用 yarn
yarn install
```

## 🚀 快速开始

### 1. 配置

配置文件位于 `~/.claude-code-server/config.json`（首次启动自动生成）：

```json
{
  "port": 5546,
  "host": "0.0.0.0",
  "claudePath": "~/.nvm/versions/node/v22.21.0/bin/claude",
  "nvmBin": "~/.nvm/versions/node/v22.21.0/bin",
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

### 2. 启动服务

**方式一：使用 TUI（推荐）**

```bash
npm run cli
# 或
node cli.js
```

**方式二：命令行**

```bash
node cli.js start   # 启动服务
node cli.js stop    # 停止服务
node cli.js status  # 查看状态
```

### 3. 验证安装

```bash
# 健康检查
curl http://localhost:5546/health

# 测试 API（同步）
curl -X POST http://localhost:5546/api/messages \
  -H "Content-Type: application/json" \
  -d '{"prompt": "解释一下什么是 HTTP"}'

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
- **📖 查看接口文档** - 显示 API 文档
- **⚙ 配置设置** - 修改配置（支持热重载）
- **🧪 测试 API** - 快速测试 API 接口

### 启动 TUI

```bash
node cli.js
```

## ⚙️ 配置说明

### 完整配置选项

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `port` | number | 5546 | 服务端口 |
| `host` | string | "0.0.0.0" | 监听地址 |
| `claudePath` | string | - | Claude CLI 可执行文件路径 |
| `nvmBin` | string | - | NVM bin 目录路径 |
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
│   │   ├── claude.js
│   │   ├── sessions.js      # 会话管理
│   │   ├── statistics.js    # 统计查询
│   │   └── tasks.js         # 任务管理
│   ├── services/
│   │   ├── claudeExecutor.js    # Claude 执行器
│   │   ├── sessionManager.js    # 会话管理
│   │   ├── taskQueue.js         # 任务队列
│   │   ├── rateLimiter.js       # 速率限制
│   │   ├── statisticsCollector.js  # 统计收集
│   │   └── webhookNotifier.js   # Webhook 通知
│   ├── storage/
│   │   ├── sessionStore.js       # 会话存储
│   │   ├── taskStore.js          # 任务存储
│   │   └── statsStore.js         # 统计存储
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
