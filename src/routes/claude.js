const Validators = require('../utils/validators');
const crypto = require('crypto');

/**
 * Claude API 路由 (同步)
 */
function createClaudeRoutes(claudeExecutor, config, taskQueue = null, sessionManager = null) {
  const router = require('express').Router();

  /**
   * @swagger
   * /api/messages:
   *   post:
   *     summary: Send message to Claude (Synchronous)
   *     description: |
   *       Send a prompt to Claude CLI and get the response synchronously.
   *       Automatically creates sessions for multi-turn conversations.
   *       Returns the result immediately after execution.
   *     tags: [Messages]
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
   *     responses:
   *       '200':
   *         description: Successful execution
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
  // POST /api/messages - 同步执行
  router.post('/', async (req, res) => {
    const {
      prompt,
      project_path,
      model,
      session_id,
      system_prompt,
      max_budget_usd,
      allowed_tools,
      disallowed_tools,
      agent,
      mcp_config,
      stream,
    } = req.body;

    // 验证请求
    const validation = Validators.validateClaudeRequest(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error,
      });
    }

    const projectPath = project_path || config.defaultProjectPath;

    // 流式输出暂不支持
    if (stream) {
      return res.status(501).json({
        success: false,
        error: 'Streaming is not yet implemented',
      });
    }

    // 自动创建会话（如果没有 session_id）
    let sessionId = session_id;
    if (!sessionId && sessionManager) {
      try {
        const session = await sessionManager.createSession({
          project_path: projectPath,
          model: model || config.defaultModel,
          metadata: {
            auto_created: true,
          },
        });
        sessionId = session.id;
      } catch (error) {
        // 如果创建会话失败，继续执行但不使用会话
        console.error('Failed to auto-create session:', error.message);
      }
    }

    // 同步执行
    const result = await claudeExecutor.execute({
      prompt,
      projectPath,
      model,
      sessionId: sessionId,
      systemPrompt: system_prompt,
      maxBudgetUsd: max_budget_usd,
      allowedTools: allowed_tools,
      disallowedTools: disallowed_tools,
      agent,
      mcpConfig: mcp_config,
      stream,
    });

    // 返回结果（包含 session_id）
    const statusCode = result.success ? 200 : 500;
    const responseData = result.success ? {
      ...result,
      session_id: sessionId, // 返回 session_id
    } : result;

    res.status(statusCode).json(responseData);
  });

  /**
   * @swagger
   * /api/message/batches:
   *   post:
   *     summary: Execute multiple Claude requests in batch
   *     description: |
   *       Send multiple prompts to Claude CLI and get all responses.
   *       All requests are executed concurrently for better performance.
   *       Returns individual results plus summary statistics.
   *     tags: [Messages]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/BatchRequest'
   *           examples:
   *             simple:
   *               summary: Simple batch request
   *               value:
   *                 prompts:
   *                   - "Explain what HTTP is"
   *                   - "What is HTTPS?"
   *                   - "What is a REST API?"
   *             withProject:
   *               summary: Batch with custom project path
   *               value:
   *                 prompts:
   *                   - "Review the authentication code"
   *                   - "Check for security issues"
   *                 project_path: "/path/to/project"
   *             withModel:
   *               summary: Batch with specific model
   *               value:
   *                 prompts:
   *                   - "Generate unit tests"
   *                   - "Generate integration tests"
   *                   - "Generate E2E tests"
   *                 model: "claude-sonnet-4-5"
   *     responses:
   *       '200':
   *         description: Batch execution completed
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/BatchResponse'
   *             example:
   *               success: true
   *               results:
   *                 - success: true
   *                   result: "HTTP is the Hypertext Transfer Protocol..."
   *                   duration_ms: 1953
   *                   cost_usd: 0.0975
   *                 - success: true
   *                   result: "HTTPS is HTTP over SSL/TLS..."
   *                   duration_ms: 2100
   *                   cost_usd: 0.1050
   *                 - success: true
   *                   result: "A REST API is an architectural style..."
   *                   duration_ms: 1876
   *                   cost_usd: 0.0938
   *               summary:
   *                 total: 3
   *                 successful: 3
   *                 failed: 0
   *                 total_cost_usd: 0.2963
   *                 total_duration_ms: 5929
   *       '400':
   *         description: Invalid request
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               success: false
   *               error: "prompts must be an array with at least 1 item"
   *       '500':
   *         description: Server error during batch execution
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               success: false
   *               error: "Failed to execute batch requests"
   */
  // POST /api/message/batches - 批量处理
  router.post('/batches', async (req, res) => {
    const validation = Validators.validateBatchRequest(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error,
      });
    }

    const { prompts, project_path, model } = validation.value;
    const projectPath = project_path || config.defaultProjectPath;

    // 并发执行所有请求
    const promises = prompts.map(prompt =>
      claudeExecutor.execute({
        prompt,
        projectPath,
        model,
      })
    );

    try {
      const results = await Promise.all(promises);

      // 统计结果
      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;
      const totalCost = results.reduce((sum, r) => sum + (r.cost_usd || 0), 0);
      const totalDuration = results.reduce((sum, r) => sum + (r.duration_ms || 0), 0);

      res.json({
        success: true,
        results,
        summary: {
          total: results.length,
          successful: successCount,
          failed: failCount,
          total_cost_usd: totalCost,
          total_duration_ms: totalDuration,
        },
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

/**
 * Async Claude API 路由
 */
function createAsyncClaudeRoutes(claudeExecutor, config, taskQueue, sessionManager = null) {
  const router = require('express').Router();

  /**
   * @swagger
   * /api/async/messages:
   *   post:
   *     summary: Send async message to Claude
   *     description: |
   *       Send a prompt to Claude CLI for asynchronous execution.
   *       The request is added to a task queue and processed in the background.
   *       Supports priority-based scheduling and webhook callbacks.
   *     tags: [Messages]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/ClaudeRequest'
   *           examples:
   *             simple:
   *               summary: Simple async request
   *               value:
   *                 prompt: "Generate a comprehensive report"
   *                 priority: 5
   *             highPriority:
   *               summary: High priority async task
   *               value:
   *                 prompt: "Analyze entire codebase"
   *                 priority: 8
   *             withWebhook:
   *               summary: Async with webhook callback
   *               value:
   *                 prompt: "Process large dataset"
   *                 priority: 7
   *                 webhook_url: "https://your-server.com/webhook"
   *             advanced:
   *               summary: Async with all options
   *               value:
   *                 prompt: "Generate documentation"
   *                 project_path: "/path/to/project"
   *                 model: "claude-sonnet-4-5"
   *                 agent: "documentation-writer"
   *                 priority: 9
   *                 webhook_url: "https://your-server.com/webhook"
   *     responses:
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
   *                   example: "pending"
   *                 priority:
   *                   type: integer
   *                   example: 5
   *                   minimum: 1
   *                   maximum: 10
   *                 session_id:
   *                   type: string
   *                   format: uuid
   *                   example: "550e8400-e29b-41d4-a716-446655440000"
   *                 webhook_url:
   *                   type: string
   *                   format: uri
   *                   example: "https://your-server.com/webhook"
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
   *       '501':
   *         description: Async execution not available
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               success: false
   *               error: "Async execution is not available (task queue not initialized)"
   *       '500':
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               success: false
   *               error: "Failed to create async task"
   */
  // POST /api/async/messages - 异步执行
  router.post('/', async (req, res) => {
    const {
      prompt,
      project_path,
      model,
      session_id,
      system_prompt,
      max_budget_usd,
      allowed_tools,
      disallowed_tools,
      agent,
      mcp_config,
      webhook_url,
      priority,
    } = req.body;

    // 验证请求
    const validation = Validators.validateClaudeRequest(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error,
      });
    }

    const projectPath = project_path || config.defaultProjectPath;

    // 检查任务队列是否可用
    if (!taskQueue) {
      return res.status(501).json({
        success: false,
        error: 'Async execution is not available (task queue not initialized)',
      });
    }

    // 自动创建会话（如果没有 session_id）
    let sessionId = session_id;
    if (!sessionId && sessionManager) {
      try {
        const session = await sessionManager.createSession({
          project_path: projectPath,
          model: model || config.defaultModel,
          metadata: {
            auto_created: true,
          },
        });
        sessionId = session.id;
      } catch (error) {
        // 如果创建会话失败，继续执行但不使用会话
        console.error('Failed to auto-create session:', error.message);
      }
    }

    try {
      // 创建异步任务
      const task = await taskQueue.addTask({
        prompt,
        project_path: projectPath,
        model,
        priority: priority || 5, // 默认优先级 5
        metadata: {
          webhook_url: webhook_url || config.webhook?.defaultUrl,
          session_id: sessionId,
          system_prompt,
          max_budget_usd,
          allowed_tools,
          disallowed_tools,
          agent,
          mcp_config,
        },
      });

      return res.status(202).json({
        success: true,
        message: 'Task created successfully',
        task_id: task.id,
        status: task.status,
        priority: task.priority,
        session_id: sessionId,
        webhook_url: task.metadata.webhook_url,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  return router;
}

module.exports = { createClaudeRoutes, createAsyncClaudeRoutes };
