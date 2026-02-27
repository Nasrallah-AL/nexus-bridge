const Validators = require('../utils/validators');

/**
 * 创建异步任务路由
 */
function createTaskRoutes(taskQueue) {
  const router = require('express').Router();

  /**
   * @swagger
   * /api/tasks/async:
   *   post:
   *     summary: Create async task
   *     description: |
   *       Create a new asynchronous task for background execution.
   *       Tasks are queued and executed based on priority (1-10, higher = more important).
   *       Useful for long-running Claude operations that don't need immediate responses.
   *       Supports webhook callbacks for completion notifications.
   *     tags: [Tasks]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateTaskRequest'
   *           examples:
   *             minimal:
   *               summary: Minimal task (uses defaults)
   *               value:
   *                 prompt: "Generate a comprehensive report"
   *             withPriority:
   *               summary: High priority task
   *               value:
   *                 prompt: "Analyze entire codebase"
   *                 priority: 9
   *                 project_path: "/path/to/project"
   *             withWebhook:
   *               summary: Task with webhook callback
   *               value:
   *                 prompt: "Process large dataset"
   *                 priority: 7
   *                 metadata:
   *                   webhook_url: "https://your-server.com/webhook"
   *                   session_id: "550e8400-e29b-41d4-a716-446655440000"
   *                   max_budget_usd: 10.0
   *     responses:
   *       '201':
   *         description: Task created successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/TaskCreatedResponse'
   *             example:
   *               success: true
   *               task:
   *                 id: "550e8400-e29b-41d4-a716-446655440001"
   *                 prompt: "Generate a comprehensive report"
   *                 status: "pending"
   *                 priority: 5
   *                 project_path: "/path/to/project"
   *                 model: "claude-sonnet-4-5"
   *                 result: null
   *                 error: null
   *                 started_at: null
   *                 completed_at: null
   *                 duration_ms: null
   *                 cost_usd: 0
   *                 session_id: null
   *                 metadata: {}
   *                 created_at: "2025-02-26T10:30:00.000Z"
   *                 updated_at: "2025-02-26T10:30:00.000Z"
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
   *               error: "Failed to create task"
   */
  // POST /api/tasks/async - 创建异步任务
  router.post('/async', async (req, res) => {
    const validation = Validators.validateTaskCreate(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error,
      });
    }

    try {
      // 验证并解析项目路径（必须在工作空间下）
      const pathValidation = Validators.validateProjectPath(
        validation.value.project_path,
        req.app.locals.config?.workspacePath
      );

      if (!pathValidation.valid) {
        return res.status(400).json({
          success: false,
          error: pathValidation.error,
        });
      }

      const taskData = {
        ...validation.value,
        project_path: pathValidation.fullPath,
      };

      const task = await taskQueue.addTask(taskData);

      res.status(201).json({
        success: true,
        task,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * @swagger
   * /api/tasks/{id}:
   *   get:
   *     summary: Get task status
   *     description: |
   *       Retrieve the current status and details of a specific task.
   *       Returns task progress, execution results, and any errors if failed.
   *       Use this to poll for async task completion.
   *     tags: [Tasks]
   *     parameters:
   *       - name: id
   *         in: path
   *         description: Task UUID
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *         example: "550e8400-e29b-41d4-a716-446655440001"
   *     responses:
   *       '200':
   *         description: Task status retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/TaskResponse'
   *             examples:
   *               pending:
   *                 summary: Task waiting to be processed
   *                 value:
   *                   success: true
   *                   task:
   *                     id: "550e8400-e29b-41d4-a716-446655440001"
   *                     prompt: "Generate a comprehensive report"
   *                     status: "pending"
   *                     priority: 5
   *                     project_path: "/path/to/project"
   *                     model: "claude-sonnet-4-5"
   *                     result: null
   *                     error: null
   *                     started_at: null
   *                     completed_at: null
   *                     duration_ms: null
   *                     cost_usd: 0
   *                     created_at: "2025-02-26T10:30:00.000Z"
   *                     updated_at: "2025-02-26T10:30:00.000Z"
   *               processing:
   *                 summary: Task currently being processed
   *                 value:
   *                   success: true
   *                   task:
   *                     id: "550e8400-e29b-41d4-a716-446655440001"
   *                     prompt: "Generate a comprehensive report"
   *                     status: "processing"
   *                     priority: 5
   *                     project_path: "/path/to/project"
   *                     model: "claude-sonnet-4-5"
   *                     result: null
   *                     error: null
   *                     started_at: "2025-02-26T10:31:00.000Z"
   *                     completed_at: null
   *                     duration_ms: null
   *                     cost_usd: 0
   *                     created_at: "2025-02-26T10:30:00.000Z"
   *                     updated_at: "2025-02-26T10:31:00.000Z"
   *               completed:
   *                 summary: Task completed successfully
   *                 value:
   *                   success: true
   *                   task:
   *                     id: "550e8400-e29b-41d4-a716-446655440001"
   *                     prompt: "Generate a comprehensive report"
   *                     status: "completed"
   *                     priority: 5
   *                     project_path: "/path/to/project"
   *                     model: "claude-sonnet-4-5"
   *                     result:
   *                       success: true
   *                       result: "Here is the comprehensive report..."
   *                       duration_ms: 45000
   *                       cost_usd: 0.2250
   *                     error: null
   *                     started_at: "2025-02-26T10:31:00.000Z"
   *                     completed_at: "2025-02-26T10:32:00.000Z"
   *                     duration_ms: 60000
   *                     cost_usd: 0.2250
   *                     created_at: "2025-02-26T10:30:00.000Z"
   *                     updated_at: "2025-02-26T10:32:00.000Z"
   *       '404':
   *         description: Task not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               success: false
   *               error: "Task not found"
   *       '500':
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               success: false
   *               error: "Failed to retrieve task"
   */
  // GET /api/tasks/:id - 获取任务状态
  router.get('/:id', async (req, res) => {
    try {
      const task = await taskQueue.taskStore.get(req.params.id);
      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Task not found',
        });
      }

      res.json({
        success: true,
        task,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * @swagger
   * /api/tasks/{id}/priority:
   *   patch:
   *     summary: Adjust task priority
   *     description: |
   *       Change the priority of an existing task.
   *       Priority must be between 1 and 10 (higher = more important).
   *       Only tasks with 'pending' or 'processing' status can have their priority modified.
   *       Higher priority tasks are executed before lower priority ones.
   *     tags: [Tasks]
   *     parameters:
   *       - name: id
   *         in: path
   *         description: Task UUID
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *         example: "550e8400-e29b-41d4-a716-446655440001"
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - priority
   *             properties:
   *               priority:
   *                 type: integer
   *                 minimum: 1
   *                 maximum: 10
   *                 description: New priority value (1-10)
   *                 example: 8
   *           examples:
   *             increasePriority:
   *               summary: Increase priority
   *               value:
   *                 priority: 8
   *             decreasePriority:
   *               summary: Decrease priority
   *               value:
   *                 priority: 2
   *     responses:
   *       '200':
   *         description: Priority updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/PriorityUpdateResponse'
   *             example:
   *               success: true
   *               message: "Priority updated"
   *               task_id: "550e8400-e29b-41d4-a716-446655440001"
   *               old_priority: 5
   *               new_priority: 8
   *       '400':
   *         description: Invalid request or task state
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             examples:
   *               invalidPriority:
   *                 summary: Invalid priority value
   *                 value:
   *                   success: false
   *                   error: "Priority must be a number between 1 and 10"
   *               wrongStatus:
   *                 summary: Task already completed
   *                 value:
   *                   success: false
   *                   error: "Cannot modify priority for task with status: completed"
   *       '404':
   *         description: Task not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               success: false
   *               error: "Task not found"
   *       '500':
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               success: false
   *               error: "Failed to update priority"
   */
  // PATCH /api/tasks/:id/priority - 修改任务优先级
  router.patch('/:id/priority', async (req, res) => {
    try {
      const { priority } = req.body;

      // 验证优先级
      if (typeof priority !== 'number' || priority < 1 || priority > 10) {
        return res.status(400).json({
          success: false,
          error: 'Priority must be a number between 1 and 10',
        });
      }

      const task = await taskQueue.taskStore.get(req.params.id);
      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Task not found',
        });
      }

      // 只允许修改 pending 或 processing 状态的任务
      if (task.status !== 'pending' && task.status !== 'processing') {
        return res.status(400).json({
          success: false,
          error: `Cannot modify priority for task with status: ${task.status}`,
        });
      }

      // 更新优先级
      await taskQueue.taskStore.update(req.params.id, { priority });

      res.json({
        success: true,
        message: 'Priority updated',
        task_id: req.params.id,
        old_priority: task.priority,
        new_priority: priority,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * @swagger
   * /api/tasks/{id}:
   *   delete:
   *     summary: Cancel task
   *     description: |
   *       Cancel a task that is pending or currently processing.
   *       Already completed tasks cannot be cancelled.
   *       The task will be marked as 'cancelled' and will not be executed.
   *     tags: [Tasks]
   *     parameters:
   *       - name: id
   *         in: path
   *         description: Task UUID
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *         example: "550e8400-e29b-41d4-a716-446655440001"
   *     responses:
   *       '200':
   *         description: Task cancelled successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/TaskCancelResponse'
   *             example:
   *               success: true
   *               message: "Task cancelled successfully"
   *       '400':
   *         description: Cannot cancel task
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             examples:
   *               alreadyCompleted:
   *                 summary: Task already completed
   *                 value:
   *                   success: false
   *                   error: "Cannot cancel task that is already completed"
   *               alreadyFailed:
   *                 summary: Task already failed
   *                 value:
   *                   success: false
   *                   error: "Cannot cancel task that has already failed"
   *       '404':
   *         description: Task not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               success: false
   *               error: "Task not found"
   *       '500':
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               success: false
   *               error: "Failed to cancel task"
   */
  // DELETE /api/tasks/:id - 取消任务
  router.delete('/:id', async (req, res) => {
    try {
      const result = await taskQueue.cancelTask(req.params.id);

      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // GET /api/tasks - 列出任务
  router.get('/', async (req, res) => {
    try {
      const options = {
        status: req.query.status,
        limit: req.query.limit ? parseInt(req.query.limit) : undefined,
      };

      const tasks = await taskQueue.taskStore.list(options);

      res.json({
        success: true,
        tasks,
        count: tasks.length,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * @swagger
   * /api/tasks/queue/status:
   *   get:
   *     summary: Get task queue status
   *     description: |
   *       Retrieve the current status of the task queue system.
   *       Includes information about running state, concurrency limits,
   *       and task counts by status. Useful for monitoring and health checks.
   *     tags: [Tasks]
   *     responses:
   *       '200':
   *         description: Queue status retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/QueueStatusResponse'
   *             example:
   *               success: true
   *               queue:
   *                 running: true
   *                 concurrency: 3
   *                 active_tasks: 2
   *                 total: 150
   *                 pending: 45
   *                 processing: 2
   *                 completed: 95
   *                 failed: 5
   *                 cancelled: 3
   *                 total_cost_usd: 23.75
   *       '500':
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               success: false
   *               error: "Failed to retrieve queue status"
   */
  // GET /api/tasks/status - 获取队列状态
  router.get('/queue/status', async (req, res) => {
    try {
      const status = await taskQueue.getStatus();

      res.json({
        success: true,
        queue: status,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  return router;
}

module.exports = createTaskRoutes;
