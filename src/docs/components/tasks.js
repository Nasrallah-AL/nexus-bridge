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
 *         project_path:
 *           type: string
 *           description: Project working directory
 *           example: "/path/to/project"
 *         model:
 *           type: string
 *           description: Claude model to use
 *           example: "claude-sonnet-4-5"
 *         result:
 *           type: object
 *           description: Task execution result (present when completed)
 *           nullable: true
 *         error:
 *           type: string
 *           description: Error message (present when failed)
 *           nullable: true
 *           example: null
 *         started_at:
 *           type: string
 *           format: date-time
 *           description: Task start timestamp (null if not started)
 *           nullable: true
 *           example: "2025-02-26T10:30:30.000Z"
 *         completed_at:
 *           type: string
 *           format: date-time
 *           description: Task completion timestamp (null if not completed)
 *           nullable: true
 *           example: "2025-02-26T10:31:00.000Z"
 *         duration_ms:
 *           type: integer
 *           description: Task execution duration in milliseconds (null if not completed)
 *           nullable: true
 *           example: 30000
 *         cost_usd:
 *           type: number
 *           format: float
 *           description: Cost in USD for this task
 *           example: 0.0025
 *         session_id:
 *           type: string
 *           description: Associated session ID (if applicable)
 *           nullable: true
 *           example: null
 *         metadata:
 *           type: object
 *           description: Additional metadata for the task
 *           additionalProperties: true
 *           example: {"webhook_url": "https://example.com/webhook", "custom_field": "value"}
 *         created_at:
 *           type: string
 *           format: date-time
 *           description: Task creation timestamp
 *           example: "2025-02-26T10:30:00.000Z"
 *         updated_at:
 *           type: string
 *           format: date-time
 *           description: Task last update timestamp
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
 *         project_path:
 *           type: string
 *           description: Project working directory (defaults to configured defaultProjectPath)
 *           example: "/path/to/project"
 *         model:
 *           type: string
 *           description: Claude model to use (defaults to claude-sonnet-4-5)
 *           example: "claude-sonnet-4-5"
 *         priority:
 *           type: integer
 *           description: Task priority (1-10, default 5)
 *           example: 5
 *           minimum: 1
 *           maximum: 10
 *           default: 5
 *         metadata:
 *           type: object
 *           description: Additional metadata including webhook_url, session_id, system_prompt, max_budget_usd, etc.
 *           additionalProperties: true
 *           example: {"webhook_url": "https://example.com/webhook", "session_id": "session-123"}
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     TaskListResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         tasks:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Task'
 *         count:
 *           type: integer
 *           description: Number of tasks returned
 *           example: 10
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     TaskResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         task:
 *           $ref: '#/components/schemas/Task'
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     TaskCreatedResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         task:
 *           $ref: '#/components/schemas/Task'
 *       description: Response returned when task is created successfully
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     QueueStatusResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         queue:
 *           type: object
 *           properties:
 *             running:
 *               type: boolean
 *               description: Whether the queue is running
 *             concurrency:
 *               type: integer
 *               description: Maximum concurrent tasks
 *             active_tasks:
 *               type: integer
 *               description: Number of currently active tasks
 *             total:
 *               type: integer
 *               description: Total number of tasks
 *             pending:
 *               type: integer
 *               description: Number of pending tasks
 *             processing:
 *               type: integer
 *               description: Number of processing tasks
 *             completed:
 *               type: integer
 *               description: Number of completed tasks
 *             failed:
 *               type: integer
 *               description: Number of failed tasks
 *             cancelled:
 *               type: integer
 *               description: Number of cancelled tasks
 *             total_cost_usd:
 *               type: number
 *               format: float
 *               description: Total cost of all completed tasks in USD
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     TaskCancelResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *       description: Response returned when task is cancelled successfully
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     PriorityUpdateResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: "Priority updated"
 *         task_id:
 *           type: string
 *           format: uuid
 *           description: ID of the task whose priority was updated
 *         old_priority:
 *           type: integer
 *           description: Previous priority value
 *         new_priority:
 *           type: integer
 *           description: New priority value
 */

module.exports = {
  Task: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      prompt: { type: 'string' },
      status: { type: 'string', enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'] },
      priority: { type: 'integer', minimum: 1, maximum: 10 },
      project_path: { type: 'string' },
      model: { type: 'string' },
      result: { type: 'object', nullable: true },
      error: { type: 'string', nullable: true },
      started_at: { type: 'string', format: 'date-time', nullable: true },
      completed_at: { type: 'string', format: 'date-time', nullable: true },
      duration_ms: { type: 'integer', nullable: true },
      cost_usd: { type: 'number', format: 'float' },
      session_id: { type: 'string', nullable: true },
      metadata: { type: 'object', additionalProperties: true },
      created_at: { type: 'string', format: 'date-time' },
      updated_at: { type: 'string', format: 'date-time' }
    }
  },
  CreateTaskRequest: {
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: { type: 'string' },
      project_path: { type: 'string' },
      model: { type: 'string' },
      priority: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
      metadata: { type: 'object', additionalProperties: true }
    }
  },
  TaskListResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      tasks: { type: 'array', items: { $ref: '#/components/schemas/Task' } },
      count: { type: 'integer' }
    }
  },
  TaskResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      task: { $ref: '#/components/schemas/Task' }
    }
  },
  TaskCreatedResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      task: { $ref: '#/components/schemas/Task' }
    }
  },
  QueueStatusResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      queue: {
        type: 'object',
        properties: {
          running: { type: 'boolean' },
          concurrency: { type: 'integer' },
          active_tasks: { type: 'integer' },
          total: { type: 'integer' },
          pending: { type: 'integer' },
          processing: { type: 'integer' },
          completed: { type: 'integer' },
          failed: { type: 'integer' },
          cancelled: { type: 'integer' },
          total_cost_usd: { type: 'number', format: 'float' }
        }
      }
    }
  },
  TaskCancelResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' }
    }
  },
  PriorityUpdateResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      message: { type: 'string' },
      task_id: { type: 'string', format: 'uuid' },
      old_priority: { type: 'integer' },
      new_priority: { type: 'integer' }
    }
  }
};
