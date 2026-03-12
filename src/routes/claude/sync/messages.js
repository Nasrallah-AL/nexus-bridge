const router = require('express').Router();
const { validateAndParseRequest } = require('../common/validators');
const { ensureSession } = require('../common/session');

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
 *             type: object
 *             required:
 *               - prompt
 *             properties:
 *               prompt:
 *                 type: string
 *                 example: "Explain what HTTP is"
 *               project_path:
 *                 type: string
 *                 example: "/Users/john/my-project"
 *               session_id:
 *                 type: string
 *                 format: uuid
 *                 example: "550e8400-e29b-41d4-a716-446655440000"
 *               model:
 *                 type: string
 *                 example: "claude-sonnet-4-5"
 *               max_budget_usd:
 *                 type: number
 *                 minimum: 0
 *                 example: 10.0
 *               stream:
 *                 type: boolean
 *                 default: false
 *     responses:
 *       '200':
 *         description: Successful execution
 *       '400':
 *         description: Invalid request
 *       '500':
 *         description: Server error
 *       '501':
 *         description: Feature not implemented (streaming)
 */
function createMessagesRoute(claudeExecutor, config, sessionManager, providerRouter) {
  router.post('/', async (req, res) => {
    // 使用公共验证逻辑
    const validated = validateAndParseRequest(req, res, config);
    if (!validated) return; // 验证失败，响应已发送

    // 流式输出暂不支持
    if (validated.stream) {
      return res.status(501).json({
        success: false,
        error: 'Streaming is not yet implemented',
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

    // 先保存用户消息（在执行前）
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

    // 同步执行
    const result = await claudeExecutor.execute({
      prompt: validated.prompt,
      projectPath: validated.projectPath,
      model: validated.model,
      sessionId: sessionId,
      systemPrompt: validated.systemPrompt,
      maxBudgetUsd: validated.maxBudgetUsd,
      allowedTools: validated.allowedTools,
      disallowedTools: validated.disallowedTools,
      agent: validated.agent,
      mcpConfig: validated.mcpConfig,
      permissionMode: validated.permissionMode,
      stream: validated.stream,
      provider,
      providerRouter,
    });

    // Record result for load balancing health tracking
    if (provider && providerRouter) {
      result.success
        ? providerRouter.recordSuccess(provider.id)
        : providerRouter.recordFailure(provider.id);
    }

    // 返回结果（包含 session_id）
    const statusCode = result.success ? 200 : 500;
    const responseData = result.success ? {
      ...result,
      session_id: sessionId,
    } : result;

    res.status(statusCode).json(responseData);
  });

  return router;
}

module.exports = createMessagesRoute;
