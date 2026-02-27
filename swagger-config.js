const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Claude Code Server API',
      version: '1.0.0',
      description: `
        Enterprise-grade HTTP API wrapper for Claude CLI with complete features including session management, async tasks, statistics monitoring, and more.

        ## Features

        - 🚀 HTTP API with clean RESTful interface
        - 💬 Session management for multi-turn conversations
        - ⚡ Async task queue with priority scheduling
        - 📊 Statistics and analytics
        - 🔔 Webhook callbacks
        - 🔐 API Key authentication support

        ## Authentication

        The API supports Bearer Token authentication when enabled via server configuration.

        **Format:** \`Authorization: Bearer ccs_ak_<your-api-key>\`

        **Get API Key:**
        1. Run \`node cli.js config\`
        2. Enable "API 密钥认证"
        3. View generated API Key

        **Note:** Only required when authentication is enabled on the server. Health check endpoint (/health) may be exempt from authentication.

        ## Rate Limiting

        Default: 100 requests per minute per IP address. Configurable via server settings.

        ## Documentation

        For more information, visit [GitHub Repository](https://github.com/your-repo/claude-code-server)
      `,
      contact: {
        name: 'Claude Code Server',
        url: 'https://github.com/your-repo/claude-code-server',
        email: 'noreply@example.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: '/',
        description: 'Current server (auto-detected from browser address)'
      }
    ],
    tags: [
      { name: 'Claude', description: 'Claude CLI execution endpoints' },
      { name: 'Sessions', description: 'Session management endpoints' },
      { name: 'Projects', description: 'Historical projects and statistics endpoints' },
      { name: 'Tasks', description: 'Async task management endpoints' },
      { name: 'Statistics', description: 'Statistics and analytics endpoints' },
      { name: 'Health', description: 'Health check endpoints' },
      { name: 'Config', description: 'Configuration management endpoints' }
    ],
    security: [
      { BearerAuth: [] }
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'API Key',
          description: `
使用 Bearer Token 进行 API 认证。

**格式:** \`Authorization: Bearer ccs_ak_<your-api-key>\`

**获取 API Key:**
1. 运行 \`node cli.js config\`
2. 启用 "API 密钥认证"
3. 查看生成的 API Key

**注意:**
- 仅在服务端启用认证时需要
- 健康检查接口 (/health) 可能豁免认证
          `.trim()
        }
      },
      schemas: {
        ErrorResponse: require('./src/docs/components/common').ErrorResponse,
        BudgetInfo: require('./src/docs/components/common').BudgetInfo,
        Session: require('./src/docs/components/sessions').Session,
        CreateSessionRequest: require('./src/docs/components/sessions').CreateSessionRequest,
        Task: require('./src/docs/components/tasks').Task,
        CreateTaskRequest: require('./src/docs/components/tasks').CreateTaskRequest,
        ClaudeRequest: require('./src/docs/components/claude').ClaudeRequest,
        ClaudeResponse: require('./src/docs/components/claude').ClaudeResponse
      }
    }
  },
  apis: [
    './src/routes/*.js',
    './src/docs/components/*.js'
  ]
};

module.exports = swaggerJsdoc(options);
