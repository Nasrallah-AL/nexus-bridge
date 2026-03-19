const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Nexus Bridge API',
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

        **Format:** \`Authorization: Bearer nb_ak_<your-api-key>\`

        **Get API Key:**
        1. Run \`node cli.js config\`
        2. Enable "API Key Authentication"
        3. View generated API Key

        **Note:** Only required when authentication is enabled on the server. Health check endpoint (/health) may be exempt from authentication.

        ## Rate Limiting

        Default: 100 requests per minute per IP address. Configurable via server settings.

        ## Documentation

        For more information, visit [GitHub Repository](https://github.com/csdwd/nexus-bridge)
      `,
      contact: {
        name: 'Nexus Bridge',
        url: 'https://github.com/csdwd/nexus-bridge',
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
      { name: 'Config', description: 'Configuration management endpoints' },
      { name: 'Models', description: 'Model discovery endpoints' },
      { name: 'MCP', description: 'MCP status and configuration endpoints' }
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
Use a Bearer token for API authentication.

**Format:** \`Authorization: Bearer nb_ak_<your-api-key>\`

**Get an API Key:**
1. Run \`node cli.js config\`
2. Enable "API Key Authentication"
3. View the generated API key

**Note:**
- Only required when authentication is enabled on the server
- The health check endpoint (/health) may be exempt from authentication
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
