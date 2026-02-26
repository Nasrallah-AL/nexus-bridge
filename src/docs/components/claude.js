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
 *           type: string
 *           description: MCP configuration file path (JSON)
 *           example: "/path/to/mcp-config.json"
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
 */;
