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
