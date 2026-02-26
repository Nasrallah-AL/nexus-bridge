const Validators = require('../utils/validators');
const crypto = require('crypto');

/**
 * Claude API 路由
 */
function createClaudeRoutes(claudeExecutor, config, taskQueue = null, sessionManager = null) {
  const router = require('express').Router();

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
  // POST /api/claude - 单个请求（支持同步和异步）
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
      async: isAsync,
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

    // 异步执行模式
    if (isAsync) {
      if (!taskQueue) {
        return res.status(501).json({
          success: false,
          error: 'Async execution is not available (task queue not initialized)',
        });
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
          session_id: sessionId, // 返回 session_id
          webhook_url: task.metadata.webhook_url,
        });
      } catch (error) {
        return res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    }

    // 同步执行模式（默认）
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

  // POST /api/claude/batch - 批量处理
  router.post('/batch', async (req, res) => {
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

module.exports = createClaudeRoutes;
