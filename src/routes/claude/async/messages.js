const router = require('express').Router();
const { validateAndParseRequest } = require('../common/validators');
const { ensureSession } = require('../common/session');

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
 *             type: object
 *             required:
 *               - prompt
 *             properties:
 *               prompt:
 *                 type: string
 *               project_path:
 *                 type: string
 *               priority:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 10
 *                 default: 5
 *               webhook_url:
 *                 type: string
 *                 format: uri
 *     responses:
 *       '202':
 *         description: Async task created successfully
 *       '501':
 *         description: Async execution not available
 */
function createAsyncMessagesRoute(claudeExecutor, config, taskQueue, sessionManager, providerRouter) {
  router.post('/', async (req, res) => {
    // 使用公共验证逻辑
    const validated = validateAndParseRequest(req, res, config);
    if (!validated) return; // 验证失败，响应已发送

    // 检查任务队列是否可用
    if (!taskQueue) {
      return res.status(501).json({
        success: false,
        error: 'Async execution is not available (task queue not initialized)',
      });
    }

    // 确保 Session 存在
    const sessionId = await ensureSession(
      sessionManager,
      validated.sessionId,
      validated.projectPath,
      validated.model,
      config
    );

    // 先保存用户消息（在创建任务前）
    if (sessionManager?.messageStore && sessionId) {
      try {
        await sessionManager.messageStore.addMessage(sessionId, {
          role: 'user',
          content: validated.prompt,
          metadata: {
            prompt: validated.prompt,
            project_path: validated.projectPath,
            model: validated.model,
          },
        });
      } catch (msgErr) {
        // 消息存储失败不影响主流程
        console.error('Failed to save user message:', msgErr.message);
      }
    }

    // Select provider for load balancing
    const provider = providerRouter ? providerRouter.select(sessionId) : null;

    try {
      // 创建异步任务
      const task = await taskQueue.addTask({
        prompt: validated.prompt,
        project_path: validated.projectPath,
        model: validated.model,
        priority: req.body.priority || 5,
        metadata: {
          webhook_url: req.body.webhook_url || config.webhook?.defaultUrl,
          session_id: sessionId,
          system_prompt: validated.systemPrompt,
          max_budget_usd: validated.maxBudgetUsd,
          allowed_tools: validated.allowedTools,
          disallowed_tools: validated.disallowedTools,
          agent: validated.agent,
          mcp_config: validated.mcpConfig,
          permission_mode: validated.permissionMode,
          provider,
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

module.exports = createAsyncMessagesRoute;
