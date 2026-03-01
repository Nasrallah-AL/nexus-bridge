const router = require('express').Router();

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
 *             type: object
 *             required:
 *               - prompts
 *             properties:
 *               prompts:
 *                 type: array
 *                 description: Array of prompts to execute
 *                 minItems: 1
 *                 maxItems: 10
 *                 items:
 *                   type: string
 *                 example: ["Explain what HTTP is", "What is HTTPS?", "What is a REST API?"]
 *               project_path:
 *                 type: string
 *                 description: Project working directory (absolute path, applied to all prompts)
 *                 example: "/Users/john/my-project"
 *               model:
 *                 type: string
 *                 description: Claude model to use (applied to all prompts)
 *                 example: "claude-sonnet-4-5"
 *     responses:
 *       '200':
 *         description: Batch execution completed
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
 *                   items:
 *                     type: object
 *                   example: [...]
 *                 summary:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                       example: 3
 *                     successful:
 *                       type: integer
 *                       example: 3
 *                     failed:
 *                       type: integer
 *                       example: 0
 *                     total_cost_usd:
 *                       type: number
 *                       example: 0.2963
 *                     total_duration_ms:
 *                       type: integer
 *                       example: 5929
 */
function createBatchesRoute(claudeExecutor, config) {
  router.post('/', async (req, res) => {
    const { validateBatchRequest, validateProjectPath } = require('../../../utils/validators');

    // 验证请求
    const validation = validateBatchRequest(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error,
      });
    }

    const { prompts, project_path, model } = validation.value;

    // 验证并解析项目路径（必须在工作空间下）
    const pathValidation = validateProjectPath(project_path, config.workspacePath);

    if (!pathValidation.valid) {
      return res.status(400).json({
        success: false,
        error: pathValidation.error,
      });
    }

    const projectPath = pathValidation.fullPath;

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

module.exports = createBatchesRoute;
