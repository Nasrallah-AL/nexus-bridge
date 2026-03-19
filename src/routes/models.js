const express = require('express');
const { getConfiguredModels, getObservedModels } = require('../utils/apiDiscovery');

/**
 * Create model discovery routes.
 */
function createModelRoutes(config, statsCollector = null) {
  const router = express.Router();

  /**
   * @swagger
   * /api/models:
   *   get:
   *     summary: List configured and observed models
   *     tags: [Models]
   *     parameters:
   *       - in: query
   *         name: observed_limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 100
   *           default: 10
   *         description: Maximum number of observed models to return from statistics
   *     responses:
   *       '200':
   *         description: Model inventory
   */
  router.get('/', async (req, res) => {
    try {
      const observedLimit = req.query.observed_limit ? parseInt(req.query.observed_limit, 10) : 10;
      const configuredModels = getConfiguredModels(config);
      const observedModels = statsCollector
        ? getObservedModels(await statsCollector.getTopModels(observedLimit))
        : [];

      res.json({
        success: true,
        default_model: config.defaultModel || null,
        configured_models: configuredModels,
        observed_models: observedModels,
        count: configuredModels.length,
        observed_count: observedModels.length,
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

module.exports = createModelRoutes;

