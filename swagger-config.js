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

        ## Authentication

        Currently the API does not require authentication. It's recommended to add authentication at the reverse proxy layer (nginx, API Gateway) for production use.

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
        url: 'http://localhost:5546',
        description: 'Development server'
      },
      {
        url: 'https://api.your-domain.com',
        description: 'Production server'
      }
    ],
    tags: [
      { name: 'Claude', description: 'Claude CLI execution endpoints' },
      { name: 'Sessions', description: 'Session management endpoints' },
      { name: 'Tasks', description: 'Async task management endpoints' },
      { name: 'Statistics', description: 'Statistics and analytics endpoints' },
      { name: 'Health', description: 'Health check endpoints' },
      { name: 'Config', description: 'Configuration management endpoints' }
    ],
    components: {
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
