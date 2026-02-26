# Swagger Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Swagger/OpenAPI documentation to Claude Code Server API with interactive UI at `/api-docs`

**Architecture:** Integrate swagger-jsdoc and swagger-ui-express into the Express server. Define reusable data models (schemas) in separate component files. Add JSDoc annotations to route handlers. Serve Swagger UI at `/api-docs` and provide raw OpenAPI spec at `/api-docs.json`.

**Tech Stack:** swagger-jsdoc (v6+), swagger-ui-express (v4+), OpenAPI 3.0 specification

---

## Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install swagger-jsdoc and swagger-ui-express**

```bash
npm install --save swagger-jsdoc swagger-ui-express
```

**Step 2: Verify installation**

Check: `grep -A2 '"dependencies"' package.json` should include both packages.

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: install swagger-jsdoc and swagger-ui-express

Add dependencies for Swagger/OpenAPI documentation integration."
```

---

## Task 2: Create Directory Structure

**Files:**
- Create: `src/docs/`
- Create: `src/docs/components/`

**Step 1: Create directories**

```bash
mkdir -p src/docs/components
```

**Step 2: Verify creation**

```bash
ls -la src/docs/
```
Expected: `components/` directory exists

**Step 3: Commit**

```bash
git add src/docs
git commit -m "feat: create directory structure for Swagger documentation"
```

---

## Task 3: Create Common Data Models

**Files:**
- Create: `src/docs/components/common.js`

**Step 1: Create common models file**

```javascript
/**
 * Swagger Common Data Models
 * Defines reusable error and budget information schemas
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     ErrorResponse:
 *       type: object
 *       required:
 *         - success
 *         - error
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *           description: Indicates the request failed
 *         error:
 *           type: string
 *           description: Human-readable error message
 *           example: "prompt is required"
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     BudgetInfo:
 *       type: object
 *       properties:
 *         cost_usd:
 *           type: number
 *           format: float
 *           description: Cost in USD for this operation
 *           example: 0.0975
 *           minimum: 0
 *         duration_ms:
 *           type: integer
 *           description: Execution duration in milliseconds
 *           example: 1953
 *           minimum: 0
 */

module.exports = {
  ErrorResponse: {
    type: 'object',
    required: ['success', 'error'],
    properties: {
      success: { type: 'boolean', example: false },
      error: { type: 'string', description: 'Human-readable error message' }
    }
  },
  BudgetInfo: {
    type: 'object',
    properties: {
      cost_usd: { type: 'number', format: 'float', minimum: 0 },
      duration_ms: { type: 'integer', minimum: 0 }
    }
  }
};
```

**Step 2: Verify file creation**

```bash
cat src/docs/components/common.js | head -20
```

**Step 3: Commit**

```bash
git add src/docs/components/common.js
git commit -m "feat: add common Swagger data models (ErrorResponse, BudgetInfo)"
```

---

## Task 4: Create Session Data Models

**Files:**
- Create: `src/docs/components/sessions.js`

**Step 1: Create session models file**

```javascript
/**
 * Swagger Session Data Models
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Session:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           description: Unique session identifier
 *           example: "550e8400-e29b-41d4-a716-446655440000"
 *         project_path:
 *           type: string
 *           description: Project directory path
 *           example: "/path/to/project"
 *         model:
 *           type: string
 *           description: Claude model used
 *           example: "claude-sonnet-4-5"
 *         message_count:
 *           type: integer
 *           description: Number of messages in session
 *           example: 5
 *           minimum: 0
 *         total_cost_usd:
 *           type: number
 *           format: float
 *           description: Total cost in USD for this session
 *           example: 0.4875
 *           minimum: 0
 *         created_at:
 *           type: string
 *           format: date-time
 *           description: Session creation timestamp
 *           example: "2025-02-26T10:30:00.000Z"
 *         updated_at:
 *           type: string
 *           format: date-time
 *           description: Last update timestamp
 *           example: "2025-02-26T10:35:00.000Z"
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     CreateSessionRequest:
 *       type: object
 *       properties:
 *         project_path:
 *           type: string
 *           description: Project directory path
 *           example: "/path/to/project"
 *         model:
 *           type: string
 *           description: Claude model to use
 *           example: "claude-sonnet-4-5"
 *           default: "claude-sonnet-4-5"
 *         metadata:
 *           type: object
 *           description: Optional metadata
 *           additionalProperties: true
 *           example: { "auto_created": true }
 */

module.exports = {
  Session: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      project_path: { type: 'string' },
      model: { type: 'string' },
      message_count: { type: 'integer', minimum: 0 },
      total_cost_usd: { type: 'number', format: 'float', minimum: 0 },
      created_at: { type: 'string', format: 'date-time' },
      updated_at: { type: 'string', format: 'date-time' }
    }
  },
  CreateSessionRequest: {
    type: 'object',
    properties: {
      project_path: { type: 'string' },
      model: { type: 'string', default: 'claude-sonnet-4-5' },
      metadata: { type: 'object', additionalProperties: true }
    }
  }
};
```

**Step 2: Verify file creation**

```bash
cat src/docs/components/sessions.js | head -30
```

**Step 3: Commit**

```bash
git add src/docs/components/sessions.js
git commit -m "feat: add Session data models for Swagger documentation"
```

---

## Task 5: Create Task Data Models

**Files:**
- Create: `src/docs/components/tasks.js`

**Step 1: Create task models file**

```javascript
/**
 * Swagger Task Data Models
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Task:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           description: Unique task identifier
 *           example: "550e8400-e29b-41d4-a716-446655440000"
 *         prompt:
 *           type: string
 *           description: The prompt sent to Claude
 *           example: "Explain what HTTP is"
 *         status:
 *           type: string
 *           enum: [pending, processing, completed, failed, cancelled]
 *           description: Current task status
 *           example: "completed"
 *         priority:
 *           type: integer
 *           description: Task priority (1-10, higher is more important)
 *           example: 5
 *           minimum: 1
 *           maximum: 10
 *         result:
 *           type: object
 *           description: Task execution result (present when completed)
 *           nullable: true
 *         error:
 *           type: string
 *           description: Error message (present when failed)
 *           nullable: true
 *           example: null
 *         created_at:
 *           type: string
 *           format: date-time
 *           description: Task creation timestamp
 *           example: "2025-02-26T10:30:00.000Z"
 *         completed_at:
 *           type: string
 *           format: date-time
 *           description: Task completion timestamp (null if not completed)
 *           nullable: true
 *           example: "2025-02-26T10:31:00.000Z"
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     CreateTaskRequest:
 *       type: object
 *       required:
 *         - prompt
 *       properties:
 *         prompt:
 *           type: string
 *           description: The prompt to send to Claude
 *           example: "Explain what HTTP is"
 *         priority:
 *           type: integer
 *           description: Task priority (1-10, default 5)
 *           example: 5
 *           minimum: 1
 *           maximum: 10
 *           default: 5
 *         webhook_url:
 *           type: string
 *           format: uri
 *           description: Webhook URL for completion notification
 *           example: "https://your-server.com/webhook"
 *         project_path:
 *           type: string
 *           description: Project working directory
 *           example: "/path/to/project"
 *         model:
 *           type: string
 *           description: Claude model to use
 *           example: "claude-sonnet-4-5"
 */

module.exports = {
  Task: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      prompt: { type: 'string' },
      status: { type: 'string', enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'] },
      priority: { type: 'integer', minimum: 1, maximum: 10 },
      result: { type: 'object', nullable: true },
      error: { type: 'string', nullable: true },
      created_at: { type: 'string', format: 'date-time' },
      completed_at: { type: 'string', format: 'date-time', nullable: true }
    }
  },
  CreateTaskRequest: {
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: { type: 'string' },
      priority: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
      webhook_url: { type: 'string', format: 'uri' },
      project_path: { type: 'string' },
      model: { type: 'string' }
    }
  }
};
```

**Step 2: Verify file creation**

```bash
cat src/docs/components/tasks.js | head -40
```

**Step 3: Commit**

```bash
git add src/docs/components/tasks.js
git commit -m "feat: add Task data models for Swagger documentation"
```

---

## Task 6: Create Claude Data Models

**Files:**
- Create: `src/docs/components/claude.js`

**Step 1: Create claude models file**

```javascript
/**
 * Swagger Claude API Data Models
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     ClaudeRequest:
 *       type: object
 *       required:
 *         - prompt
 *       properties:
 *         prompt:
 *           type: string
 *           description: The prompt to send to Claude
 *           example: "Explain what HTTP is"
 *         project_path:
 *           type: string
 *           description: Project working directory
 *           example: "/path/to/project"
 *         model:
 *           type: string
 *           description: Claude model to use
 *           example: "claude-sonnet-4-5"
 *         session_id:
 *           type: string
 *           format: uuid
 *           description: Session ID for multi-turn conversations
 *           example: "550e8400-e29b-41d4-a716-446655440000"
 *         system_prompt:
 *           type: string
 *           description: System prompt for the session
 *           example: "You are a helpful assistant"
 *         max_budget_usd:
 *           type: number
 *           format: float
 *           description: Maximum budget in USD
 *           example: 10.0
 *           minimum: 0
 *         allowed_tools:
 *           type: array
 *           description: List of allowed tools
 *           items:
 *             type: string
 *           example: ["bash", "editor"]
 *         disallowed_tools:
 *           type: array
 *           description: List of disallowed tools
 *           items:
 *             type: string
 *           example: ["browser"]
 *         agent:
 *           type: string
 *           description: Agent to use for the request
 *           example: "code-reviewer"
 *         mcp_config:
 *           type: object
 *           description: MCP configuration
 *           additionalProperties: true
 *         stream:
 *           type: boolean
 *           description: Enable streaming (not yet implemented)
 *           default: false
 *         async:
 *           type: boolean
 *           description: Execute asynchronously
 *           default: false
 *         webhook_url:
 *           type: string
 *           format: uri
 *           description: Webhook URL for async callbacks
 *           example: "https://your-server.com/webhook"
 *         priority:
 *           type: integer
 *           description: Task priority for async mode (1-10)
 *           example: 5
 *           minimum: 1
 *           maximum: 10
 *           default: 5
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     ClaudeResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           description: Indicates if the request was successful
 *           example: true
 *         result:
 *           type: string
 *           description: Claude's response
 *           example: "HTTP is the Hypertext Transfer Protocol..."
 *         duration_ms:
 *           type: integer
 *           description: Execution duration in milliseconds
 *           example: 1953
 *         cost_usd:
 *           type: number
 *           format: float
 *           description: Cost in USD
 *           example: 0.0975
 *         session_id:
 *           type: string
 *           format: uuid
 *           description: Session ID (auto-created or provided)
 *           example: "550e8400-e29b-41d4-a716-446655440000"
 */

module.exports = {
  ClaudeRequest: {
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: { type: 'string' },
      project_path: { type: 'string' },
      model: { type: 'string' },
      session_id: { type: 'string', format: 'uuid' },
      system_prompt: { type: 'string' },
      max_budget_usd: { type: 'number', format: 'float', minimum: 0 },
      allowed_tools: { type: 'array', items: { type: 'string' } },
      disallowed_tools: { type: 'array', items: { type: 'string' } },
      agent: { type: 'string' },
      mcp_config: { type: 'object', additionalProperties: true },
      stream: { type: 'boolean', default: false },
      async: { type: 'boolean', default: false },
      webhook_url: { type: 'string', format: 'uri' },
      priority: { type: 'integer', minimum: 1, maximum: 10, default: 5 }
    }
  },
  ClaudeResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      result: { type: 'string' },
      duration_ms: { type: 'integer' },
      cost_usd: { type: 'number', format: 'float' },
      session_id: { type: 'string', format: 'uuid' }
    }
  }
};
```

**Step 2: Verify file creation**

```bash
cat src/docs/components/claude.js | head -60
```

**Step 3: Commit**

```bash
git add src/docs/components/claude.js
git commit -m "feat: add Claude API data models for Swagger documentation"
```

---

## Task 7: Create Swagger Configuration

**Files:**
- Create: `swagger-config.js`

**Step 1: Create swagger config file**

```javascript
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
```

**Step 2: Verify file creation**

```bash
cat swagger-config.js | head -30
```

**Step 3: Commit**

```bash
git add swagger-config.js
git commit -m "feat: create Swagger configuration with OpenAPI 3.0 spec"
```

---

## Task 8: Integrate Swagger UI into Server

**Files:**
- Modify: `server.js`

**Step 1: Add Swagger UI to server**

After the routes are mounted (after line 88, after `app.use('/api/statistics', statisticsRoutes);`), add:

```javascript
// Swagger API Documentation
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger-config');

// Serve Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'Claude Code Server API Documentation',
  customCss: '.swagger-ui .topbar { display: none }',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    docExpansion: 'list',
    filter: true,
    showRequestHeaders: true,
    tryItOutEnabled: true
  }
}));

// Serve raw OpenAPI JSON spec
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});
```

**Step 2: Verify integration**

Check that the file is syntactically correct:

```bash
node -c server.js
```
Expected: No syntax errors

**Step 3: Commit**

```bash
git add server.js
git commit -m "feat: integrate Swagger UI at /api-docs

Add swagger-ui-express middleware to serve interactive API documentation.
Raw OpenAPI spec available at /api-docs.json."
```

---

## Task 9: Add Swagger Annotations to Claude Routes - POST /api/claude

**Files:**
- Modify: `src/routes/claude.js`

**Step 1: Add JSDoc annotation before POST /api/claude handler**

After line 9 (after `const router = require('express').Router();`), before line 10 (before `// POST /api/claude`), add:

```javascript
/**
 * @swagger
 * /api/claude:
 *   post:
 *     summary: Execute Claude CLI request
 *     description: |
 *       Send a prompt to Claude CLI and get the response.
 *       Supports both synchronous and asynchronous execution modes.
 *       Can automatically create sessions for multi-turn conversations.
 *     tags: [Claude]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ClaudeRequest'
 *           examples:
 *             simple:
 *               summary: Simple request
 *               value:
 *                 prompt: "Explain what HTTP is"
 *             withSession:
 *               summary: With session management
 *               value:
 *                 prompt: "What is the difference between HTTP and HTTPS?"
 *                 session_id: "550e8400-e29b-41d4-a716-446655440000"
 *             advanced:
 *               summary: With all options
 *               value:
 *                 prompt: "Review this code"
 *                 project_path: "/path/to/project"
 *                 model: "claude-sonnet-4-5"
 *                 agent: "code-reviewer"
 *                 allowed_tools: ["bash", "editor"]
 *                 max_budget_usd: 5.0
 *             async:
 *               summary: Async execution
 *               value:
 *                 prompt: "Generate a report"
 *                 async: true
 *                 priority: 8
 *                 webhook_url: "https://your-server.com/webhook"
 *     responses:
 *       '200':
 *         description: Successful synchronous execution
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ClaudeResponse'
 *             example:
 *               success: true
 *               result: "HTTP is the Hypertext Transfer Protocol..."
 *               duration_ms: 1953
 *               cost_usd: 0.0975
 *               session_id: "550e8400-e29b-41d4-a716-446655440000"
 *       '202':
 *         description: Async task created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Task created successfully"
 *                 task_id:
 *                   type: string
 *                   format: uuid
 *                 status:
 *                   type: string
 *                   enum: [pending, processing, completed, failed, cancelled]
 *                 priority:
 *                   type: integer
 *                 session_id:
 *                   type: string
 *                   format: uuid
 *                 webhook_url:
 *                   type: string
 *                   format: uri
 *             example:
 *               success: true
 *               message: "Task created successfully"
 *               task_id: "550e8400-e29b-41d4-a716-446655440001"
 *               status: "pending"
 *               priority: 5
 *               session_id: "550e8400-e29b-41d4-a716-446655440000"
 *               webhook_url: "https://your-server.com/webhook"
 *       '400':
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "prompt is required"
 *       '500':
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Internal server error"
 *       '501':
 *         description: Feature not implemented
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Streaming is not yet implemented"
 */
```

**Step 2: Verify syntax**

```bash
node -c src/routes/claude.js
```
Expected: No syntax errors

**Step 3: Commit**

```bash
git add src/routes/claude.js
git commit -m "docs: add Swagger annotation for POST /api/claude endpoint"
```

---

## Task 10: Add Swagger Annotations to Claude Routes - POST /api/claude/batch

**Files:**
- Modify: `src/routes/claude.js`

**Step 1: Add JSDoc annotation before POST /api/claude/batch handler**

Before line 136 (before `// POST /api/claude/batch`), add:

```javascript
/**
 * @swagger
 * /api/claude/batch:
 *   post:
 *     summary: Process multiple Claude requests concurrently
 *     description: |
 *       Execute multiple prompts in parallel and return all results.
 *       Maximum 10 requests per batch.
 *     tags: [Claude]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - prompts
 *             properties:
 *               prompts:
 *                 type: array
 *                 description: Array of prompts to process
 *                 maxItems: 10
 *                 items:
 *                   type: string
 *                 example:
 *                   - "Explain what is HTTP"
 *                   - "Explain what is HTTPS"
 *                   - "Explain what is TCP"
 *               project_path:
 *                 type: string
 *                 description: Project working directory
 *                 example: "/path/to/project"
 *               model:
 *                 type: string
 *                 description: Claude model to use
 *                 example: "claude-sonnet-4-5"
 *           examples:
 *             simple:
 *               summary: Simple batch
 *               value:
 *                 prompts:
 *                   - "What is HTTP?"
 *                   - "What is HTTPS?"
 *             withPath:
 *               summary: With project path and model
 *               value:
 *                 prompts:
 *                   - "Review the code"
 *                   - "Write tests"
 *                 project_path: "/path/to/project"
 *                 model: "claude-sonnet-4-5"
 *     responses:
 *       '200':
 *         description: Batch processing completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 results:
 *                   type: array
 *                   description: Array of individual results
 *                   items:
 *                     type: object
 *                     properties:
 *                       success:
 *                         type: boolean
 *                       result:
 *                         type: string
 *                       error:
 *                         type: string
 *                       duration_ms:
 *                         type: integer
 *                       cost_usd:
 *                         type: number
 *                         format: float
 *                 summary:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                       description: Total number of requests
 *                     successful:
 *                       type: integer
 *                       description: Number of successful requests
 *                     failed:
 *                       type: integer
 *                       description: Number of failed requests
 *                     total_cost_usd:
 *                       type: number
 *                       format: float
 *                       description: Total cost for all requests
 *                     total_duration_ms:
 *                       type: integer
 *                       description: Total duration in milliseconds
 *             example:
 *               success: true
 *               results:
 *                 - success: true
 *                   result: "HTTP is..."
 *                   duration_ms: 1953
 *                   cost_usd: 0.0975
 *                 - success: true
 *                   result: "HTTPS is..."
 *                   duration_ms: 2100
 *                   cost_usd: 0.1050
 *               summary:
 *                 total: 2
 *                 successful: 2
 *                 failed: 0
 *                 total_cost_usd: 0.2025
 *                 total_duration_ms: 4053
 *       '400':
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '500':
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
```

**Step 2: Verify syntax**

```bash
node -c src/routes/claude.js
```
Expected: No syntax errors

**Step 3: Commit**

```bash
git add src/routes/claude.js
git commit -m "docs: add Swagger annotation for POST /api/claude/batch endpoint"
```

---

## Task 11: Test Swagger Integration

**Step 1: Start the server**

```bash
npm start &
```

Wait for server to start (check for "Server listening on port 5546").

**Step 2: Test Swagger UI**

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:5546/api-docs
```
Expected: `200`

**Step 3: Test OpenAPI JSON endpoint**

```bash
curl -s http://localhost:5546/api-docs.json | head -50
```
Expected: Valid JSON with OpenAPI spec

**Step 4: Verify in browser**

Open http://localhost:5546/api-docs in browser and verify:
- Page loads without errors
- "Claude" tag shows POST /api/claude endpoint
- "Try it out" button works
- Request examples are visible

**Step 5: Stop server**

```bash
pkill -f "node server.js"
```

**Step 6: No commit** (testing only)

---

## Task 12: Add Swagger Annotations for Session Routes

**Files:**
- Modify: `src/routes/sessions.js`

**Step 1: Read the file to understand structure**

```bash
cat src/routes/sessions.js
```

**Step 2: Add annotation for POST /api/sessions**

Add JSDoc annotation with:
- Summary: "Create a new session"
- Request body with CreateSessionRequest schema
- Responses: 201 (created), 400 (bad request), 500 (server error)

**Step 3: Add annotation for GET /api/sessions**

Add JSDoc annotation with:
- Summary: "List all sessions"
- Query parameters: limit, offset
- Response: 200 with array of Session objects

**Step 4: Add annotation for GET /api/sessions/:id**

Add JSDoc annotation with:
- Summary: "Get session details"
- Path parameter: id (UUID)
- Responses: 200 (Session), 404 (not found)

**Step 5: Add annotation for POST /api/sessions/:id/continue**

Add JSDoc annotation with:
- Summary: "Continue conversation in session"
- Path parameter: id (UUID)
- Request body with prompt
- Responses: 200 (ClaudeResponse), 404 (not found)

**Step 6: Add annotation for DELETE /api/sessions/:id**

Add JSDoc annotation with:
- Summary: "Delete a session"
- Path parameter: id (UUID)
- Responses: 200 (success), 404 (not found)

**Step 7: Verify syntax**

```bash
node -c src/routes/sessions.js
```
Expected: No syntax errors

**Step 8: Commit**

```bash
git add src/routes/sessions.js
git commit -m "docs: add Swagger annotations for all session endpoints"
```

---

## Task 13: Add Swagger Annotations for Task Routes

**Files:**
- Modify: `src/routes/tasks.js`

**Step 1: Read the file to understand structure**

```bash
cat src/routes/tasks.js
```

**Step 2: Add annotation for POST /api/tasks/async**

Add JSDoc annotation with:
- Summary: "Create async task"
- Request body with CreateTaskRequest schema
- Responses: 202 (accepted), 400 (bad request), 500 (server error)

**Step 3: Add annotation for GET /api/tasks/:id**

Add JSDoc annotation with:
- Summary: "Get task status"
- Path parameter: id (UUID)
- Responses: 200 (Task), 404 (not found)

**Step 4: Add annotation for PATCH /api/tasks/:id/priority**

Add JSDoc annotation with:
- Summary: "Adjust task priority"
- Path parameter: id (UUID)
- Request body with priority (1-10)
- Responses: 200 (success), 400 (bad request), 404 (not found)

**Step 5: Add annotation for DELETE /api/tasks/:id**

Add JSDoc annotation with:
- Summary: "Cancel task"
- Path parameter: id (UUID)
- Responses: 200 (success), 404 (not found)

**Step 6: Add annotation for GET /api/tasks/queue/status**

Add JSDoc annotation with:
- Summary: "Get task queue status"
- Response: 200 with queue statistics

**Step 7: Verify syntax**

```bash
node -c src/routes/tasks.js
```
Expected: No syntax errors

**Step 8: Commit**

```bash
git add src/routes/tasks.js
git commit -m "docs: add Swagger annotations for all task endpoints"
```

---

## Task 14: Final Testing and Verification

**Step 1: Start server**

```bash
npm start &
```

**Step 2: Verify all endpoints in Swagger UI**

Open http://localhost:5546/api-docs

Check:
- ✅ Claude tag has 2 endpoints (POST /api/claude, POST /api/claude/batch)
- ✅ Sessions tag has 5 endpoints
- ✅ Tasks tag has 5 endpoints
- ✅ All schemas are defined in Components section
- ✅ Examples are visible
- ✅ "Try it out" works for at least one endpoint per tag

**Step 3: Test an endpoint through Swagger UI**

1. Go to POST /api/claude
2. Click "Try it out"
3. Use the "simple" example
4. Click "Execute"
5. Verify response is displayed

**Step 4: Verify OpenAPI JSON**

```bash
curl -s http://localhost:5546/api-docs.json | python3 -m json.tool > /dev/null && echo "Valid JSON"
```
Expected: "Valid JSON"

**Step 5: Validate OpenAPI spec**

```bash
curl -s http://localhost:5546/api-docs.json -o openapi.json
curl -X POST "https://validator.swagger.io/validator/debug?url=https://raw.githubusercontent.com/YOUR_USER/claude-code-server/main/openapi.json" || echo "Manual validation required"
```

**Step 6: Stop server**

```bash
pkill -f "node server.js"
```

**Step 7: No commit** (testing only)

---

## Task 15: Update README Documentation

**Files:**
- Modify: `README.md`
- Modify: `README_zh.md`

**Step 1: Add API Documentation section to README.md**

After "## 📚 API Documentation" section (around line 121), add before first endpoint:

```markdown
### Interactive API Documentation

The server includes interactive API documentation powered by Swagger UI. Access it at:

**http://localhost:5546/api-docs**

Features:
- 📖 Browse all available endpoints
- 🧪 Test APIs directly from your browser
- 📝 View detailed request/response schemas
- 🔍 Search and filter endpoints
- 📄 Download OpenAPI specification: http://localhost:5546/api-docs.json

```

**Step 2: Update README_zh.md with same content (translated)**

Add Chinese version:

```markdown
### 交互式 API 文档

服务器包含由 Swagger UI 提供支持的交互式 API 文档。访问地址：

**http://localhost:5546/api-docs**

功能：
- 📖 浏览所有可用的 API 端点
- 🧪 直接在浏览器中测试 API
- 📝 查看详细的请求/响应模式
- 🔍 搜索和过滤端点
- 📄 下载 OpenAPI 规范：http://localhost:5546/api-docs.json

```

**Step 3: Commit**

```bash
git add README.md README_zh.md
git commit -m "docs: add Swagger UI documentation link to README"
```

---

## Task 16: Final Commit and Merge Preparation

**Step 1: Review all changes**

```bash
git log --oneline
```

**Step 2: Run final syntax check**

```bash
node -c server.js src/routes/*.js swagger-config.js
```
Expected: All files pass syntax check

**Step 3: Final verification**

```bash
npm start &
sleep 3
curl -s -o /dev/null -w "%{http_code}" http://localhost:5546/api-docs
curl -s -o /dev/null -w "%{http_code}" http://localhost:5546/api-docs.json
pkill -f "node server.js"
```
Expected: All return `200`

**Step 4: Create summary commit**

```bash
git add -A
git commit -m "feat: complete Swagger/OpenAPI documentation integration

This commit completes the Swagger integration for Claude Code Server API.

Summary of changes:
- Installed swagger-jsdoc and swagger-ui-express
- Created reusable data models (schemas) for all API entities
- Added JSDoc annotations to all core endpoints:
  - Claude API (sync/async execution, batch)
  - Session management (CRUD operations)
  - Task management (create, status, priority, cancel)
- Integrated Swagger UI at /api-docs
- Added OpenAPI JSON endpoint at /api-docs.json
- Updated README with links to interactive documentation

The documentation provides:
- Complete API reference with examples
- Interactive testing interface
- Request/response schemas
- Error documentation

Access documentation at: http://localhost:5546/api-docs"
```

**Step 5: Ready for merge**

The feature branch is now ready for merge into main.

---

## Testing Strategy

### Manual Testing Checklist

- [ ] Swagger UI loads without errors
- [ ] All tags (Claude, Sessions, Tasks) are visible
- [ ] Each endpoint has proper documentation
- [ ] Request examples are provided
- [ ] Response schemas are defined
- [ ] "Try it out" functionality works
- [ ] OpenAPI JSON is valid
- [ ] All routes have proper annotations

### Integration Testing

```bash
# Test that Swagger UI doesn't break existing functionality
curl http://localhost:5546/health
curl -X POST http://localhost:5546/api/claude \
  -H "Content-Type: application/json" \
  -d '{"prompt": "test"}'
```

---

## Notes

- This implementation follows OpenAPI 3.0 specification
- Swagger UI is served at `/api-docs` path
- Raw OpenAPI spec available at `/api-docs.json`
- All schemas are reusable via `$ref`
- Examples provided for common use cases
- Authentication not implemented yet (documented as todo)

---

## Future Enhancements

- Add authentication/authorization documentation
- Include response examples for all error codes
- Add more detailed descriptions for complex parameters
- Consider adding request/response examples for Sessions and Tasks endpoints
- Add API versioning strategy documentation
