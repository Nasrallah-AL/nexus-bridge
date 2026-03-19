const express = require('express');
const { getMcpConfig, getMcpSummaryWithRuntime } = require('../utils/apiDiscovery');

/**
 * Create MCP management routes.
 */
function createMcpRoutes(config) {
  const router = express.Router();

  /**
   * @swagger
   * /api/mcp:
   *   get:
   *     summary: Get MCP runtime status
   *     tags: [MCP]
   *     responses:
   *       '200':
   *         description: MCP status summary
   */
  router.get('/', async (req, res) => {
    try {
      res.json({
        success: true,
        mcp: await getMcpSummaryWithRuntime(config),
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
   * /api/mcp/config:
   *   get:
   *     summary: Get the redacted MCP config file contents
   *     tags: [MCP]
   *     responses:
   *       '200':
   *         description: MCP config file contents
   *       '404':
   *         description: MCP config file not found or not configured
   */
  router.get('/config', (req, res) => {
    const result = getMcpConfig(config);
    if (!result.found) {
      return res.status(404).json({
        success: false,
        error: result.error,
        resolvedConfigPath: result.resolvedConfigPath || null,
      });
    }

    res.json({
      success: true,
      resolvedConfigPath: result.resolvedConfigPath,
      servers: result.servers,
      config: result.config,
    });
  });

  return router;
}

module.exports = createMcpRoutes;

