const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { generateSecretKey, deriveApiKey } = require('./src/utils/keyGenerator');
const { syncNodeBinConfig } = require('./src/utils/runtimePaths');

// Configuration directory and files
const runtimeDirName = '.nexus-bridge';
const configDir = path.join(process.env.HOME || os.homedir(), runtimeDirName);
const configPath = path.join(configDir, 'config.json');

// Default configuration used as a fallback when paths are not found
// Note: these paths are adjusted dynamically in loadConfig()
const defaultConfig = {
  port: 5546,
  host: '0.0.0.0',
  trustProxy: 1, // Trust first reverse proxy (number for security, not boolean)
  claudePath: 'claude',
  nodeBinDir: null,
  nvmBin: null,
  workspacePath: path.join(process.env.HOME || os.homedir(), runtimeDirName, 'workspace'),
  logFile: path.join(process.env.HOME || os.homedir(), runtimeDirName, 'logs', 'server.log'),
  pidFile: path.join(process.env.HOME || os.homedir(), runtimeDirName, 'server.pid'),
  dataDir: path.join(process.env.HOME || os.homedir(), runtimeDirName, 'data'),
  sessionRetentionDays: 30,
  security: {
    auth: {
      enabled: false,
      secretKey: null,
      bypassHealthCheck: true
    },
    swaggerDocs: {
      enabled: true
    }
  }
};

// Load configuration (supports async path detection)
async function loadConfig() {
  // Ensure all required directories exist
  const dirsToCreate = [
    configDir,
    path.join(process.env.HOME || os.homedir(), runtimeDirName, 'logs'),
    path.join(process.env.HOME || os.homedir(), runtimeDirName, 'data'),
  ];

  for (const dir of dirsToCreate) {
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`✅ Created directory: ${dir}`);
      } catch (err) {
        console.error(`❌ Failed to create directory ${dir}:`, err.message);
        // Try to continue without interrupting startup
      }
    }
  }

  let config;
  if (!fs.existsSync(configPath)) {
    // First startup: use the default configuration
    config = { ...defaultConfig };
    config.security.auth.secretKey = generateSecretKey();
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log(`✅ Created config file: ${configPath}`);
      console.log(`✅ Automatically generated SECRET_KEY`);
      const apiKey = deriveApiKey(config.security.auth.secretKey);
      console.log(`📝 API Key: ${apiKey}`);
    } catch (err) {
      console.error(`❌ Failed to create config file ${configPath}:`, err.message);
      throw err;
    }
  } else {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    let configUpdated = false;
    if (!config.security) {
      config.security = { auth: { enabled: false, bypassHealthCheck: true } };
      configUpdated = true;
    }
    if (!config.security.auth) {
      config.security.auth = { enabled: false, bypassHealthCheck: true };
      configUpdated = true;
    }
    if (!config.security.auth.secretKey) {
      config.security.auth.secretKey = generateSecretKey();
      configUpdated = true;
      try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log(`✅ Automatically generated SECRET_KEY (migration)`);
        const apiKey = deriveApiKey(config.security.auth.secretKey);
        console.log(`📝 API Key: ${apiKey}`);
      } catch (err) {
        console.error(`❌ Failed to update config ${configPath}:`, err.message);
      }
    }
    // Migrate swaggerDocs config if not present
    if (config.security && !config.security.swaggerDocs) {
      config.security.swaggerDocs = { enabled: true };
      configUpdated = true;
      try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log(`✅ Added swaggerDocs configuration (enabled by default)`);
      } catch (err) {
        console.error(`❌ Failed to update config ${configPath}:`, err.message);
      }
    }

    if (!config.claudePath) {
      config.claudePath = defaultConfig.claudePath;
      configUpdated = true;
    }

    const syncResult = syncNodeBinConfig(config);
    if (syncResult.changed) {
      configUpdated = true;
    }

    if (configUpdated) {
      try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      } catch (err) {
        console.error(`❌ Failed to update config ${configPath}:`, err.message);
      }
    }
  }

  // Automatically detect and repair paths
  const PathResolver = require('./src/utils/pathResolver');
  const resolver = new PathResolver();
  const results = await resolver.detectAndValidate(config);
  const { updates, warnings } = resolver.applyDetectionResults(config, results);

  // If any paths were updated, save the config (excluding _pathDetection)
  if (updates.length > 0) {
    const configToSave = { ...config };
    delete configToSave._pathDetection;
    try {
      fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 2));
      console.log(`✅ Configuration updated: ${configPath}`);
    } catch (err) {
      console.error(`❌ Failed to update config ${configPath}:`, err.message);
    }
  }

  // Save diagnostic information for logging
  config._pathDetection = { updates, warnings };

  syncNodeBinConfig(config);

  // Backward compatibility: migrate defaultProjectPath to workspacePath
  if (config.defaultProjectPath) {
    if (!config.workspacePath) {
      config.workspacePath = config.defaultProjectPath;
    }
    delete config.defaultProjectPath;
    // Save the updated config (excluding _pathDetection)
    const configToSave = { ...config };
    delete configToSave._pathDetection;
    try {
      fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 2));
      console.log(`✅ Migrated defaultProjectPath → workspacePath`);
    } catch (err) {
      console.error(`❌ Failed to update config:`, err.message);
    }
  }

  // Expand `~` in workspacePath
  if (config.workspacePath && config.workspacePath.startsWith('~')) {
    config.workspacePath = path.join(os.homedir(), config.workspacePath.substring(2));
  }

  // Ensure workspacePath exists, otherwise fall back to the default
  if (!config.workspacePath) {
    config.workspacePath = path.join(process.env.HOME || os.homedir(), runtimeDirName, 'workspace');
  }

  // Ensure the workspace directory exists
  if (!fs.existsSync(config.workspacePath)) {
    try {
      fs.mkdirSync(config.workspacePath, { recursive: true });
      console.log(`✅ Created workspace directory: ${config.workspacePath}`);
    } catch (err) {
      console.error(`❌ Failed to create workspace directory:`, err.message);
    }
  }

  // Environment variable overrides (take precedence)
  if (process.env.NEXUS_BRIDGE_SECRET_KEY) {
    config.security.auth.secretKey = process.env.NEXUS_BRIDGE_SECRET_KEY;
  }
  if (process.env.NEXUS_BRIDGE_AUTH_ENABLED !== undefined) {
    config.security.auth.enabled = process.env.NEXUS_BRIDGE_AUTH_ENABLED === 'true';
  }

  return config;
}

// Main initialization function
async function main() {
  // Load configuration, including automatic path detection
  const config = await loadConfig();

  // Ensure the log directory exists
  if (config.logFile) {
    const logDir = path.dirname(config.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  // Get the logger
  const getLogger = require('./src/utils/logger');
  const logger = getLogger({ logFile: config.logFile, logLevel: config.logLevel });

  // Log path detection results
  if (config._pathDetection.updates.length > 0) {
    logger.info('Auto-detected paths:', { updates: config._pathDetection.updates });
  }
  if (config._pathDetection.warnings.length > 0) {
    logger.warn('Path detection warnings:', { warnings: config._pathDetection.warnings });
  }

  // Remove internal diagnostic information
  delete config._pathDetection;

  // Reset cached service modules so background mode uses the correct config
  const modulePaths = [
    './src/utils/logger',
    './src/services/claudeExecutor',
    './src/services/sessionManager',
    './src/services/rateLimiter',
    './src/services/statisticsCollector',
    './src/services/taskQueue',
    './src/services/webhookNotifier',
    './src/services/auditLogger',
    './src/services/providerRouter',
    './src/storage/sessionStore',
    './src/storage/taskStore',
    './src/storage/statsStore',
    './src/storage/messageStore',
  ];

  modulePaths.forEach(modPath => {
    delete require.cache[require.resolve(modPath)];
  });

  // Initialize storage
  const SessionStore = require('./src/storage/sessionStore');
  const TaskStore = require('./src/storage/taskStore');
  const StatsStore = require('./src/storage/statsStore');
  const MessageStore = require('./src/storage/messageStore');

  const sessionStore = new SessionStore(config.dataDir + '/sessions');
  const taskStore = new TaskStore(config.dataDir + '/tasks');
  const statsStore = new StatsStore(config.dataDir + '/statistics');
  const messageStore = new MessageStore(config.dataDir + '/messages');

  // Initialize services
  const ClaudeExecutor = require('./src/services/claudeExecutor');
  const SessionManager = require('./src/services/sessionManager');
  const RateLimiter = require('./src/services/rateLimiter');
  const StatisticsCollector = require('./src/services/statisticsCollector');
  const TaskQueue = require('./src/services/taskQueue');
  const WebhookNotifier = require('./src/services/webhookNotifier');
  const AuditLogger = require('./src/services/auditLogger');
  const StreamManager = require('./src/services/streamManager');

  const claudeExecutor = new ClaudeExecutor(config, sessionStore, statsStore, messageStore);
  const rateLimiter = new RateLimiter(config);
  const statisticsCollector = new StatisticsCollector(config, statsStore);
  const webhookNotifier = new WebhookNotifier(config);

  // Initialize ProviderRouter early (needed by SessionManager and TaskQueue)
  const ProviderRouter = require('./src/services/providerRouter');
  const providerRouter = new ProviderRouter(config);

  // SessionManager needs providerRouter for provider isolation
  const sessionManager = new SessionManager(config, sessionStore, claudeExecutor, messageStore, providerRouter);

  const taskQueue = new TaskQueue(config, taskStore, claudeExecutor, webhookNotifier, providerRouter);
  const auditLogger = new AuditLogger(config, statsStore);
  const streamManager = new StreamManager(config);

  // Load routes
  const createHealthRoute = require('./src/routes/health');
  const createConfigRoute = require('./src/routes/config');
  const createModelRoutes = require('./src/routes/models');
  const createMcpRoutes = require('./src/routes/mcp');
  const { createClaudeRoutes, createAsyncClaudeRoutes } = require('./src/routes/claude');
  const createSessionRoutes = require('./src/routes/sessions');
  const createProjectsRoutes = require('./src/routes/projects');
  const createStatisticsRoutes = require('./src/routes/statistics');
  const createTaskRoutes = require('./src/routes/tasks');
  const createAuthMiddleware = require('./src/middleware/auth');

  // Create the Express application
  const app = express();
  const PORT = process.env.PORT || config.port;
  const HOST = process.env.HOST || config.host;

  // Trust proxy - required when behind reverse proxy (nginx, etc.)
  // This allows express-rate-limit to correctly identify client IP from X-Forwarded-For
  // Use number (e.g., 1 = trust first proxy) instead of boolean for security
  app.set('trust proxy', config.trustProxy ?? 1);

  // Middleware
  app.use(express.json({ limit: '10mb' })); // Prevent DoS attacks with large payloads

  // Create authentication middleware
  const authMiddleware = createAuthMiddleware(config, auditLogger);

  // Apply authentication to all /api/* routes
  // Must come after body parser, before route mounting
  app.use('/api/', authMiddleware);

  // Apply rate limiting
  app.use('/api/', rateLimiter.getMiddleware());

  // Mount routes
  app.get('/health', createHealthRoute());
  app.use('/api/config', createConfigRoute(config, configPath, providerRouter));
  app.use('/api/models', createModelRoutes(config, statisticsCollector));
  app.use('/api/mcp', createMcpRoutes(config));
  // Synchronous messages and batch processing
  app.use('/api/messages', createClaudeRoutes(claudeExecutor, config, null, sessionManager, providerRouter));
  // Asynchronous message processing
  app.use('/api/async/messages', createAsyncClaudeRoutes(claudeExecutor, config, taskQueue, sessionManager, providerRouter));
  app.use('/api/sessions', createSessionRoutes(sessionManager, messageStore, streamManager, providerRouter));
  app.use('/api/projects', createProjectsRoutes(sessionStore, config, messageStore));
  app.use('/api/statistics', createStatisticsRoutes(statisticsCollector));
  app.use('/api/tasks', createTaskRoutes(taskQueue));
  // Load balance management API
  const createLoadBalanceRoutes = require('./src/routes/loadBalance');
  app.use('/api/load-balance', createLoadBalanceRoutes(providerRouter));

  // Swagger API Documentation
  const swaggerUi = require('swagger-ui-express');
  const swaggerSpec = require('./swagger-config');

  // Middleware to check if Swagger docs are enabled
  const swaggerDocsMiddleware = (req, res, next) => {
    if (config.security?.swaggerDocs?.enabled === false) {
      return res.status(404).json({ error: 'Not Found', message: 'Swagger Documentation is disabled' });
    }
    next();
  };

  // Serve Swagger UI (with middleware check)
  app.use('/api-docs', swaggerDocsMiddleware, swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'Nexus Bridge API Documentation',
    customCss: '.swagger-ui .topbar { display: none }',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'list',
      filter: true,
      showRequestHeaders: true,
      tryItOutEnabled: true
    }
  }));

  // Serve raw OpenAPI JSON spec (with middleware check)
  app.get('/api-docs.json', swaggerDocsMiddleware, (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  const swaggerDocsStatus = config.security?.swaggerDocs?.enabled === false ? 'disabled' : 'enabled';
  logger.info(`Swagger Documentation: ${swaggerDocsStatus} at /api-docs (hot-reload enabled)`);

  // Configuration hot reload
  let configWatcher = null;
  let reloadCount = 0;

  // Hot-reload the configuration
  async function hotReloadConfig() {
    try {
      reloadCount++;

      // Reload configuration
      const newConfig = await loadConfig();

      // Check for key configuration changes
      const configChanges = [];

      // Detect workspacePath changes
      if (newConfig.workspacePath !== config.workspacePath) {
        configChanges.push(`workspacePath: ${config.workspacePath} → ${newConfig.workspacePath}`);
      }

      if (newConfig.taskQueue?.concurrency !== config.taskQueue?.concurrency) {
        configChanges.push(`taskQueue.concurrency: ${config.taskQueue?.concurrency} → ${newConfig.taskQueue?.concurrency}`);
        // Update TaskQueue concurrency
        taskQueue.concurrency = newConfig.taskQueue?.concurrency || 3;
        taskQueue.defaultTimeout = newConfig.taskQueue?.defaultTimeout || 300000;
      }
      if (newConfig.rateLimit?.enabled !== config.rateLimit?.enabled) {
        configChanges.push(`rateLimit.enabled: ${config.rateLimit?.enabled} → ${newConfig.rateLimit?.enabled}`);
      }
      if (newConfig.webhook?.enabled !== config.webhook?.enabled ||
          newConfig.webhook?.defaultUrl !== config.webhook?.defaultUrl) {
        configChanges.push(`webhook.enabled: ${config.webhook?.enabled} → ${newConfig.webhook?.enabled}`);
        if (newConfig.webhook?.defaultUrl !== config.webhook?.defaultUrl) {
          configChanges.push(`webhook.defaultUrl: ${config.webhook?.defaultUrl || '(not set)'} → ${newConfig.webhook?.defaultUrl || '(not set)'}`);
        }
        // Update the WebhookNotifier configuration
        webhookNotifier.updateConfig(newConfig);
      }
      if (newConfig.logLevel !== config.logLevel) {
        configChanges.push(`logLevel: ${config.logLevel} → ${newConfig.logLevel}`);
      }
      if (newConfig.security?.swaggerDocs?.enabled !== config.security?.swaggerDocs?.enabled) {
        configChanges.push(`security.swaggerDocs.enabled: ${config.security?.swaggerDocs?.enabled} → ${newConfig.security?.swaggerDocs?.enabled}`);
        configChanges.push(`Swagger documentation access: ${newConfig.security.swaggerDocs.enabled === false ? 'disabled' : 'enabled'} (applied immediately)`);
      }
      if (JSON.stringify(newConfig.providers) !== JSON.stringify(config.providers) ||
          JSON.stringify(newConfig.loadBalance) !== JSON.stringify(config.loadBalance)) {
        configChanges.push('providers/loadBalance configuration changed');
        // Use updateConfig method for proper hot reload
        providerRouter.updateConfig(newConfig);
      }

      // Update the config object while preserving references
      Object.assign(config, newConfig);

      if (configChanges.length > 0) {
        logger.info(`[Config Reload #${reloadCount}] Configuration updated:`, { changes: configChanges });
      } else {
        logger.info(`[Config Reload #${reloadCount}] Configuration file reloaded (no changes)`);
      }

      logger.info(`[Config Reload #${reloadCount}] Current task queue concurrency: ${taskQueue.concurrency}`);
    } catch (error) {
      const logger = require('./src/utils/logger')({ logFile: config.logFile, logLevel: 'error' });
      logger.error(`[Config Reload #${reloadCount}] Configuration reload failed:`, { error: error.message });
    }
  }

  // Start watching the config file
  function startConfigWatcher() {
    if (configWatcher) {
      return; // Already watching
    }

    try {
      // Debounce events to avoid repeated triggers
      let reloadTimer = null;
      const DEBOUNCE_DELAY = 500; // 500ms debounce

      configWatcher = fs.watch(configPath, (eventType) => {
        if (eventType === 'change') {
          if (reloadTimer) {
            clearTimeout(reloadTimer);
          }
          reloadTimer = setTimeout(() => {
            hotReloadConfig();
            reloadTimer = null;
          }, DEBOUNCE_DELAY);
        }
      });
      const logger = require('./src/utils/logger')({ logFile: config.logFile, logLevel: config.logLevel });
      logger.info(`Config file watcher started: ${configPath}`);
      logger.info('Config file changes will be applied automatically (hot reload)');
    } catch (error) {
      const logger = require('./src/utils/logger')({ logFile: config.logFile, logLevel: 'error' });
      logger.error('Failed to start config file watcher:', { error: error.message });
    }
  }

// Start the server
  const server = app.listen(PORT, HOST, async () => {
    // Initialize storage
    await sessionStore.init();
    await taskStore.init();
    await statsStore.init();
    await messageStore.init();

    const logger = require('./src/utils/logger')({ logFile: config.logFile, logLevel: config.logLevel });
    logger.info(`Nexus Bridge started on http://${HOST}:${PORT}`);
    logger.info(`Claude path: ${config.claudePath}`);
    logger.info(`Workspace: ${config.workspacePath}`);

    // Start the statistics collector
    statisticsCollector.start();

    // Start the task queue
    await taskQueue.start();

    // Start the config file watcher
    startConfigWatcher();

    // Write the PID file
    if (config.pidFile) {
      const pidDir = path.dirname(config.pidFile);
      if (!fs.existsSync(pidDir)) {
        fs.mkdirSync(pidDir, { recursive: true });
      }
      fs.writeFileSync(config.pidFile, process.pid.toString());
    }
  });

  // Graceful shutdown
  async function shutdown(signal) {
    const logger = require('./src/utils/logger')({ logFile: config.logFile, logLevel: config.logLevel });
    logger.info(`${signal} received, shutting down gracefully...`);

    // Stop watching the config file
    if (configWatcher) {
      configWatcher.close();
      configWatcher = null;
      logger.info('Config file watcher stopped');
    }

    // Stop the statistics collector
    statisticsCollector.stop();

    // Stop the task queue
    await taskQueue.stop();

    server.close(() => {
      logger.info('Server closed');

      // Remove the PID file
      if (fs.existsSync(config.pidFile)) {
        fs.unlinkSync(config.pidFile);
      }
      process.exit(0);
    });

    // Forced shutdown timeout
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = main;

// If this file is run directly, catch startup errors
if (require.main === module) {
  main().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
