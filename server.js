const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const chalk = require('chalk');
const { generateSecretKey, deriveApiKey } = require('./src/utils/keyGenerator');

// 配置目录和文件
const configDir = path.join(process.env.HOME || os.homedir(), '.claude-code-server');
const configPath = path.join(configDir, 'config.json');

// 默认配置（用于未找到路径时的回退）
// 注意：这些路径会在 loadConfig() 中动态修正
const defaultConfig = {
  port: 5546,
  host: '0.0.0.0',
  trustProxy: 1, // Trust first reverse proxy (number for security, not boolean)
  claudePath: path.join(process.env.HOME || os.homedir(), '.nvm', 'versions', 'node', 'v22.21.0', 'bin', 'claude'),
  nvmBin: path.join(process.env.HOME || os.homedir(), '.nvm', 'versions', 'node', 'v22.21.0', 'bin'),
  workspacePath: path.join(process.env.HOME || os.homedir(), '.claude-code-server', 'workspace'),
  logFile: path.join(process.env.HOME || os.homedir(), '.claude-code-server', 'logs', 'server.log'),
  pidFile: path.join(process.env.HOME || os.homedir(), '.claude-code-server', 'server.pid'),
  dataDir: path.join(process.env.HOME || os.homedir(), '.claude-code-server', 'data'),
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

// 加载配置（支持异步路径检测）
async function loadConfig() {
  // 确保所有必要目录都存在
  const dirsToCreate = [
    configDir,
    path.join(process.env.HOME || os.homedir(), '.claude-code-server', 'logs'),
    path.join(process.env.HOME || os.homedir(), '.claude-code-server', 'data'),
  ];

  for (const dir of dirsToCreate) {
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`✅ 创建目录: ${dir}`);
      } catch (err) {
        console.error(`❌ 创建目录失败 ${dir}:`, err.message);
        // 尝试继续，不中断流程
      }
    }
  }

  let config;
  if (!fs.existsSync(configPath)) {
    // 首次启动，使用默认配置
    config = { ...defaultConfig };
    config.security.auth.secretKey = generateSecretKey();
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log(`✅ 创建配置文件: ${configPath}`);
      console.log(`✅ 已自动生成 SECRET_KEY`);
      const apiKey = deriveApiKey(config.security.auth.secretKey);
      console.log(`📝 API Key: ${apiKey}`);
    } catch (err) {
      console.error(`❌ 创建配置文件失败 ${configPath}:`, err.message);
      throw err;
    }
  } else {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!config.security) {
      config.security = { auth: { enabled: false, bypassHealthCheck: true } };
    }
    if (!config.security.auth) {
      config.security.auth = { enabled: false, bypassHealthCheck: true };
    }
    if (!config.security.auth.secretKey) {
      config.security.auth.secretKey = generateSecretKey();
      try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log(`✅ 已自动生成 SECRET_KEY (迁移)`);
        const apiKey = deriveApiKey(config.security.auth.secretKey);
        console.log(`📝 API Key: ${apiKey}`);
      } catch (err) {
        console.error(`❌ 更新配置失败 ${configPath}:`, err.message);
      }
    }
    // Migrate swaggerDocs config if not present
    if (config.security && !config.security.swaggerDocs) {
      config.security.swaggerDocs = { enabled: true };
      try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log(`✅ 已添加 swaggerDocs 配置 (默认启用)`);
      } catch (err) {
        console.error(`❌ 更新配置失败 ${configPath}:`, err.message);
      }
    }
  }

  // 自动检测和修复路径
  const PathResolver = require('./src/utils/pathResolver');
  const resolver = new PathResolver();
  const results = await resolver.detectAndValidate(config);
  const { updates, warnings } = resolver.applyDetectionResults(config, results);

  // 如果路径有更新，保存配置（排除 _pathDetection）
  if (updates.length > 0) {
    const configToSave = { ...config };
    delete configToSave._pathDetection;
    try {
      fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 2));
      console.log(`✅ 配置已更新: ${configPath}`);
    } catch (err) {
      console.error(`❌ 更新配置失败 ${configPath}:`, err.message);
    }
  }

  // 保存诊断信息用于日志输出
  config._pathDetection = { updates, warnings };

  // 兼容旧配置：如果有 defaultProjectPath，迁移到 workspacePath
  if (config.defaultProjectPath) {
    if (!config.workspacePath) {
      config.workspacePath = config.defaultProjectPath;
    }
    delete config.defaultProjectPath;
    // 保存更新后的配置（排除 _pathDetection）
    const configToSave = { ...config };
    delete configToSave._pathDetection;
    try {
      fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 2));
      console.log(`✅ 已迁移 defaultProjectPath → workspacePath`);
    } catch (err) {
      console.error(`❌ 更新配置失败:`, err.message);
    }
  }

  // 展开 workspacePath 中的 ~ 符号
  if (config.workspacePath && config.workspacePath.startsWith('~')) {
    config.workspacePath = path.join(os.homedir(), config.workspacePath.substring(2));
  }

  // 确保 workspacePath 存在，不存在则使用默认值
  if (!config.workspacePath) {
    config.workspacePath = path.join(process.env.HOME || os.homedir(), '.claude-code-server', 'workspace');
  }

  // 确保工作空间目录存在
  if (!fs.existsSync(config.workspacePath)) {
    try {
      fs.mkdirSync(config.workspacePath, { recursive: true });
      console.log(`✅ 已创建工作空间目录: ${config.workspacePath}`);
    } catch (err) {
      console.error(`❌ 创建工作空间目录失败:`, err.message);
    }
  }

  // Environment variable overrides (take precedence)
  if (process.env.CCS_SECRET_KEY) {
    config.security.auth.secretKey = process.env.CCS_SECRET_KEY;
  }
  if (process.env.CCS_AUTH_ENABLED !== undefined) {
    config.security.auth.enabled = process.env.CCS_AUTH_ENABLED === 'true';
  }

  return config;
}

// 主初始化函数
async function main() {
  // 加载配置（包含路径自动检测）
  const config = await loadConfig();

  // 确保日志目录存在
  if (config.logFile) {
    const logDir = path.dirname(config.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  // 获取 logger
  const getLogger = require('./src/utils/logger');
  const logger = getLogger({ logFile: config.logFile, logLevel: config.logLevel });

  // 输出路径检测结果
  if (config._pathDetection.updates.length > 0) {
    logger.info('Auto-detected paths:', { updates: config._pathDetection.updates });
  }
  if (config._pathDetection.warnings.length > 0) {
    logger.warn('Path detection warnings:', { warnings: config._pathDetection.warnings });
  }

  // 删除内部诊断信息
  delete config._pathDetection;

  // 重置所有服务模块的缓存（确保后台模式使用正确的配置）
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

  // 初始化存储
  const SessionStore = require('./src/storage/sessionStore');
  const TaskStore = require('./src/storage/taskStore');
  const StatsStore = require('./src/storage/statsStore');
  const MessageStore = require('./src/storage/messageStore');

  const sessionStore = new SessionStore(config.dataDir + '/sessions');
  const taskStore = new TaskStore(config.dataDir + '/tasks');
  const statsStore = new StatsStore(config.dataDir + '/statistics');
  const messageStore = new MessageStore(config.dataDir + '/messages');

  // 初始化服务
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

  // 加载路由
  const createHealthRoute = require('./src/routes/health');
  const createConfigRoute = require('./src/routes/config');
  const { createClaudeRoutes, createAsyncClaudeRoutes } = require('./src/routes/claude');
  const createSessionRoutes = require('./src/routes/sessions');
  const createProjectsRoutes = require('./src/routes/projects');
  const createStatisticsRoutes = require('./src/routes/statistics');
  const createTaskRoutes = require('./src/routes/tasks');
  const createAuthMiddleware = require('./src/middleware/auth');

  // 创建 Express 应用
  const app = express();
  const PORT = process.env.PORT || config.port;
  const HOST = process.env.HOST || config.host;

  // Trust proxy - required when behind reverse proxy (nginx, etc.)
  // This allows express-rate-limit to correctly identify client IP from X-Forwarded-For
  // Use number (e.g., 1 = trust first proxy) instead of boolean for security
  app.set('trust proxy', config.trustProxy ?? 1);

  // 中间件
  app.use(express.json({ limit: '10mb' })); // Prevent DoS attacks with large payloads

  // Create authentication middleware
  const authMiddleware = createAuthMiddleware(config, auditLogger);

  // Apply authentication to all /api/* routes
  // Must come after body parser, before route mounting
  app.use('/api/', authMiddleware);

  // 应用速率限制
  app.use('/api/', rateLimiter.getMiddleware());

  // 挂载路由
  app.get('/health', createHealthRoute());
  app.get('/api/config', createConfigRoute(configPath));
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
    customSiteTitle: 'Claude Code Server API Documentation',
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

  // 配置热重载
  let configWatcher = null;
  let reloadCount = 0;

  // 热重载配置
  async function hotReloadConfig() {
    try {
      reloadCount++;

      // 重新加载配置
      const newConfig = await loadConfig();

      // 检查关键配置变化
      const configChanges = [];

      // workspacePath 变化检测
      if (newConfig.workspacePath !== config.workspacePath) {
        configChanges.push(`workspacePath: ${config.workspacePath} → ${newConfig.workspacePath}`);
      }

      if (newConfig.taskQueue?.concurrency !== config.taskQueue?.concurrency) {
        configChanges.push(`taskQueue.concurrency: ${config.taskQueue?.concurrency} → ${newConfig.taskQueue?.concurrency}`);
        // 更新 TaskQueue 并发数
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
          configChanges.push(`webhook.defaultUrl: ${config.webhook?.defaultUrl || '(未设置)'} → ${newConfig.webhook?.defaultUrl || '(未设置)'}`);
        }
        // 更新 WebhookNotifier 配置
        webhookNotifier.updateConfig(newConfig);
      }
      if (newConfig.logLevel !== config.logLevel) {
        configChanges.push(`logLevel: ${config.logLevel} → ${newConfig.logLevel}`);
      }
      if (newConfig.security?.swaggerDocs?.enabled !== config.security?.swaggerDocs?.enabled) {
        configChanges.push(`security.swaggerDocs.enabled: ${config.security?.swaggerDocs?.enabled} → ${newConfig.security?.swaggerDocs?.enabled}`);
        configChanges.push(`Swagger 文档访问: ${newConfig.security.swaggerDocs.enabled === false ? '已禁用' : '已启用'} (实时生效)`);
      }
      if (JSON.stringify(newConfig.providers) !== JSON.stringify(config.providers) ||
          JSON.stringify(newConfig.loadBalance) !== JSON.stringify(config.loadBalance)) {
        configChanges.push('providers/loadBalance configuration changed');
        // Use updateConfig method for proper hot reload
        providerRouter.updateConfig(newConfig);
      }

      // 更新配置对象（保留引用）
      Object.assign(config, newConfig);

      if (configChanges.length > 0) {
        logger.info(`[Config Reload #${reloadCount}] 配置已更新:`, { changes: configChanges });
      } else {
        logger.info(`[Config Reload #${reloadCount}] 配置文件已重新加载（无变化）`);
      }

      logger.info(`[Config Reload #${reloadCount}] 当前任务队列并发数: ${taskQueue.concurrency}`);
    } catch (error) {
      const logger = require('./src/utils/logger')({ logFile: config.logFile, logLevel: 'error' });
      logger.error(`[Config Reload #${reloadCount}] 配置重载失败:`, { error: error.message });
    }
  }

  // 启动配置文件监听
  function startConfigWatcher() {
    if (configWatcher) {
      return; // 已经在监听
    }

    try {
      // 使用防抖，避免多次触发
      let reloadTimer = null;
      const DEBOUNCE_DELAY = 500; // 500ms 防抖

      configWatcher = fs.watch(configPath, (eventType, filename) => {
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
      logger.info(`配置文件监听已启动: ${configPath}`);
      logger.info('配置文件修改将自动生效（热重载）');
    } catch (error) {
      const logger = require('./src/utils/logger')({ logFile: config.logFile, logLevel: 'error' });
      logger.error('启动配置文件监听失败:', { error: error.message });
    }
  }

// 启动服务器
  const server = app.listen(PORT, HOST, async () => {
    // 初始化存储
    await sessionStore.init();
    await taskStore.init();
    await statsStore.init();
    await messageStore.init();

    const logger = require('./src/utils/logger')({ logFile: config.logFile, logLevel: config.logLevel });
    logger.info(`Claude Code Server started on http://${HOST}:${PORT}`);
    logger.info(`Claude path: ${config.claudePath}`);
    logger.info(`Workspace: ${config.workspacePath}`);

    // 启动统计收集器
    statisticsCollector.start();

    // 启动任务队列
    await taskQueue.start();

    // 启动配置文件监听
    startConfigWatcher();

    // 写入 PID 文件
    if (config.pidFile) {
      const pidDir = path.dirname(config.pidFile);
      if (!fs.existsSync(pidDir)) {
        fs.mkdirSync(pidDir, { recursive: true });
      }
      fs.writeFileSync(config.pidFile, process.pid.toString());
    }
  });

  // 优雅关闭
  async function shutdown(signal) {
    const logger = require('./src/utils/logger')({ logFile: config.logFile, logLevel: config.logLevel });
    logger.info(`${signal} received, shutting down gracefully...`);

    // 停止配置文件监听
    if (configWatcher) {
      configWatcher.close();
      configWatcher = null;
      logger.info('配置文件监听已停止');
    }

    // 停止统计收集器
    statisticsCollector.stop();

    // 停止任务队列
    await taskQueue.stop();

    server.close(() => {
      logger.info('Server closed');

      // 删除 PID 文件
      if (fs.existsSync(config.pidFile)) {
        fs.unlinkSync(config.pidFile);
      }
      process.exit(0);
    });

    // 强制退出超时
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = main;

// 如果直接运行此文件，捕获错误
if (require.main === module) {
  main().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
