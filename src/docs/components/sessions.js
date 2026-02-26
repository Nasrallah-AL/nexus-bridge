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
 *         messages_count:
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
 *         status:
 *           type: string
 *           enum: [active, archived]
 *           description: Session status
 *           example: "active"
 *         metadata:
 *           type: object
 *           description: Optional session metadata
 *           additionalProperties: true
 *           example: { "auto_created": true }
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
      messages_count: { type: 'integer', minimum: 0 },
      total_cost_usd: { type: 'number', format: 'float', minimum: 0 },
      status: { type: 'string', enum: ['active', 'archived'] },
      metadata: { type: 'object', additionalProperties: true },
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
