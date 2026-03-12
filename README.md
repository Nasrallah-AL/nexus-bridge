# Claude Code Server

> Enterprise-grade HTTP API wrapper for Claude CLI with complete features including session management, async tasks, statistics monitoring, and more

[![npm version](https://img.shields.io/npm/v/@csdwd/ccs.svg)](https://www.npmjs.com/package/@csdwd/ccs)
[![Node.js](https://img.shields.io/node/v/@csdwd/ccs.svg)](https://nodejs.org/)
[![License](https://img.shields.io/npm/l/@csdwd/ccs.svg)](LICENSE)

[**简体中文**](README_zh.md) | English

---

Claude Code Server is a full-featured HTTP API service that wraps the Anthropic Claude CLI as an easy-to-use RESTful API. It supports enterprise-level features such as multi-turn conversations, async task queues, statistics and analytics, Webhook callbacks, and comes with an intuitive TUI management tool.

## ✨ Features

### Core Features
- 🚀 **HTTP API** - Clean RESTful API interface
- 💬 **Session Management** - Automatically create and manage multi-turn conversation contexts
- ⚡ **Async Tasks** - Priority-based task queue system
- 📊 **Statistics & Analytics** - Real-time tracking of requests, costs, and resource usage
- 🔔 **Webhook Callbacks** - Automatic notifications when async tasks complete
- 🌊 **Streaming Output** - Real-time SSE streaming for Claude responses

### Advanced Features
- 🎯 **Task Priority** - Support for priority levels 1-10 scheduling
- 🔄 **Batch Processing** - Process up to 10 requests at once
- 🚦 **Rate Limiting** - Configurable API access frequency control
- 📝 **MCP Support** - Model Context Protocol configuration support
- 💾 **File-based Storage** - Persistent JSON file storage for sessions, tasks, and statistics
- ⚙ **Hot Config Reload** - Update configuration without server restart
- 🖥️ **TUI Management Tool** - Visual server management and monitoring
- 🛑 **Task Cancellation** - Cancel running tasks in real-time
- 💾 **Message Storage** - Store and retrieve conversation messages
- ⚖️ **Load Balancing** - Multi-provider support with session affinity, round-robin/weighted strategies, and automatic failover

## 🚀 Quick Start

### Using npx (Recommended)

The fastest way to use Claude Code Server - no installation required:

```bash
# Run directly with npx
npx @csdwd/ccs
```

This will launch the TUI management tool where you can:
- Start/stop the server
- Configure settings
- View logs and statistics
- Manage sessions and tasks

### Global Installation

```bash
# Install globally
npm install -g @csdwd/ccs

# Then run anywhere to launch the TUI
ccs

# Direct commands
ccs start      # Start the server
ccs stop       # Stop the server
ccs status     # Check server status
```

### CLI Commands

| Command | Description |
|---------|-------------|
| `npx @csdwd/ccs` | Launch TUI management tool (interactive) |
| `npx @csdwd/ccs start` | Start the server |
| `npx @csdwd/ccs stop` | Stop the server |
| `npx @csdwd/ccs status` | Check server status |

## 🛠️ Running the Project

### Prerequisites

- **Node.js** >= 18.0.0
- **npm** or **yarn**
- **Claude CLI** - Installed and configured

### Local Development

```bash
# Clone the project
git clone https://github.com/csdwd/claude-code-server.git
cd claude-code-server

# Install dependencies
npm install

# Run TUI
node cli.js

# Or use direct commands
node cli.js start    # Start the server
node cli.js stop     # Stop the server
node cli.js status   # Check server status
```

## ⚙️ Configuration

The configuration file is located at `~/.claude-code-server/config.json` (auto-generated on first startup):

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

**Note:**
- `claudePath` defaults to `claude`, using the Claude CLI from system PATH
- `nodeBinDir` is optional, only needed when specifying a particular Node.js version
- If using NVM, configure like:
  ```json
  "claudePath": "claude",
  "nodeBinDir": "~/.nvm/versions/node/v22.21.0/bin"
  ```
- For system Node.js, keep `nodeBinDir` as `null`

### Verify Installation

```bash
# Health check
curl http://localhost:5546/health

# Test API (synchronous)
curl -X POST http://localhost:5546/api/messages \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Explain what HTTP is"}'

## 📚 API Documentation

### Interactive API Documentation

The server includes interactive API documentation powered by Swagger UI. Access it at:

**http://localhost:5546/api-docs**

Features:
- 📖 Browse all available endpoints
- 🧪 Test APIs directly from your browser
- 📝 View detailed request/response schemas
- 🔍 Search and filter endpoints
- 📄 Download OpenAPI specification: http://localhost:5546/api-docs.json

### Quick Example

```bash
curl -X POST http://localhost:5546/api/messages \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Explain what HTTP is"}'
```

**Response:**
```json
{
  "success": true,
  "result": "HTTP is the Hypertext Transfer Protocol...",
  "duration_ms": 1953,
  "cost_usd": 0.0975,
  "session_id": "auto-created-or-provided"
}
```

For complete API reference including all endpoints, parameters, and response codes, please visit the **interactive Swagger UI** at **http://localhost:5546/api-docs**.

### Streaming API (SSE)

Get real-time streaming responses using Server-Sent Events:

```bash
curl -X POST http://localhost:5546/api/sessions/{session_id}/continue/stream \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Write a short poem about coding"}'
```

**SSE Events:**
- `event: message` - Real-time Claude output chunks (JSON format)
- `event: done` - Execution completed with cost and duration
- `event: error` - Error occurred during execution

**JavaScript Example:**
```javascript
const eventSource = new EventSource('/api/sessions/my-session/continue/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: 'Hello!' })
});

eventSource.addEventListener('message', (e) => {
  console.log('Chunk:', JSON.parse(e.data));
});

eventSource.addEventListener('done', (e) => {
  console.log('Completed:', JSON.parse(e.data));
  eventSource.close();
});

eventSource.addEventListener('error', (e) => {
  console.error('Error:', e.data);
  eventSource.close();
});
```

**Streaming Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `prompt` | string | User prompt (required) |
| `system_prompt` | string | System prompt override |
| `max_budget_usd` | number | Maximum budget for this request |
| `allowed_tools` | string[] | Whitelist of allowed tools |
| `disallowed_tools` | string[] | Blacklist of disallowed tools |

## ⚖️ Load Balancing

Claude Code Server supports multi-provider load balancing with session affinity, allowing you to distribute requests across multiple Anthropic API keys or third-party compatible endpoints.

### Configuration

Add `providers` and `loadBalance` sections to your `~/.claude-code-server/config.json`:

```json
{
  "providers": [
    {
      "id": "main",
      "name": "Main API Key",
      "apiKey": "sk-ant-api03-xxx",
      "baseUrl": "https://api.anthropic.com",
      "weight": 3,
      "enabled": true
    },
    {
      "id": "zhipu",
      "name": "ZhipuAI GLM",
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

### Configuration Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `providers[].id` | string | required | Unique provider identifier |
| `providers[].name` | string | required | Display name |
| `providers[].apiKey` | string | required | Auth Token (injected as `ANTHROPIC_AUTH_TOKEN` and `ANTHropic_api_key`) |
| `providers[].baseUrl` | string | optional | API endpoint URL (injected as `ANTHROPIC_BASE_URL`) |
| `providers[].env` | object | optional | Additional environment variables to inject |
| `providers[].weight` | number | 1 | Weight for weighted strategy (1-10) |
| `providers[].enabled` | boolean | true | Whether provider is active |
| `loadBalance.strategy` | string | "round-robin" | Strategy: "round-robin" or "weighted" |
| `loadBalance.failover` | boolean | false | Auto-switch on provider failure |
| `loadBalance.failureThreshold` | number | 3 | Consecutive failures to mark unhealthy |
| `loadBalance.recoveryTimeout` | number | 60 | Seconds before retrying unhealthy provider |

### Environment Variables

The `providers[].env` object allows you to inject additional environment variables when spawning Claude CLI for that provider. Common use cases:

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Alternative authentication token |
| `ANTHROPIC_MODEL` | Default model override |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | Default Sonnet model |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | Default Haiku model |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | Default Opus model |
| `ANTHROPIC_REASONING_MODEL` | Reasoning model override |
| `API_TIMEOUT_MS` | API timeout in milliseconds |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | Disable non-essential network traffic |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | Enable experimental agent teams |

### Features

**Session Affinity**: Same `session_id` always routes to the same provider, ensuring conversation continuity.

**Strategies**:
- **Round-Robin**: Distributes requests evenly across all enabled providers
- **Weighted**: Distributes requests proportionally based on provider weights (e.g., weight 3:1 = 75%:25%)

**Automatic Failover**: When enabled, automatically switches sessions to healthy providers when the bound provider becomes unhealthy.

### Management API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/load-balance/status` | GET | View all providers health, request counts, and binding stats |
| `/api/load-balance/bindings` | GET | View current session-provider bindings |
| `/api/load-balance/providers/:id/reset` | POST | Reset provider health status |
| `/api/load-balance/providers/:id/enable` | POST | Enable a provider |
| `/api/load-balance/providers/:id/disable` | POST | Disable a provider |

**Example - Check Status:**
```bash
curl http://localhost:5546/api/load-balance/status
```

**Response:**
```json
{
  "success": true,
  "strategy": "weighted",
  "failover": true,
  "providers": [
    {
      "id": "main",
      "name": "Main API Key",
      "weight": 3,
      "enabled": true,
      "healthy": true,
      "consecutiveFailures": 0,
      "totalRequests": 42,
      "boundSessions": 5
    },
    {
      "id": "backup",
      "name": "Backup API Key",
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

**Example - Reset Unhealthy Provider:**
```bash
curl -X POST http://localhost:5546/api/load-balance/providers/backup/reset
```

### Backward Compatibility

When no `providers` configuration exists, the system works exactly as before using the default Claude CLI configuration.

## 🖥️ TUI Management Tool

Claude Code Server comes with a full-featured TUI management tool:

### Main Menu Functions

- **▶ Start Service** - Start the background server process
- **■ Stop Service** - Gracefully shutdown the server
- **● View Status** - Display running status and port
- **💬 Session Management** - List/view/delete sessions
- **📊 View Statistics** - View usage statistics summary
- **📋 Task List** - View tasks, adjust priorities
- **📋 View Logs** - Formatted log display with search
- **📖 View API Documentation** - Interactive Swagger UI in browser
- **📝 Configuration Settings** - Visual configuration editor with categorized options
- **🧪 Test API** - Quick test of API endpoints

### Visual Configuration Editor

The TUI includes a visual configuration editor that organizes all settings into categories:

**📦 Basic Configuration**
- Server port, host address
- Claude CLI path (uses system PATH by default)
- Node.js bin directory (optional, only when specifying Node.js version)
- Default project path
- Session retention days
- Log level, max budget

**🔄 Webhook Configuration**
- Enable/disable webhooks
- Default webhook URL
- Timeout and retry settings

**📋 Task Queue Configuration**
- Queue concurrency (1-10)
- Task timeout settings

**⚡ Rate Limiting Configuration**
- Enable/disable rate limiting
- Time window and max requests

**📊 Statistics Configuration**
- Enable/disable statistics collection
- Collection interval

**🔐 Security Configuration**
- **Enable API Authentication** - Enable API key authentication for all endpoints
- **Bypass Health Check Authentication** - Allow health check endpoint without authentication (recommended: true)
- **Skip Permissions Check** - Add `--dangerously-skip-permissions` flag when calling Claude CLI (⚠️ Security risk, keep disabled in production)

### Launch TUI

```bash
node cli.js
```

## ⚙️ Configuration Guide

### Complete Configuration Options

| Config | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | number | 5546 | Server port |
| `host` | string | "0.0.0.0" | Listen address |
| `claudePath` | string | "claude" | Claude CLI executable path |
| `nodeBinDir` | string | null | Node.js bin directory (optional) |
| `defaultProjectPath` | string | - | Default project path |
| `logFile` | string | "~/.claude-code-server/logs/server.log" | Log file path |
| `pidFile` | string | "~/.claude-code-server/server.pid" | PID file path |
| `dataDir` | string | "~/.claude-code-server/data" | Data storage directory |
| `sessionRetentionDays` | number | 30 | Session retention days |
| `taskQueue.concurrency` | number | 3 | Task queue concurrency |
| `taskQueue.defaultTimeout` | number | 300000 | Task timeout (milliseconds) |
| `webhook.enabled` | boolean | false | Enable Webhook |
| `webhook.defaultUrl` | string | null | Default Webhook URL |
| `webhook.timeout` | number | 5000 | Webhook timeout (milliseconds) |
| `webhook.retries` | number | 3 | Webhook retry count |
| `rateLimit.enabled` | boolean | true | Enable rate limiting |
| `rateLimit.windowMs` | number | 60000 | Time window (milliseconds) |
| `rateLimit.maxRequests` | number | 100 | Max requests per window |
| `defaultModel` | string | "claude-sonnet-4-5" | Default model |
| `maxBudgetUsd` | number | 10.0 | Maximum budget (USD) |
| `statistics.enabled` | boolean | true | Enable statistics |
| `statistics.collectionInterval` | number | 60000 | Stats collection interval (ms) |
| `mcp.enabled` | boolean | false | Enable MCP |
| `mcp.configPath` | string | null | MCP config file path |
| `logLevel` | string | "info" | Log level |
| `security.auth.enabled` | boolean | false | Enable API authentication |
| `security.auth.secretKey` | string | null | API authentication secret key |
| `security.auth.bypassHealthCheck` | boolean | true | Bypass auth for health check endpoint |
| `allowDangerouslySkipPermissions` | boolean | false | Skip CLI permissions check (⚠️ security risk) |

### Configuration File Location

Configuration file is automatically saved at: `~/.claude-code-server/config.json`

## 🚀 Production Deployment

### Using PM2

```bash
# Install PM2
npm install -g pm2

# Start service
pm2 start server.js --name claude-code-server

# Enable auto-start on boot
pm2 startup
pm2 save

# View logs
pm2 logs claude-code-server

# Restart service
pm2 restart claude-code-server
```

### Systemd Service

Create `/etc/systemd/system/claude-code-server.service`:

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

Start service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable claude-code-server
sudo systemctl start claude-code-server
```

## 🔧 Troubleshooting

### Service Won't Start

```bash
# Check port occupation
lsof -i :5546

# Check logs
tail -f ~/.claude-code-server/logs/server.log

# Check configuration
cat ~/.claude-code-server/config.json
```

### Task Stuck in Pending State

```bash
# Check queue status
curl http://localhost:5546/api/tasks/queue/status

# Check configured concurrency
cat ~/.claude-code-server/config.json | grep concurrency
```

### Duplicate Log Output

Ensure the server has restarted and loaded new code:

```bash
# Force kill all node processes
pkill -9 node

# Restart
node cli.js
```

## 📂 Project Structure

```
claude-code-server/
├── server.js                 # Main server entry
├── cli.js                    # TUI management tool
├── package.json
├── src/
│   ├── routes/              # API routes
│   │   ├── health.js
│   │   ├── config.js
│   │   ├── claude.js        # Sync/async message routes
│   │   ├── sessions.js      # Session management & streaming
│   │   ├── statistics.js    # Statistics query
│   │   └── tasks.js         # Task management
│   ├── services/
│   │   ├── claudeExecutor.js    # Claude executor
│   │   ├── claudeStreamExecutor.js  # Streaming executor
│   │   ├── sessionManager.js    # Session management
│   │   ├── taskQueue.js         # Task queue
│   │   ├── rateLimiter.js       # Rate limiting
│   │   ├── statisticsCollector.js  # Statistics collection
│   │   └── webhookNotifier.js   # Webhook notification
│   ├── storage/
│   │   ├── sessionStore.js       # Session storage
│   │   ├── taskStore.js          # Task storage
│   │   ├── statsStore.js         # Statistics storage
│   │   └── messageStore.js       # Message storage
│   └── utils/
│       ├── logger.js
│       └── validators.js
└── README.md
```

**Data and Configuration Files:**

All configuration and data files are stored in `~/.claude-code-server/`:
- `config.json` - Configuration file
- `logs/` - Log files directory
- `server.pid` - Process ID file
- `data/` - Data storage (sessions, tasks, statistics)

## 🧪 Testing

The project uses Jest as the testing framework with comprehensive test coverage.

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

### Test Structure

```
tests/
├── storage/
│   └── baseStore.test.js      # File lock mechanism tests
├── utils/
│   └── keyGenerator.test.js   # Key generation tests
└── routes/
    └── health.test.js         # Health endpoint tests
```

### Writing Tests

Tests are located in the `tests/` directory and follow the naming convention `*.test.js`. The test suite includes:

- **Unit Tests** - Testing individual functions and modules
- **Integration Tests** - Testing API endpoints with supertest
- **File Lock Tests** - Testing concurrent access and deadlock prevention

Coverage reports are generated in the `coverage/` directory (excluded from git).

## 🔒 Security Recommendations

1. **API Authentication** - Add API keys or OAuth authentication at the reverse proxy layer
2. **CORS Configuration** - Configure Cross-Origin Resource Sharing as needed
3. **Rate Limiting** - Built-in rate limiting is enabled, adjust as needed
4. **Input Validation** - All requests are validated with Joi
5. **Budget Control** - Use `maxBudgetUsd` to prevent unexpected overspending

## 📊 Performance Metrics

- **Concurrent Tasks**: Configurable 1-10 concurrent tasks
- **Request Rate**: Default 100 requests/minute
- **Task Timeout**: Default 5 minutes, configurable
- **Session Retention**: Default 30 days auto-cleanup

## 📄 License

MIT

## 🤝 Contributing

Issues and Pull Requests are welcome!

## 📮 Contact

For questions or suggestions, please submit a GitHub Issue.
