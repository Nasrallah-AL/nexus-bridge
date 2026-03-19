const fs = require('fs');
const express = require('express');
const {
  getFeatureSummary,
  getProviderSummaries,
  getSafeConfig,
} = require('../utils/apiDiscovery');
const { getEffectiveNodeBinDir } = require('../utils/runtimePaths');

/**
 * Create config routes.
 * @param {Object} config - Live runtime config object
 * @param {string} configPath - Path to config file
 * @param {Object|null} providerRouter - Provider router instance
 */
function createConfigRoute(config, configPath, providerRouter = null) {
  const router = express.Router();

  /**
   * @swagger
   * /api/config:
   *   get:
   *     summary: Get the effective runtime configuration
   *     tags: [Config]
   *     responses:
   *       '200':
   *         description: Redacted runtime configuration
   */
  router.get('/', (req, res) => {
    try {
      const fileExists = fs.existsSync(configPath);
      const fileStats = fileExists ? fs.statSync(configPath) : null;

      res.json({
        success: true,
        config: getSafeConfig(config),
        metadata: {
          configPath,
          exists: fileExists,
          lastModified: fileStats ? fileStats.mtime.toISOString() : null,
          effectiveNodeBinDir: getEffectiveNodeBinDir(config),
        },
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
   * /api/config/features:
   *   get:
   *     summary: Get enabled feature flags and runtime toggles
   *     tags: [Config]
   *     responses:
   *       '200':
   *         description: Feature summary
   */
  router.get('/features', (req, res) => {
    res.json({
      success: true,
      features: getFeatureSummary(config, providerRouter),
    });
  });

  /**
   * @swagger
   * /api/config/providers:
   *   get:
   *     summary: Get redacted provider configuration summaries
   *     tags: [Config]
   *     responses:
   *       '200':
   *         description: Provider configuration summaries
   */
  router.get('/providers', (req, res) => {
    const providers = getProviderSummaries(config, providerRouter);
    res.json({
      success: true,
      providers,
      count: providers.length,
    });
  });

  return router;
}

module.exports = createConfigRoute;
