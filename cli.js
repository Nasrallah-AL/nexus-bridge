#!/usr/bin/env node

const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { generateSecretKey, deriveApiKey } = require('./src/utils/keyGenerator');
const { version } = require('./package.json');

// 配置目录和文件
const configDir = path.join(process.env.HOME || os.homedir(), '.claude-code-server');
const configPath = path.join(configDir, 'config.json');

/**
 * 构建带有认证的 fetch headers
 * 如果启用了 API 认证，自动添加 Authorization header
 */
function getAuthHeaders(config) {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (config.security?.auth?.enabled && config.security.auth.secretKey) {
    const apiKey = deriveApiKey(config.security.auth.secretKey);
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return headers;
}

/**
 * 认证的 fetch 封装
 */
async function authenticatedFetch(url, options = {}, config) {
  const headers = getAuthHeaders(config);

  const fetchOptions = {
    ...options,
    headers: {
      ...headers,
      ...options.headers,
    },
  };

  return fetch(url, fetchOptions);
}
const defaultConfig = {
  port: 5546,
  host: '0.0.0.0',
  claudePath: 'claude',  // 使用系统 PATH 中的 claude 命令
  nodeBinDir: null,  // 可选，Node.js bin 目录（如 /usr/local/bin 或 ~/.nvm/versions/node/v22.21.0/bin）
  workspacePath: path.join(process.env.HOME || os.homedir(), '.claude-code-server', 'workspace'),  // 工作空间根目录
  logFile: path.join(process.env.HOME || os.homedir(), '.claude-code-server', 'logs', 'server.log'),
  pidFile: path.join(process.env.HOME || os.homedir(), '.claude-code-server', 'server.pid'),
  dataDir: path.join(process.env.HOME || os.homedir(), '.claude-code-server', 'data'),
  sessionRetentionDays: 30,
  taskQueue: {
    concurrency: 3,
    defaultTimeout: 300000
  },
  rateLimit: {
    enabled: true,
    windowMs: 60000,
    maxRequests: 100
  },
  defaultModel: 'claude-sonnet-4-5',
  maxBudgetUsd: 10.0,
  webhook: {
    enabled: false,
    defaultUrl: null,
    timeout: 5000,
    retries: 3
  },
  statistics: {
    enabled: true,
    collectionInterval: 60000
  },
  mcp: {
    enabled: false,
    configPath: null
  },
  logLevel: 'info',
  allowDangerouslySkipPermissions: false,
  security: {
    auth: {
      enabled: false,
      secretKey: null,
      bypassHealthCheck: true
    }
  }
};

// 确保配置目录存在并加载配置
function loadConfig() {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  if (!fs.existsSync(configPath)) {
    // 创建默认配置文件
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    console.log(chalk.yellow(`已创建默认配置文件: ${configPath}`));
    return defaultConfig;
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.log(chalk.red(`配置文件损坏，正在重置: ${configPath}`));
    const backupPath = `${configPath}.backup.${Date.now()}`;
    fs.renameSync(configPath, backupPath);
    console.log(chalk.gray(`已备份损坏的配置到: ${backupPath}`));
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    return defaultConfig;
  }

  // 兼容旧配置：如果有 defaultProjectPath，重命名为 workspacePath
  if (config.defaultProjectPath && !config.workspacePath) {
    config.workspacePath = config.defaultProjectPath;
    delete config.defaultProjectPath;
    // 保存更新的配置（排除 _pathDetection）
    const configToSave = { ...config };
    delete configToSave._pathDetection;
    fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 2));
    console.log(chalk.yellow('配置已更新：defaultProjectPath 重命名为 workspacePath'));
  }

  // 展开工作空间路径中的 ~ 符号
  if (config.workspacePath && config.workspacePath.startsWith('~')) {
    config.workspacePath = path.join(os.homedir(), config.workspacePath.substring(2));
  }

  // 确保工作空间目录存在
  if (config.workspacePath && !fs.existsSync(config.workspacePath)) {
    fs.mkdirSync(config.workspacePath, { recursive: true });
    console.log(chalk.yellow(`已创建工作空间目录: ${config.workspacePath}`));
  }

  return config;
}

let config = loadConfig();

// 日志和 PID 文件路径
const pidFile = config.pidFile;
const logFile = config.logFile;

// 检查服务是否在运行
function isServerRunning() {
  try {
    if (!fs.existsSync(pidFile)) {
      return { running: false };
    }

    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());

    // 检查进程是否存在
    try {
      process.kill(pid, 0); // 发送信号 0 检查进程是否存在
      return { running: true, pid };
    } catch (e) {
      // PID 文件存在但进程不存在
      fs.unlinkSync(pidFile);
      return { running: false };
    }
  } catch (e) {
    return { running: false };
  }
}

// 启动服务
async function startServer() {
  const { running, pid } = isServerRunning();

  if (running) {
    console.log(chalk.yellow('✓ 服务已在运行中 (PID: ' + pid + ')'));
    return;
  }

  const spinner = ora('启动 Claude Code 服务...').start();

  try {
    // 确保日志目录存在
    const logDir = path.dirname(logFile);
    if (!fs.existsSync(logDir)) {
      try {
        fs.mkdirSync(logDir, { recursive: true });
        console.log(chalk.gray(`✅ 创建日志目录: ${logDir}`));
      } catch (err) {
        console.error(chalk.red(`❌ 创建日志目录失败 ${logDir}:`, err.message));
      }
    }

    // 使用 detached 模式启动后台进程
    const out = fs.openSync(logFile, 'a');
    const err = fs.openSync(logFile, 'a');

    const child = spawn('node', ['server.js'], {
      detached: true,
      stdio: ['ignore', out, err],
      cwd: __dirname,
      env: {
        ...process.env,
        NODE_ENV: 'production', // 设置为生产环境，禁用控制台日志
        CLAUDE_BACKGROUND: 'true', // 额外的后台模式标记
      },
    });

    // 分离子进程
    child.unref();

    // 等待一下让进程启动
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 检查是否启动成功
    const { running: nowRunning } = isServerRunning();
    if (nowRunning) {
      spinner.succeed(chalk.green('服务启动成功！'));
      console.log(chalk.gray(`  端口: ${config.port}`));
      console.log(chalk.gray(`  日志: ${logFile}`));
      console.log(chalk.cyan(`\n测试: curl http://localhost:${config.port}/health`));
    } else {
      spinner.fail('服务启动失败，请查看日志: ' + logFile);
    }
  } catch (error) {
    spinner.fail('启动失败: ' + error.message);
  }
}

// 停止服务
async function stopServer() {
  const { running, pid } = isServerRunning();

  if (!running) {
    console.log(chalk.yellow('○ 服务未运行'));
    return;
  }

  const spinner = ora(`停止服务 (PID: ${pid})...`).start();

  try {
    process.kill(pid, 'SIGTERM');

    // 等待进程结束
    let retries = 10;
    while (retries > 0 && isServerRunning().running) {
      await new Promise(resolve => setTimeout(resolve, 500));
      retries--;
    }

    // 如果还没结束，强制杀死
    if (isServerRunning().running) {
      process.kill(pid, 'SIGKILL');
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 删除 PID 文件
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }

    spinner.succeed(chalk.green('服务已停止'));
  } catch (error) {
    spinner.fail('停止失败: ' + error.message);
  }
}

// 查看状态
async function showStatus() {
  const { running, pid } = isServerRunning();

  console.log('');
  console.log(chalk.bold('┌─────────────────────────────────────┐'));
  console.log(chalk.bold('│     Claude Code Server 状态         │'));
  console.log(chalk.bold('├─────────────────────────────────────┤'));

  if (running) {
    // 获取进程运行时间
    try {
      const stats = fs.statSync(logFile);
      const startTime = stats.mtime;
      const uptime = Math.floor((Date.now() - startTime) / 1000);
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);

      console.log(chalk.bold('│ ') + chalk.green('● ') + chalk.white('状态: 运行中'));
      console.log(chalk.bold('│ ') + chalk.white(`   PID: ${pid}`));
      console.log(chalk.bold('│ ') + chalk.white(`   端口: ${config.port}`));
      console.log(chalk.bold('│ ') + chalk.white(`   运行时间: ${hours}h ${minutes}m`));
      console.log(chalk.bold('│ ') + chalk.white(`   日志: ${logFile}`));
    } catch (e) {
      console.log(chalk.bold('│ ') + chalk.green('● ') + chalk.white('状态: 运行中'));
      console.log(chalk.bold('│ ') + chalk.white(`   PID: ${pid}`));
      console.log(chalk.bold('│ ') + chalk.white(`   端口: ${config.port}`));
    }
  } else {
    console.log(chalk.bold('│ ') + chalk.gray('○ ') + chalk.white('状态: 未运行'));
    console.log(chalk.bold('│ ') + chalk.white(`   端口: ${config.port} (配置)`));
    console.log(chalk.bold('│ ') + chalk.white(`   日志: ${logFile}`));
  }

  console.log(chalk.bold('└─────────────────────────────────────┘'));
  console.log('');
}

// 查看日志
async function viewLogs() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.yellow('服务未运行，日志可能不是最新的'));
  }

  // 日志查看菜单
  while (true) {
    // 清屏并显示日志
    console.clear();
    console.log(chalk.bold.cyan(`📋 日志查看器 - ${logFile}`));
    console.log(chalk.gray('='.repeat(60)));
    console.log('');

    try {
      // 读取最后 20 行日志（使用 stdio: 'pipe' 避免输出到终端）
      const { execSync } = require('child_process');
      const lastLines = execSync(`tail -n 20 ${logFile}`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      // 解析并格式化日志
      const lines = lastLines.split('\n').filter(line => line.trim());
      lines.forEach(line => {
        try {
          const log = JSON.parse(line);
          const level = log.level || 'info';
          const timestamp = log.timestamp || '';
          const message = log.message || '';

          // 根据级别设置颜色
          let colorFn = chalk.white;
          if (level === 'error') colorFn = chalk.red;
          else if (level === 'warn') colorFn = chalk.yellow;
          else if (level === 'info') colorFn = chalk.green;

          console.log(colorFn(`[${timestamp}] ${message}`));

          // 如果有额外的元数据，显示关键信息
          if (log.task_id) console.log(chalk.gray(`  Task: ${log.task_id.substring(0, 8)}...`));
          if (log.session_id) console.log(chalk.gray(`  Session: ${log.session_id.substring(0, 8)}...`));
          if (log.cost_usd !== undefined) console.log(chalk.gray(`  Cost: $${log.cost_usd.toFixed(4)}`));
        } catch (e) {
          // 如果不是 JSON 格式，直接显示
          console.log(chalk.gray(line));
        }
      });
    } catch (error) {
      console.log(chalk.yellow('无法读取日志或日志为空'));
    }

    console.log('');
    console.log(chalk.gray('='.repeat(60)));

    // 提供操作选项
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: '操作:',
        choices: [
          { name: '🔄 刷新日志', value: 'refresh' },
          { name: '📄 查看更多 (最近 500 行)', value: 'more' },
          { name: '🔍 搜索日志', value: 'search' },
          { name: '◀ 返回主菜单', value: 'back' },
        ],
      },
    ]);

    if (action === 'back') {
      break;
    } else if (action === 'more') {
      // 查看更多日志
      console.clear();
      console.log(chalk.bold.cyan(`📋 最近 500 行日志 - ${logFile}`));
      console.log(chalk.gray('='.repeat(600)));
      console.log('');

      try {
        const { execSync } = require('child_process');
        const lastLines = execSync(`tail -n 50 ${logFile}`, {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });

        const lines = lastLines.split('\n').filter(line => line.trim());
        lines.forEach(line => {
          try {
            const log = JSON.parse(line);
            const level = log.level || 'info';
            const timestamp = log.timestamp || '';
            const message = log.message || '';

            let colorFn = chalk.white;
            if (level === 'error') colorFn = chalk.red;
            else if (level === 'warn') colorFn = chalk.yellow;
            else if (level === 'info') colorFn = chalk.green;

            console.log(colorFn(`[${timestamp}] ${message}`));
          } catch (e) {
            console.log(chalk.gray(line));
          }
        });
      } catch (error) {
        console.log(chalk.yellow('无法读取日志'));
      }

      console.log('');
      await inquirer.prompt([
        {
          type: 'input',
          name: 'continue',
          message: '按 Enter 返回...',
        },
      ]);
    } else if (action === 'search') {
      // 搜索日志
      const { keyword } = await inquirer.prompt([
        {
          type: 'input',
          name: 'keyword',
          message: '输入搜索关键词:',
        },
      ]);

      if (keyword) {
        console.clear();
        console.log(chalk.bold.cyan(`🔍 搜索结果: "${keyword}" - ${logFile}`));
        console.log(chalk.gray('='.repeat(60)));
        console.log('');

        try {
          const { execSync } = require('child_process');
          const result = execSync(`grep -i "${keyword}" ${logFile} | tail -n 20`, {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
          });

          if (result.trim()) {
            const lines = result.split('\n').filter(line => line.trim());
            lines.forEach(line => {
              try {
                const log = JSON.parse(line);
                const timestamp = log.timestamp || '';
                const message = log.message || '';
                console.log(chalk.gray(`[${timestamp}]`) + chalk.white(` ${message}`));
              } catch (e) {
                console.log(chalk.gray(line));
              }
            });
          } else {
            console.log(chalk.yellow('未找到匹配的日志'));
          }
        } catch (error) {
          console.log(chalk.yellow('搜索失败或未找到结果'));
        }

        console.log('');
        await inquirer.prompt([
          {
            type: 'input',
            name: 'continue',
            message: '按 Enter 返回...',
          },
        ]);
      }
    }
    // refresh: 继续循环，重新显示日志
  }

  // 返回前清屏
  console.clear();
}

// 配置管理
async function configureSettings() {
  // 第一部分：基本配置
  const basicAnswers = await inquirer.prompt([
    {
      type: 'input',
      name: 'port',
      message: '服务端口:',
      default: config.port,
    },
    {
      type: 'input',
      name: 'host',
      message: '监听地址:',
      default: config.host,
    },
    {
      type: 'input',
      name: 'claudePath',
      message: 'Claude 路径:',
      default: config.claudePath,
    },
    {
      type: 'input',
      name: 'nodeBinDir',
      message: 'Node.js bin 目录 (可选，按回车跳过):',
      default: config.nodeBinDir || '',
    },
    {
      type: 'input',
      name: 'workspacePath',
      message: '工作空间路径 (所有项目必须在此目录下):',
      default: config.workspacePath,
    },
  ]);

  // 更新基本配置
  Object.assign(config, basicAnswers);

  // 如果 nodeBinDir 为空字符串，设置为 null
  if (config.nodeBinDir === '') {
    config.nodeBinDir = null;
  }

  // 第二部分：Webhook 配置
  const { enableWebhook } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enableWebhook',
      message: '启用 Webhook 回调?',
      default: config.webhook?.enabled || false,
    },
  ]);

  if (enableWebhook) {
    const webhookAnswers = await inquirer.prompt([
      {
        type: 'input',
        name: 'webhookUrl',
        message: 'Webhook URL:',
        default: config.webhook?.defaultUrl || '',
        validate: (input) => {
          if (!input) return true; // 允许为空
          try {
            new URL(input);
            return true;
          } catch {
            return '请输入有效的 URL';
          }
        },
      },
      {
        type: 'input',
        name: 'webhookTimeout',
        message: 'Webhook 超时时间 (毫秒):',
        default: (config.webhook?.timeout || 5000).toString(),
        filter: (input) => parseInt(input),
      },
      {
        type: 'input',
        name: 'webhookRetries',
        message: 'Webhook 重试次数:',
        default: (config.webhook?.retries || 3).toString(),
        filter: (input) => parseInt(input),
      },
    ]);

    // 更新 Webhook 配置
    config.webhook = {
      enabled: true,
      defaultUrl: webhookAnswers.webhookUrl || null,
      timeout: webhookAnswers.webhookTimeout,
      retries: webhookAnswers.webhookRetries,
    };
  } else {
    config.webhook = {
      enabled: false,
      defaultUrl: null,
      timeout: 5000,
      retries: 3,
    };
  }

  // 第三部分：任务队列配置
  const queueAnswers = await inquirer.prompt([
    {
      type: 'input',
      name: 'concurrency',
      message: '任务队列并发数 (1-10):',
      default: (config.taskQueue?.concurrency || 3).toString(),
      validate: (input) => {
        const num = parseInt(input);
        if (isNaN(num) || num < 1 || num > 10) {
          return '请输入 1-10 之间的数字';
        }
        return true;
      },
      filter: (input) => parseInt(input),
    },
    {
      type: 'input',
      name: 'timeout',
      message: '任务超时时间 (毫秒):',
      default: (config.taskQueue?.defaultTimeout || 300000).toString(),
      filter: (input) => parseInt(input),
    },
  ]);

  config.taskQueue = {
    concurrency: queueAnswers.concurrency,
    defaultTimeout: queueAnswers.timeout,
  };

  // 第四部分：安全配置
  const { enableAuth } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enableAuth',
      message: '启用 API 认证?',
      default: config.security?.auth?.enabled || false,
    },
  ]);

  // Initialize security config if not exists
  if (!config.security) {
    config.security = { auth: { enabled: false, secretKey: null, bypassHealthCheck: true } };
  }
  if (!config.security.auth) {
    config.security.auth = { enabled: false, secretKey: null, bypassHealthCheck: true };
  }

  config.security.auth.enabled = enableAuth;

  if (enableAuth) {
    // Show current API key if exists
    if (config.security.auth.secretKey) {
      const currentApiKey = deriveApiKey(config.security.auth.secretKey);
      console.log('');
      console.log(chalk.cyan('当前 API Key:'));
      console.log(chalk.bold.white(`  ${currentApiKey}`));
      console.log('');
    }

    const { shouldRegenerate, bypassHealthCheck } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'shouldRegenerate',
        message: '重新生成 API Key?',
        default: false,
      },
      {
        type: 'confirm',
        name: 'bypassHealthCheck',
        message: '允许健康检查跳过认证?',
        default: config.security.auth.bypassHealthCheck !== undefined ? config.security.auth.bypassHealthCheck : true,
      },
    ]);

    if (shouldRegenerate) {
      const { confirmRegenerate } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmRegenerate',
          message: chalk.yellow('确认重新生成? 旧的 API Key 将立即失效!'),
          default: false,
        },
      ]);

      if (confirmRegenerate) {
        config.security.auth.secretKey = generateSecretKey();
        const newApiKey = deriveApiKey(config.security.auth.secretKey);
        console.log('');
        console.log(chalk.green('✓ 新的 API Key 已生成'));
        console.log(chalk.bold.white(`  ${newApiKey}`));
        console.log(chalk.yellow('  请妥善保管此密钥!'));
        console.log('');
      }
    } else if (!config.security.auth.secretKey) {
      // Auto-generate if missing
      config.security.auth.secretKey = generateSecretKey();
      const newApiKey = deriveApiKey(config.security.auth.secretKey);
      console.log('');
      console.log(chalk.green('✓ 已自动生成 SECRET_KEY'));
      console.log(chalk.bold.white(`  API Key: ${newApiKey}`));
      console.log(chalk.yellow('  请妥善保管此密钥!'));
      console.log('');
    }

    config.security.auth.bypassHealthCheck = bypassHealthCheck;
  } else {
    // Auth disabled - keep secretKey for future use
    if (config.security.auth.bypassHealthCheck === undefined) {
      config.security.auth.bypassHealthCheck = true;
    }
  }

  // Swagger 文档配置
  const { enableSwaggerDocs } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enableSwaggerDocs',
      message: '启用 Swagger API 文档 (/api-docs)?',
      default: config.security?.swaggerDocs?.enabled !== false,
    },
  ]);

  // Initialize swaggerDocs config if not exists
  if (!config.security.swaggerDocs) {
    config.security.swaggerDocs = { enabled: true };
  }
  config.security.swaggerDocs.enabled = enableSwaggerDocs;

  // 保存配置
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  console.log(chalk.green('✓ 配置已保存'));
  console.log(chalk.cyan('ℹ 配置将在 1 秒内自动生效（热重载）'));

  // 显示配置摘要
  console.log('');
  console.log(chalk.bold.cyan('配置摘要:'));
  console.log(`  ${chalk.white('端口:')} ${config.port}`);
  console.log(`  ${chalk.white('工作空间:')} ${config.workspacePath}`);
  console.log(`  ${chalk.white('跳过权限检查:')} ${config.allowDangerouslySkipPermissions ? chalk.red('已启用') : chalk.gray('未启用（默认）')}`);
  console.log(`  ${chalk.white('Webhook:')} ${config.webhook.enabled ? chalk.green('已启用') : chalk.gray('未启用')}`);
  if (config.webhook.enabled && config.webhook.defaultUrl) {
    console.log(`  ${chalk.white('URL:')} ${config.webhook.defaultUrl}`);
  }
  console.log(`  ${chalk.white('任务队列:')} 并发数 ${config.taskQueue?.concurrency || 3}, 超时 ${config.taskQueue?.defaultTimeout || 300000}ms`);

  // Security info
  if (config.security?.auth?.enabled) {
    console.log(`  ${chalk.white('API 认证:')} ${chalk.green('已启用')}`);
    if (config.security.auth.secretKey) {
      const apiKey = deriveApiKey(config.security.auth.secretKey);
      console.log(`  ${chalk.white('API Key:')} ${chalk.bold.cyan(apiKey)}`);
    }
    console.log(`  ${chalk.white('健康检查:')} ${config.security.auth.bypassHealthCheck ? chalk.yellow('跳过认证') : chalk.gray('需要认证')}`);
  } else {
    console.log(`  ${chalk.white('API 认证:')} ${chalk.gray('未启用')}`);
  }
  console.log(`  ${chalk.white('Swagger 文档:')} ${config.security?.swaggerDocs?.enabled !== false ? chalk.green('已启用') : chalk.red('已禁用')}`);
  console.log('');
}

// 配置设置
async function visualConfigEditor() {
  // 两级菜单结构：一级分类 -> 配置项（按二级分类分组显示）
  const configHierarchy = [
    {
      name: '📦 服务器配置',
      categories: [
        {
          name: '基本设置',
          items: [
            { key: 'port', label: '服务端口', type: 'number' },
            { key: 'host', label: '监听地址', type: 'string' },
            { key: 'logLevel', label: '日志级别', type: 'string', options: ['debug', 'info', 'warn', 'error'] },
            { key: 'maxBudgetUsd', label: '最大预算 (USD)', type: 'number' },
          ]
        },
        {
          name: '路径配置',
          items: [
            { key: 'claudePath', label: 'Claude 路径', type: 'string' },
            { key: 'nodeBinDir', label: 'Node.js bin 目录', type: 'string' },
            { key: 'workspacePath', label: '工作空间路径', type: 'string' },
          ]
        },
        {
          name: '会话管理',
          items: [
            { key: 'sessionRetentionDays', label: '会话保留天数', type: 'number' },
          ]
        }
      ]
    },
    {
      name: '⚙️ 功能配置',
      categories: [
        {
          name: '任务队列',
          items: [
            { key: 'taskQueue.concurrency', label: '队列并发数', type: 'number' },
            { key: 'taskQueue.defaultTimeout', label: '任务超时 (ms)', type: 'number' },
          ]
        },
        {
          name: '速率限制',
          items: [
            { key: 'rateLimit.enabled', label: '启用速率限制', type: 'boolean' },
            { key: 'rateLimit.windowMs', label: '时间窗口 (ms)', type: 'number' },
            { key: 'rateLimit.maxRequests', label: '最大请求数', type: 'number' },
          ]
        },
        {
          name: '统计收集',
          items: [
            { key: 'statistics.enabled', label: '启用统计收集', type: 'boolean' },
            { key: 'statistics.collectionInterval', label: '采集间隔 (ms)', type: 'number' },
          ]
        },
        {
          name: 'Webhook',
          items: [
            { key: 'webhook.enabled', label: '启用 Webhook', type: 'boolean' },
            { key: 'webhook.defaultUrl', label: 'Webhook URL', type: 'string' },
            { key: 'webhook.timeout', label: '超时时间 (ms)', type: 'number' },
            { key: 'webhook.retries', label: '重试次数', type: 'number' },
          ]
        }
      ]
    },
    {
      name: '🔐 安全配置',
      categories: [
        {
          name: 'API 认证',
          items: [
            { key: 'security.auth.enabled', label: '启用 API 认证', type: 'boolean' },
            { key: 'security.auth.bypassHealthCheck', label: '健康检查绕过认证', type: 'boolean' },
            { key: 'view_api_key', label: '🔑 查看 API Key', type: 'viewkey' },
          ]
        },
        {
          name: '权限与文档',
          items: [
            { key: 'security.swaggerDocs.enabled', label: '启用 Swagger 文档', type: 'boolean' },
            { key: 'allowDangerouslySkipPermissions', label: '跳过权限检查', type: 'boolean' },
          ]
        }
      ]
    },
    {
      name: '⚖️ 负载均衡',
      categories: [
        {
          name: '负载均衡管理',
          items: [
            { key: 'loadbalance', label: '📊 负载均衡管理', type: 'loadbalance' },
          ]
        },
        {
          name: '策略配置',
          items: [
            { key: 'loadBalance.strategy', label: '均衡策略', type: 'string', options: ['round-robin', 'weighted'] },
            { key: 'loadBalance.failover', label: '启用故障转移', type: 'boolean' },
            { key: 'loadBalance.failureThreshold', label: '故障阈值', type: 'number' },
          ]
        }
      ]
    }
  ];

  console.log('');
  console.log(chalk.bold.cyan('╔═══════════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║           📝 配置设置                                         ║'));
  console.log(chalk.bold.cyan('╠═══════════════════════════════════════════════════════════════╣'));
  console.log(chalk.bold.cyan('║ 💡 选择分类 → 选择配置项                                        ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════════════╝'));
  console.log('');

  // 显示 API Key（如果启用认证）
  if (config.security?.auth?.enabled && config.security.auth.secretKey) {
    const apiKey = deriveApiKey(config.security.auth.secretKey);
    console.log(chalk.bold.cyan('🔐 API 认证信息:'));
    console.log(`  ${chalk.white('API Key:')} ${chalk.bold.green(apiKey)}`);
    console.log(`  ${chalk.gray('提示: 使用此 Key 在请求头中添加 Authorization: Bearer <API-Key>')}`);
    console.log('');
  }

  // 辅助函数：构建配置项显示名称
  function buildItemDisplay(categoryName, item) {
    const currentValue = getNestedValue(config, item.key);
    const displayValue = formatValue(currentValue, item.type);
    return {
      name: `${chalk.gray(`[${categoryName}]`)} ${chalk.cyan(item.label)}: ${chalk.yellow(displayValue)}`,
      value: item,
      short: `${item.label} (${displayValue})`,
    };
  }

  // 主菜单循环
  while (true) {
    // 一级菜单：选择分类
    const { selectedCategory } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedCategory',
        message: '选择配置分类:',
        pageSize: 15,
        choices: [
          ...configHierarchy.map(cat => ({ name: cat.name, value: cat })),
          new inquirer.Separator(),
          { name: '📄 在外部编辑器中打开配置文件', value: 'edit' },
          { name: '✖ 完成并退出', value: 'quit' },
        ],
      },
    ]);

    if (selectedCategory === 'quit') {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log('');
      console.log(chalk.green('✓ 配置已保存'));
      console.log(chalk.cyan('ℹ 配置将在约 1 秒内通过热重载生效'));
      console.log('');
      break;
    }

    if (selectedCategory === 'edit') {
      await openInEditor();
      config = loadConfig();
      continue;
    }

    // 二级菜单：直接显示该分类下所有配置项（按子分类分组）
    const category = selectedCategory;
    let stayInCategory = true;

    while (stayInCategory) {
      // 构建配置项列表（带子分类分隔符）
      const itemChoices = [];
      category.categories.forEach(subCat => {
        itemChoices.push(new inquirer.Separator(`  ── ${subCat.name} ──`));
        subCat.items.forEach(item => {
          itemChoices.push(buildItemDisplay(subCat.name, item));
        });
      });

      const { selectedItem } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedItem',
          message: `${category.name} - 选择配置项:`,
          pageSize: 20,
          choices: [
            ...itemChoices,
            new inquirer.Separator(),
            { name: '◀ 返回上级', value: 'back' },
          ],
        },
      ]);

      if (selectedItem === 'back') {
        stayInCategory = false;
        continue;
      }

      // 编辑配置项
      const item = selectedItem;
      const currentValue = getNestedValue(config, item.key);

      // 特殊处理：查看 API Key
      if (item.type === 'viewkey') {
        console.log('');
        console.log(chalk.bold.cyan('╔═══════════════════════════════════════════════════════════════╗'));
        console.log(chalk.bold.cyan('║                     🔑 API Key 信息                           ║'));
        console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════════════╝'));
        console.log('');

        if (config.security?.auth?.enabled && config.security.auth.secretKey) {
          const apiKey = deriveApiKey(config.security.auth.secretKey);
          console.log(`${chalk.white('API Key:')} ${chalk.bold.green(apiKey)}`);
          console.log('');
          console.log(chalk.cyan('使用方法:'));
          console.log(chalk.gray('  curl -X POST http://localhost:5546/api/messages \\'));
          console.log(chalk.gray('    -H "Content-Type: application/json" \\'));
          console.log(chalk.gray('    -H "Authorization: Bearer ' + apiKey + '" \\'));
          console.log(chalk.gray('    -d \'{"prompt": "你好"}\''));
          console.log('');
        } else {
          console.log(chalk.yellow('⚠ API 认证未启用'));
          console.log('');
          console.log(chalk.gray('请先启用 "启用 API 认证" 选项，系统会自动生成 API Key'));
          console.log('');
        }

        await inquirer.prompt([
          {
            type: 'confirm',
            name: 'continue',
            message: '按 Enter 继续',
            default: true,
          },
        ]);
      } else if (item.type === 'loadbalance') {
        // 特殊处理：负载均衡管理
        await loadBalanceMenu();
        // 重新加载配置（可能已被修改）
        config = loadConfig();
      } else if (item.type === 'boolean') {
        const { newValue } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'newValue',
            message: item.label,
            default: currentValue,
          },
        ]);
        setNestedValue(config, item.key, newValue);
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log(chalk.green(`✓ ${item.label} 已更新`));
      } else if (item.options) {
        const { newValue } = await inquirer.prompt([
          {
            type: 'list',
            name: 'newValue',
            message: item.label,
            choices: item.options.map(opt => ({ name: opt, value: opt })),
            default: currentValue,
          },
        ]);
        setNestedValue(config, item.key, newValue);
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log(chalk.green(`✓ ${item.label} 已更新`));
      } else if (item.type === 'number') {
        const { newValue } = await inquirer.prompt([
          {
            type: 'number',
            name: 'newValue',
            message: item.label,
            default: currentValue,
          },
        ]);
        setNestedValue(config, item.key, newValue);
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log(chalk.green(`✓ ${item.label} 已更新`));
      } else {
        const { newValue } = await inquirer.prompt([
          {
            type: 'input',
            name: 'newValue',
            message: item.label,
            default: currentValue ? currentValue.toString() : '',
          },
        ]);
        setNestedValue(config, item.key, newValue);
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log(chalk.green(`✓ ${item.label} 已更新`));
      }
    }
  }
}

function formatValue(value, type) {
  // 特殊类型：查看 API Key，始终显示固定文本
  if (type === 'viewkey') return '点击查看';

  // 先检查是否存在
  if (value === undefined || value === null) return '未设置';

  // 类型特定的格式化
  if (type === 'boolean') return value ? '是' : '否';

  // 其他类型安全转换
  try {
    return String(value);
  } catch (e) {
    return '未设置';
  }
}

function getNestedValue(obj, key) {
  const keys = key.split('.');
  let current = obj;
  for (const k of keys) {
    if (current && current[k] !== undefined) {
      current = current[k];
    } else {
      return undefined;
    }
  }
  return current;
}

function setNestedValue(obj, key, value) {
  const keys = key.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]]) {
      current[keys[i]] = {};
    }
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
}

async function openInEditor() {
  const editor = process.env.EDITOR || 'vi';
  console.log('');
  console.log(chalk.cyan(`正在使用 ${editor} 打开配置文件...`));
  console.log(chalk.gray(`文件: ${configPath}`));
  console.log('');

  const { execSync } = require('child_process');
  try {
    execSync(`${editor} ${configPath}`, { stdio: 'inherit' });
    console.log('');
    console.log(chalk.green('✓ 编辑器已关闭，配置已更新'));

    // 重新加载配置
    const updatedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    Object.assign(config, updatedConfig);
  } catch (error) {
    console.log('');
    console.error(chalk.red('✗ 打开编辑器失败:', error.message));
  }
}

// 显示 API 文档
async function showApiDocs() {
  const docsUrl = `http://localhost:${config.port}/api-docs`;

  console.log('');
  console.log(chalk.bold.cyan('╔════════════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║           Claude Code Server - 接口文档                       ║'));
  console.log(chalk.bold.cyan('╚════════════════════════════════════════════════════════════════╝'));
  console.log('');

  console.log(chalk.bold('📖 交互式 API 文档 (Swagger UI)'));
  console.log('');
  console.log(chalk.white('请在浏览器中访问:'));
  console.log('');
  console.log(chalk.bold.cyan(`  ${docsUrl}`));
  console.log('');
  console.log(chalk.gray('Swagger UI 提供:'));
  console.log(chalk.gray('  • 完整的 API 端点列表和说明'));
  console.log(chalk.gray('  • 在线测试 API 功能'));
  console.log(chalk.gray('  • 请求/响应示例'));
  console.log(chalk.gray('  • 认证配置说明'));
  console.log('');

  const { openBrowser } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'openBrowser',
      message: '是否在浏览器中打开文档?',
      default: false,
    },
  ]);

  if (openBrowser) {
    const { exec } = require('child_process');
    const platform = process.platform;

    let command;
    if (platform === 'darwin') {
      command = `open "${docsUrl}"`;
    } else if (platform === 'win32') {
      command = `start "" "${docsUrl}"`;
    } else {
      command = `xdg-open "${docsUrl}"`;
    }

    exec(command, (error) => {
      if (error) {
        console.log(chalk.yellow('⚠ 无法自动打开浏览器，请手动访问: ' + docsUrl));
      } else {
        console.log(chalk.green('✓ 已在浏览器中打开文档'));
      }
    });
  }
  console.log('');
}

// 测试 API
async function testApi() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ 服务未运行，请先启动服务'));
    return;
  }

  const spinner = ora('测试 API...').start();

  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/health`, {}, config);
    const data = await response.json();

    spinner.succeed(chalk.green('健康检查通过'));
    console.log(JSON.stringify(data, null, 2));

    // 测试 Claude Code API
    const spinner2 = ora('测试 Claude Code API...').start();
    const claudeResponse = await authenticatedFetch(`http://localhost:${config.port}/api/messages`, {
      method: 'POST',
      body: JSON.stringify({ prompt: 'Say hello' }),
    }, config);
    const claudeData = await claudeResponse.json();

    if (claudeData.success) {
      spinner2.succeed(chalk.green('Claude Code API 测试成功'));
      console.log(chalk.gray('回复: ') + claudeData.result);
      console.log(chalk.gray(`耗时: ${claudeData.duration_ms}ms, 费用: $${claudeData.cost_usd}`));
    } else {
      spinner2.warn(chalk.yellow('Claude Code API 返回错误'));
      console.log(JSON.stringify(claudeData, null, 2));
    }
  } catch (error) {
    spinner.fail('测试失败: ' + error.message);
  }
}

// ========== 会话管理 ==========

// 列出所有会话
async function listSessions() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ 服务未运行，请先启动服务'));
    return;
  }

  const spinner = ora('获取会话列表...').start();

  try {
    // 并行获取会话列表和负载均衡绑定信息
    const [sessionsResponse, bindingsResponse, lbStatusResponse] = await Promise.all([
      authenticatedFetch(`http://localhost:${config.port}/api/sessions`, {}, config),
      authenticatedFetch(`http://localhost:${config.port}/api/load-balance/bindings`, {}, config).catch(() => ({ json: () => ({ success: false, bindings: {} }) })),
      authenticatedFetch(`http://localhost:${config.port}/api/load-balance/status`, {}, config).catch(() => ({ json: () => ({ success: false, providers: [] }) })),
    ]);

    const data = await sessionsResponse.json();
    const bindingsData = await bindingsResponse.json();
    const lbStatusData = await lbStatusResponse.json();

    spinner.stop();

    // 构建 providerId -> providerName 映射
    const providerNames = {};
    if (lbStatusData.success && lbStatusData.providers) {
      lbStatusData.providers.forEach(p => {
        providerNames[p.id] = p.name;
      });
    }

    if (data.success && data.sessions.length > 0) {
      console.log('');
      console.log(chalk.bold.cyan(`找到 ${data.sessions.length} 个会话：`));
      console.log('');

      data.sessions.forEach((session, index) => {
        const statusColor = session.status === 'active' ? chalk.green : chalk.gray;
        const providerId = bindingsData.bindings?.[session.id];
        const providerName = providerId ? (providerNames[providerId] || providerId) : null;

        console.log(`${chalk.bold((index + 1) + '.')} ${chalk.white(session.id.substring(0, 8))}... - ${statusColor('● ' + session.status)}`);
        console.log(`   ${chalk.gray('项目:')} ${session.project_path}`);
        console.log(`   ${chalk.gray('模型:')} ${session.model}`);
        if (providerName) {
          console.log(`   ${chalk.gray('Provider:')} ${chalk.magenta(providerName)}`);
        }
        console.log(`   ${chalk.gray('消息数:')} ${session.messages_count} | ${chalk.gray('花费:')} $${session.total_cost_usd.toFixed(4)}`);
        console.log(`   ${chalk.gray('创建:')} ${new Date(session.created_at).toLocaleString()}`);
        console.log('');
      });
    } else {
      spinner.warn('没有找到任何会话');
    }
  } catch (error) {
    spinner.fail('获取会话列表失败: ' + error.message);
  }
}

// 列出历史项目
async function listProjects() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ 服务未运行，请先启动服务'));
    return;
  }

  const spinner = ora('获取历史项目列表...').start();

  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/projects`, {}, config);
    const data = await response.json();

    spinner.stop();

    if (data.success && data.projects.length > 0) {
      console.log('');
      console.log(chalk.bold.cyan(`找到 ${data.projects.length} 个历史项目：`));
      console.log('');

      data.projects.forEach((project, index) => {
        console.log(`${chalk.bold((index + 1) + '.')} ${chalk.white(project.relative_path)}`);
        console.log(`   ${chalk.gray('路径:')} ${project.project_path}`);
        console.log(`   ${chalk.gray('会话数:')} ${project.session_count} | ${chalk.gray('消息数:')} ${project.messages_count} | ${chalk.gray('花费:')} $${project.total_cost_usd.toFixed(4)}`);
        console.log(`   ${chalk.gray('最后活动:')} ${new Date(project.last_activity).toLocaleString()}`);
        console.log('');
      });
    } else {
      spinner.warn('没有找到任何历史项目');
    }
  } catch (error) {
    spinner.fail('获取项目列表失败: ' + error.message);
  }
}

// 查看会话详情
async function viewSessionDetails() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ 服务未运行，请先启动服务'));
    return;
  }

  const spinner = ora('获取会话列表...').start();

  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/sessions`, {}, config);
    const data = await response.json();

    spinner.stop();

    if (!data.success || data.sessions.length === 0) {
      console.log(chalk.yellow('没有找到任何会话'));
      return;
    }

    const choices = data.sessions.map(s => ({
      name: `${s.id.substring(0, 8)}... - ${s.project_path} (${s.status})`,
      value: s.id,
    }));

    const { sessionId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'sessionId',
        message: '选择要查看的会话:',
        choices,
      },
    ]);

    const spinner2 = ora('获取会话详情...').start();

    // 并行获取会话详情和负载均衡绑定信息
    const [detailResponse, bindingsResponse, lbStatusResponse] = await Promise.all([
      authenticatedFetch(`http://localhost:${config.port}/api/sessions/${sessionId}`, {}, config),
      authenticatedFetch(`http://localhost:${config.port}/api/load-balance/bindings`, {}, config).catch(() => ({ json: () => ({ success: false, bindings: {} }) })),
      authenticatedFetch(`http://localhost:${config.port}/api/load-balance/status`, {}, config).catch(() => ({ json: () => ({ success: false, providers: [] }) })),
    ]);

    const detailData = await detailResponse.json();
    const bindingsData = await bindingsResponse.json();
    const lbStatusData = await lbStatusResponse.json();

    spinner2.stop();

    if (detailData.success) {
      const session = detailData.session;

      // 构建 providerId -> providerName 映射
      const providerNames = {};
      if (lbStatusData.success && lbStatusData.providers) {
        lbStatusData.providers.forEach(p => {
          providerNames[p.id] = p.name;
        });
      }

      const providerId = bindingsData.bindings?.[session.id];
      const providerName = providerId ? (providerNames[providerId] || providerId) : null;

      console.log('');
      console.log(chalk.bold.cyan('会话详情：'));
      console.log('');
      console.log(`${chalk.white('ID:')}            ${session.id}`);
      console.log(`${chalk.white('状态:')}          ${session.status}`);
      console.log(`${chalk.white('项目路径:')}      ${session.project_path}`);
      console.log(`${chalk.white('模型:')}          ${session.model}`);
      if (providerName) {
        console.log(`${chalk.white('Provider:')}      ${chalk.magenta(providerName)}`);
      }
      console.log(`${chalk.white('消息数:')}        ${session.messages_count}`);
      console.log(`${chalk.white('总花费:')}        $${session.total_cost_usd.toFixed(4)}`);
      console.log(`${chalk.white('创建时间:')}      ${new Date(session.created_at).toLocaleString()}`);
      console.log(`${chalk.white('更新时间:')}      ${new Date(session.updated_at).toLocaleString()}`);
      if (session.metadata && Object.keys(session.metadata).length > 0) {
        console.log(`${chalk.white('元数据:')}        ${JSON.stringify(session.metadata)}`);
      }
      console.log('');
    } else {
      console.log(chalk.red('获取会话详情失败'));
    }
  } catch (error) {
    spinner.fail('操作失败: ' + error.message);
  }
}

// 删除会话
async function deleteSession() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ 服务未运行，请先启动服务'));
    return;
  }

  const spinner = ora('获取会话列表...').start();

  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/sessions`, {}, config);
    const data = await response.json();

    spinner.stop();

    if (!data.success || data.sessions.length === 0) {
      console.log(chalk.yellow('没有找到任何会话'));
      return;
    }

    const choices = data.sessions.map(s => ({
      name: `${s.id.substring(0, 8)}... - ${s.project_path} (${s.status})`,
      value: s.id,
    }));

    const { sessionId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'sessionId',
        message: '选择要删除的会话:',
        choices,
      },
    ]);

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: '确认删除此会话？',
        default: false,
      },
    ]);

    if (!confirm) {
      console.log(chalk.gray('已取消'));
      return;
    }

    const spinner2 = ora('删除会话...').start();
    const deleteResponse = await authenticatedFetch(`http://localhost:${config.port}/api/sessions/${sessionId}`, {
      method: 'DELETE',
    }, config);
    const deleteData = await deleteResponse.json();

    spinner2.stop();

    if (deleteData.success) {
      console.log(chalk.green('✓ 会话已删除'));
    } else {
      console.log(chalk.red('删除失败: ' + deleteData.error));
    }
  } catch (error) {
    spinner.fail('操作失败: ' + error.message);
  }
}

// 会话管理菜单
async function sessionManagementMenu() {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: '会话管理',
      pageSize: 10,
      choices: [
        { name: '📜 列出所有会话', value: 'list' },
        { name: '🔍 查看会话详情', value: 'view' },
        { name: '🗑 删除会话', value: 'delete' },
        { name: '◀ 返回主菜单', value: 'back' },
      ],
    },
  ]);

  switch (action) {
    case 'list':
      await listSessions();
      break;
    case 'view':
      await viewSessionDetails();
      break;
    case 'delete':
      await deleteSession();
      break;
    case 'back':
      return;
  }

  console.log('');
  await sessionManagementMenu();
}

// ========== 统计查看 ==========

// 查看统计摘要
async function viewStatisticsSummary() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ 服务未运行，请先启动服务'));
    return;
  }

  const spinner = ora('获取统计数据...').start();

  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/statistics/summary`, {}, config);
    const data = await response.json();

    spinner.stop();

    if (data.success) {
      const stats = data.statistics;
      console.log('');
      console.log(chalk.bold.cyan('使用统计摘要：'));
      console.log('');
      console.log(`${chalk.white('请求总数:')}      ${stats.requests.total}`);
      console.log(`${chalk.green('成功请求:')}      ${stats.requests.successful}`);
      console.log(`${chalk.red('失败请求:')}      ${stats.requests.failed}`);
      console.log(`${chalk.white('Token 使用:')}`);
      console.log(`  ${chalk.gray('- 输入:')}      ${stats.tokens.total_input.toLocaleString()}`);
      console.log(`  ${chalk.gray('- 输出:')}      ${stats.tokens.total_output.toLocaleString()}`);
      console.log(`${chalk.white('总花费:')}        $${stats.costs.total_usd.toFixed(4)}`);
      console.log('');
    } else {
      console.log(chalk.red('获取统计数据失败'));
    }
  } catch (error) {
    spinner.fail('获取统计数据失败: ' + error.message);
  }
}

// 查看每日统计
async function viewDailyStatistics() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ 服务未运行，请先启动服务'));
    return;
  }

  const spinner = ora('获取每日统计...').start();

  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/statistics/daily?limit=7`, {}, config);
    const data = await response.json();

    spinner.stop();

    if (data.success && data.daily.length > 0) {
      console.log('');
      console.log(chalk.bold.cyan(`最近 ${data.daily.length} 天统计：`));
      console.log('');

      data.daily.forEach((day, index) => {
        console.log(`${chalk.bold((index + 1) + '.')} ${chalk.white(day.date)}`);
        console.log(`   ${chalk.gray('请求数:')} ${day.total_requests} | ${chalk.gray('成功:')} ${day.successful_requests} | ${chalk.gray('失败:')} ${day.failed_requests}`);
        console.log(`   ${chalk.gray('花费:')} $${day.total_cost_usd.toFixed(4)} | ${chalk.gray('输入 Token:')} ${day.total_input_tokens.toLocaleString()} | ${chalk.gray('输出 Token:')} ${day.total_output_tokens.toLocaleString()}`);
        console.log('');
      });
    } else {
      spinner.warn('没有找到统计数据');
    }
  } catch (error) {
    spinner.fail('获取统计数据失败: ' + error.message);
  }
}

// 统计查看菜单
async function statisticsMenu() {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: '统计查看',
      choices: [
        { name: '📊 查看统计摘要', value: 'summary' },
        { name: '📅 查看每日统计', value: 'daily' },
        { name: '◀ 返回主菜单', value: 'back' },
      ],
    },
  ]);

  switch (action) {
    case 'summary':
      await viewStatisticsSummary();
      break;
    case 'daily':
      await viewDailyStatistics();
      break;
    case 'back':
      return;
  }

  console.log('');
  await statisticsMenu();
}

// ========== 任务列表 ==========

// 列出所有任务
async function listTasks() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ 服务未运行，请先启动服务'));
    return;
  }

  const spinner = ora('获取任务列表...').start();

  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/tasks`, {}, config);
    const data = await response.json();

    spinner.stop();

    if (data.success && data.tasks.length > 0) {
      console.log('');
      console.log(chalk.bold.cyan(`找到 ${data.tasks.length} 个任务：`));
      console.log('');

      data.tasks.forEach((task, index) => {
        const statusColors = {
          pending: chalk.yellow,
          processing: chalk.blue,
          completed: chalk.green,
          failed: chalk.red,
          cancelled: chalk.gray,
        };
        const statusColor = statusColors[task.status] || chalk.gray;

        console.log(`${chalk.bold((index + 1) + '.')} ${chalk.white(task.id)} - ${statusColor('● ' + task.status)} ${chalk.gray('(优先级: ' + task.priority + ')')}`);
        console.log(`   ${chalk.gray('提示:')} ${task.prompt.substring(0, 180)}${task.prompt.length > 120 ? '...' : ''}`);
        if (task.status === 'completed') {
          console.log(`   ${chalk.green('结果:')} ${task.result?.substring(0, 120)}${task.result?.length > 120 ? '...' : ''}`);
          console.log(`   ${chalk.gray('耗时:')} ${task.duration_ms}ms | ${chalk.gray('花费:')} $${task.cost_usd.toFixed(4)}`);
        } else if (task.status === 'failed') {
          console.log(`   ${chalk.red('错误:')} ${task.error}`);
        }
        console.log(`   ${chalk.gray('创建:')} ${new Date(task.created_at).toLocaleString()}`);
        console.log('');
      });
    } else {
      spinner.warn('没有找到任何任务');
    }
  } catch (error) {
    spinner.fail('获取任务列表失败: ' + error.message);
  }
}

// 查看队列状态
async function viewQueueStatus() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ 服务未运行，请先启动服务'));
    return;
  }

  const spinner = ora('获取队列状态...').start();

  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/tasks/queue/status`, {}, config);
    const data = await response.json();

    spinner.stop();

    if (data.success) {
      const queue = data.queue;
      console.log('');
      console.log(chalk.bold.cyan('任务队列状态：'));
      console.log('');
      console.log(`${chalk.white('运行状态:')}      ${queue.running ? chalk.green('运行中') : chalk.gray('已停止')}`);
      console.log(`${chalk.white('并发数:')}        ${queue.concurrency}`);
      console.log(`${chalk.white('活跃任务:')}      ${queue.active_tasks}`);
      console.log(`${chalk.white('任务统计:')}`);
      console.log(`  ${chalk.gray('- 总计:')}     ${queue.total}`);
      console.log(`  ${chalk.yellow('- 待处理:')}   ${queue.pending}`);
      console.log(`  ${chalk.blue('- 处理中:')}   ${queue.processing}`);
      console.log(`  ${chalk.green('- 已完成:')}   ${queue.completed}`);
      console.log(`  ${chalk.red('- 失败:')}     ${queue.failed}`);
      console.log(`  ${chalk.gray('- 已取消:')}   ${queue.cancelled}`);
      console.log(`  ${chalk.gray('- 总花费:')}   $${queue.total_cost_usd.toFixed(4)}`);
      console.log('');
    } else {
      console.log(chalk.red('获取队列状态失败'));
    }
  } catch (error) {
    spinner.fail('获取队列状态失败: ' + error.message);
  }
}

// 调整任务优先级
async function changeTaskPriority() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ 服务未运行，请先启动服务'));
    return;
  }

  const spinner = ora('获取待处理任务...').start();

  try {
    // 获取 pending 和 processing 状态的任务
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/tasks?status=pending`, {}, config);
    const data = await response.json();

    spinner.stop();

    if (!data.success || data.tasks.length === 0) {
      console.log(chalk.yellow('没有找到可以调整优先级的任务'));
      return;
    }

    // 让用户选择任务
    const choices = data.tasks.map(task => ({
      name: `${task.id.substring(0, 8)}... - 优先级: ${task.priority} - ${task.prompt.substring(0, 50)}...`,
      value: task.id,
      short: task.id.substring(0, 8),
    }));

    const { taskId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'taskId',
        message: '选择要调整优先级的任务:',
        choices: choices,
      },
    ]);

    const task = data.tasks.find(t => t.id === taskId);

    // 让用户输入新的优先级
    const { priority } = await inquirer.prompt([
      {
        type: 'input',
        name: 'priority',
        message: `输入新的优先级 (1-10, 当前: ${task.priority}):`,
        default: task.priority.toString(),
        validate: (input) => {
          const num = parseInt(input);
          if (isNaN(num) || num < 1 || num > 10) {
            return '请输入 1-10 之间的数字';
          }
          return true;
        },
        filter: (input) => parseInt(input),
      },
    ]);

    // 更新优先级
    const updateSpinner = ora('更新优先级...').start();
    const updateResponse = await authenticatedFetch(`http://localhost:${config.port}/api/tasks/${taskId}/priority`, {
      method: 'PATCH',
      body: JSON.stringify({ priority }),
    }, config);

    const updateData = await updateResponse.json();
    updateSpinner.stop();

    if (updateData.success) {
      console.log('');
      console.log(chalk.green('✓ 优先级已更新'));
      console.log(`  任务 ID: ${updateData.task_id.substring(0, 8)}...`);
      console.log(`  旧优先级: ${updateData.old_priority}`);
      console.log(`  新优先级: ${updateData.new_priority}`);
      console.log('');
    } else {
      console.log(chalk.red('✗ 更新失败: ' + updateData.error));
    }
  } catch (error) {
    spinner.fail('操作失败: ' + error.message);
  }
}

// 取消任务
async function cancelTask() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ 服务未运行，请先启动服务'));
    return;
  }

  const spinner = ora('获取可取消的任务...').start();

  try {
    // 获取 pending 和 processing 状态的任务
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/tasks?status=pending`, {}, config);
    const processingResponse = await authenticatedFetch(`http://localhost:${config.port}/api/tasks?status=processing`, {}, config);

    const data = await response.json();
    const processingData = await processingResponse.json();

    spinner.stop();

    const cancellableTasks = [
      ...(data.success ? data.tasks : []),
      ...(processingData.success ? processingData.tasks : []),
    ];

    if (cancellableTasks.length === 0) {
      console.log(chalk.yellow('没有找到可以取消的任务'));
      return;
    }

    // 让用户选择任务
    const choices = cancellableTasks.map(task => ({
      name: `${task.id.substring(0, 8)}... [${task.status}] 优先级: ${task.priority} - ${task.prompt.substring(0, 40)}...`,
      value: task.id,
      short: task.id.substring(0, 8),
    }));

    const { taskId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'taskId',
        message: '选择要取消的任务:',
        choices: choices,
      },
    ]);

    // 确认取消
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: '确定要取消这个任务吗?',
        default: false,
      },
    ]);

    if (!confirm) {
      console.log(chalk.gray('已取消操作'));
      return;
    }

    // 取消任务
    const cancelSpinner = ora('正在取消任务...').start();
    const cancelResponse = await authenticatedFetch(`http://localhost:${config.port}/api/tasks/${taskId}`, {
      method: 'DELETE',
    }, config);

    const cancelData = await cancelResponse.json();
    cancelSpinner.stop();

    if (cancelData.success) {
      console.log('');
      console.log(chalk.green('✓ 任务已取消'));
      console.log(`  任务 ID: ${taskId.substring(0, 8)}...`);
      console.log('');
    } else {
      console.log(chalk.red('✗ 取消失败: ' + cancelData.error));
    }
  } catch (error) {
    spinner.fail('操作失败: ' + error.message);
  }
}

// 任务列表菜单
async function tasksMenu() {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: '任务列表',
      pageSize: 10,
      choices: [
        { name: '📜 列出所有任务', value: 'list' },
        { name: '📊 查看队列状态', value: 'status' },
        { name: '⚡ 调整任务优先级', value: 'priority' },
        { name: '✖ 取消任务', value: 'cancel' },
        { name: '◀ 返回主菜单', value: 'back' },
      ],
    },
  ]);

  switch (action) {
    case 'list':
      await listTasks();
      break;
    case 'status':
      await viewQueueStatus();
      break;
    case 'priority':
      await changeTaskPriority();
      break;
    case 'cancel':
      await cancelTask();
      break;
    case 'back':
      return;
  }

  console.log('');
  await tasksMenu();
}

// ========== 负载均衡管理 ==========

// 查看负载均衡状态
async function viewLoadBalanceStatus() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ 服务未运行，请先启动服务'));
    return;
  }

  const spinner = ora('获取负载均衡状态...').start();

  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/load-balance/status`, {}, config);
    const data = await response.json();

    spinner.stop();

    if (data.success) {
      // API 直接返回 strategy, failover, providers，不是嵌套在 status 下
      const strategy = data.strategy || 'none';
      const failover = data.failover || false;
      const providers = data.providers || [];

      console.log('');
      console.log(chalk.bold.cyan('负载均衡状态：'));
      console.log('');

      if (strategy === 'none') {
        console.log(chalk.gray('负载均衡未启用（未配置 providers）'));
        console.log('');
        console.log(chalk.gray('提示: 在 config.json 中添加 providers 配置以启用负载均衡'));
      } else {
        console.log(`${chalk.white('策略:')} ${strategy === 'round-robin' ? '轮询 (Round Robin)' : '权重 (Weighted)'}`);
        console.log(`${chalk.white('故障转移:')} ${failover ? '启用' : '禁用'}`);
        console.log('');

        if (providers.length > 0) {
          console.log(chalk.bold.white('Provider 列表：'));
          console.log('');
          providers.forEach((provider, index) => {
            const healthIcon = provider.healthy ? chalk.green('✓') : chalk.red('✗');
            const healthText = provider.healthy ? chalk.green('健康') : chalk.red('不健康');
            console.log(`${chalk.bold((index + 1) + '.')} ${chalk.white(provider.name || provider.id)}`);
            console.log(`   ${healthIcon} 状态: ${healthText} | ${chalk.gray('权重:')} ${provider.weight} | ${chalk.gray('绑定会话:')} ${provider.boundSessions}`);
            console.log(`   ${chalk.gray('请求总数:')} ${provider.totalRequests} | ${chalk.gray('连续失败:')} ${provider.consecutiveFailures}`);
            console.log('');
          });
        } else {
          console.log(chalk.gray('没有配置 Provider'));
        }
      }
    } else {
      console.log(chalk.red('获取负载均衡状态失败: ' + (data.error || '未知错误')));
    }
  } catch (error) {
    spinner.fail('获取负载均衡状态失败: ' + error.message);
  }
}

// 查看会话绑定
async function viewSessionBindings() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ 服务未运行，请先启动服务'));
    return;
  }

  const spinner = ora('获取会话绑定...').start();

  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/load-balance/bindings`, {}, config);
    const data = await response.json();

    spinner.stop();

    if (data.success) {
      const bindings = data.bindings;
      const entries = Object.entries(bindings);

      console.log('');
      console.log(chalk.bold.cyan('会话绑定：'));
      console.log('');

      if (entries.length > 0) {
        entries.forEach(([sessionId, providerId], index) => {
          console.log(`${chalk.bold((index + 1) + '.')} ${chalk.white('Session:')} ${sessionId.substring(0, 8)}... → ${chalk.white('Provider:')} ${providerId}`);
        });
        console.log('');
        console.log(chalk.gray(`总计: ${entries.length} 个会话绑定`));
      } else {
        console.log(chalk.gray('没有会话绑定'));
      }
      console.log('');
    } else {
      console.log(chalk.red('获取会话绑定失败'));
    }
  } catch (error) {
    spinner.fail('获取会话绑定失败: ' + error.message);
  }
}

// 重置 Provider 健康状态
async function resetProviderHealth() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ 服务未运行，请先启动服务'));
    return;
  }

  // 先获取 provider 列表
  let providers = [];
  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/load-balance/status`, {}, config);
    const data = await response.json();
    if (data.success && data.providers) {
      providers = data.providers;
    }
  } catch (error) {
    console.log(chalk.red('获取 Provider 列表失败: ' + error.message));
    return;
  }

  if (providers.length === 0) {
    console.log(chalk.yellow('没有可用的 Provider（请先在 ~/.claude-code-server/config.json 中配置 providers）'));
    return;
  }

  const { providerId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'providerId',
      message: '选择要重置的 Provider',
      choices: providers.map(p => ({
        name: `${p.name || p.id} ${p.healthy ? chalk.green('(健康)') : chalk.red('(不健康)')}`,
        value: p.id,
      })),
    },
  ]);

  const spinner = ora('重置 Provider 健康状态...').start();

  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/load-balance/providers/${providerId}/reset`, {
      method: 'POST',
    }, config);
    const data = await response.json();

    spinner.stop();

    if (data.success) {
      console.log(chalk.green(`✓ Provider ${providerId} 已重置为健康状态`));
    } else {
      console.log(chalk.red(`重置失败: ${data.error}`));
    }
  } catch (error) {
    spinner.fail('重置失败: ' + error.message);
  }
}

// 启用/禁用 Provider
async function toggleProvider() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ 服务未运行，请先启动服务'));
    return;
  }

  // 先获取 provider 列表
  let providers = [];
  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/load-balance/status`, {}, config);
    const data = await response.json();
    if (data.success && data.providers) {
      providers = data.providers;
    }
  } catch (error) {
    console.log(chalk.red('获取 Provider 列表失败: ' + error.message));
    return;
  }

  if (providers.length === 0) {
    console.log(chalk.yellow('没有可用的 Provider（请先在 ~/.claude-code-server/config.json 中配置 providers）'));
    return;
  }

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: '选择操作',
      choices: [
        { name: '✓ 启用 Provider', value: 'enable' },
        { name: '✗ 禁用 Provider', value: 'disable' },
        { name: '◀ 返回', value: 'back' },
      ],
    },
  ]);

  if (action === 'back') {
    return;
  }

  const { providerId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'providerId',
      message: `选择要${action === 'enable' ? '启用' : '禁用'}的 Provider`,
      choices: providers.map(p => ({
        name: `${p.name || p.id} ${p.enabled ? chalk.green('(已启用)') : chalk.gray('(已禁用)')}`,
        value: p.id,
      })),
    },
  ]);

  const spinner = ora(`${action === 'enable' ? '启用' : '禁用'} Provider...`).start();

  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/load-balance/providers/${providerId}/${action}`, {
      method: 'POST',
    }, config);
    const data = await response.json();

    spinner.stop();

    if (data.success) {
      console.log(chalk.green(`✓ Provider ${providerId} 已${action === 'enable' ? '启用' : '禁用'}`));
    } else {
      console.log(chalk.red(`操作失败: ${data.error}`));
    }
  } catch (error) {
    spinner.fail('操作失败: ' + error.message);
  }
}

// ========== 负载均衡配置 ==========

// 读取配置文件
function readConfigFile() {
  const configPath = path.join(os.homedir(), '.claude-code-server', 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.log(chalk.red('读取配置文件失败: ' + error.message));
  }
  return {};
}

// 写入配置文件
function writeConfigFile(configData) {
  const configPath = path.join(os.homedir(), '.claude-code-server', 'config.json');
  try {
    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.log(chalk.red('写入配置文件失败: ' + error.message));
    return false;
  }
}

// 添加 Provider
async function addProvider() {
  console.log('');
  console.log(chalk.bold.cyan('添加新 Provider'));
  console.log('');

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'id',
      message: 'Provider ID (唯一标识，如 provider-1):',
      validate: (input) => {
        if (!input || !input.trim()) return '请输入 Provider ID';
        if (!/^[a-zA-Z0-9_-]+$/.test(input)) return 'ID 只能包含字母、数字、下划线和连字符';
        return true;
      },
    },
    {
      type: 'input',
      name: 'name',
      message: 'Provider 名称 (显示名称):',
      default: (answers) => answers.id,
    },
    {
      type: 'input',
      name: 'apiKey',
      message: 'Auth Token (ANTHROPIC_AUTH_TOKEN):',
      validate: (input) => input && input.trim() ? true : '请输入 Auth Token',
    },
    {
      type: 'input',
      name: 'baseUrl',
      message: 'Base URL (默认: https://api.anthropic.com):',
      default: 'https://api.anthropic.com',
    },
    {
      type: 'number',
      name: 'weight',
      message: '权重 (用于加权策略，默认 1):',
      default: 1,
      min: 1,
      max: 100,
    },
    {
      type: 'confirm',
      name: 'enabled',
      message: '是否启用?',
      default: true,
    },
    {
      type: 'confirm',
      name: 'addEnv',
      message: '是否添加自定义环境变量?',
      default: false,
    },
  ]);

  // 如果需要添加环境变量
  let env = {};
  if (answers.addEnv) {
    let addMore = true;
    while (addMore) {
      const envAnswer = await inquirer.prompt([
        {
          type: 'input',
          name: 'key',
          message: '环境变量名 (如 CUSTOM_API_HEADER):',
          validate: (input) => input && input.trim() ? true : '请输入环境变量名',
        },
        {
          type: 'input',
          name: 'value',
          message: '环境变量值:',
          validate: (input) => input !== undefined && input !== null ? true : '请输入环境变量值',
        },
        {
          type: 'confirm',
          name: 'addMore',
          message: '继续添加更多环境变量?',
          default: false,
        },
      ]);
      env[envAnswer.key] = envAnswer.value;
      addMore = envAnswer.addMore;
    }
  }

  // 读取当前配置
  const configData = readConfigFile();
  if (!configData.providers) {
    configData.providers = [];
  }

  // 检查 ID 是否已存在
  if (configData.providers.some(p => p.id === answers.id)) {
    console.log(chalk.red(`Provider ID "${answers.id}" 已存在`));
    return;
  }

  // 添加新 Provider
  const newProvider = {
    id: answers.id,
    name: answers.name,
    apiKey: answers.apiKey,
    baseUrl: answers.baseUrl,
    weight: answers.weight,
    enabled: answers.enabled,
  };

  if (Object.keys(env).length > 0) {
    newProvider.env = env;
  }

  configData.providers.push(newProvider);

  // 如果是第一个 provider，自动设置 loadBalance
  if (!configData.loadBalance) {
    configData.loadBalance = {
      strategy: 'round-robin',
      failureThreshold: 3,
      failover: true,
    };
  }

  if (writeConfigFile(configData)) {
    console.log(chalk.green(`✓ Provider "${answers.name}" 已添加`));
    console.log(chalk.gray('配置已保存，服务器将自动重新加载'));
  }
}

// 编辑 Provider
async function editProvider() {
  const configData = readConfigFile();
  const providers = configData.providers || [];

  if (providers.length === 0) {
    console.log(chalk.yellow('没有可编辑的 Provider'));
    return;
  }

  const { providerId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'providerId',
      message: '选择要编辑的 Provider',
      choices: providers.map(p => ({
        name: `${p.name || p.id} (${p.enabled ? chalk.green('已启用') : chalk.gray('已禁用')})`,
        value: p.id,
      })),
    },
  ]);

  const provider = providers.find(p => p.id === providerId);
  if (!provider) {
    console.log(chalk.red('Provider 未找到'));
    return;
  }

  console.log('');
  console.log(chalk.bold.cyan(`编辑 Provider: ${provider.name || provider.id}`));
  console.log(chalk.gray('（直接回车保持当前值）'));
  console.log('');

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Provider 名称:',
      default: provider.name,
    },
    {
      type: 'input',
      name: 'apiKey',
      message: 'API Key (留空保持不变):',
    },
    {
      type: 'input',
      name: 'baseUrl',
      message: 'Base URL:',
      default: provider.baseUrl,
    },
    {
      type: 'number',
      name: 'weight',
      message: '权重:',
      default: provider.weight || 1,
      min: 1,
      max: 100,
    },
    {
      type: 'confirm',
      name: 'enabled',
      message: '是否启用?',
      default: provider.enabled !== false,
    },
  ]);

  // 更新 Provider
  provider.name = answers.name;
  if (answers.apiKey && answers.apiKey.trim()) {
    provider.apiKey = answers.apiKey;
  }
  provider.baseUrl = answers.baseUrl;
  provider.weight = answers.weight;
  provider.enabled = answers.enabled;

  if (writeConfigFile(configData)) {
    console.log(chalk.green(`✓ Provider "${provider.name}" 已更新`));
    console.log(chalk.gray('配置已保存，服务器将自动重新加载'));
  }
}

// 删除 Provider
async function removeProvider() {
  const configData = readConfigFile();
  const providers = configData.providers || [];

  if (providers.length === 0) {
    console.log(chalk.yellow('没有可删除的 Provider'));
    return;
  }

  const { providerId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'providerId',
      message: '选择要删除的 Provider',
      choices: providers.map(p => ({
        name: `${p.name || p.id} (${p.enabled ? chalk.green('已启用') : chalk.gray('已禁用')})`,
        value: p.id,
      })),
    },
  ]);

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: '确认删除此 Provider?',
      default: false,
    },
  ]);

  if (!confirm) {
    console.log(chalk.gray('已取消'));
    return;
  }

  const index = providers.findIndex(p => p.id === providerId);
  if (index !== -1) {
    const removed = providers.splice(index, 1)[0];
    configData.providers = providers;

    if (writeConfigFile(configData)) {
      console.log(chalk.green(`✓ Provider "${removed.name || removed.id}" 已删除`));
      console.log(chalk.gray('配置已保存，服务器将自动重新加载'));
    }
  }
}

// 配置负载均衡策略
async function configureLoadBalance() {
  const configData = readConfigFile();

  console.log('');
  console.log(chalk.bold.cyan('配置负载均衡策略'));
  console.log('');

  const currentStrategy = configData.loadBalance?.strategy || 'round-robin';
  const currentFailover = configData.loadBalance?.failover !== false;
  const currentThreshold = configData.loadBalance?.failureThreshold || 3;

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'strategy',
      message: '选择负载均衡策略:',
      choices: [
        { name: '轮询 (Round Robin) - 依次分配', value: 'round-robin' },
        { name: '加权 (Weighted) - 按权重分配', value: 'weighted' },
      ],
      default: currentStrategy,
    },
    {
      type: 'confirm',
      name: 'failover',
      message: '启用故障转移 (当 Provider 不健康时自动切换)?',
      default: currentFailover,
    },
    {
      type: 'number',
      name: 'failureThreshold',
      message: '连续失败多少次后标记为不健康:',
      default: currentThreshold,
      min: 1,
      max: 10,
    },
  ]);

  configData.loadBalance = {
    strategy: answers.strategy,
    failover: answers.failover,
    failureThreshold: answers.failureThreshold,
  };

  if (writeConfigFile(configData)) {
    console.log(chalk.green('✓ 负载均衡配置已更新'));
    console.log(chalk.gray('配置已保存，服务器将自动重新加载'));
  }
}

// 负载均衡管理菜单
async function loadBalanceMenu() {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: '负载均衡管理',
      pageSize: 12,
      choices: [
        { name: '📊 查看负载均衡状态', value: 'status' },
        { name: '🔗 查看会话绑定', value: 'bindings' },
        new inquirer.Separator(),
        { name: '➕ 添加 Provider', value: 'add' },
        { name: '✏️  编辑 Provider', value: 'edit' },
        { name: '🗑️  删除 Provider', value: 'remove' },
        new inquirer.Separator(),
        { name: '⚙️  配置负载均衡策略', value: 'config' },
        { name: '🔄 重置 Provider 健康状态', value: 'reset' },
        { name: '⚡ 启用/禁用 Provider', value: 'toggle' },
        new inquirer.Separator(),
        { name: '◀ 返回主菜单', value: 'back' },
      ],
    },
  ]);

  switch (action) {
    case 'status':
      await viewLoadBalanceStatus();
      break;
    case 'bindings':
      await viewSessionBindings();
      break;
    case 'add':
      await addProvider();
      break;
    case 'edit':
      await editProvider();
      break;
    case 'remove':
      await removeProvider();
      break;
    case 'config':
      await configureLoadBalance();
      break;
    case 'reset':
      await resetProviderHealth();
      break;
    case 'toggle':
      await toggleProvider();
      break;
    case 'back':
      return;
  }

  console.log('');
  await loadBalanceMenu();
}

// 主菜单
async function mainMenu() {
  const { running, pid } = isServerRunning();

  const statusText = running ? chalk.green('[运行中]') : chalk.gray('[未运行]');
  const versionText = chalk.cyan(`v${version}`);
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: `Claude Code Server Manager ${versionText} ${statusText}`,
      pageSize: 15, // 设置菜单显示行数
      choices: [
        { name: '▶ 启动服务', value: 'start', disabled: running ? '已在运行' : false },
        { name: '■ 停止服务', value: 'stop', disabled: !running ? '未运行' : false },
        { name: '● 查看状态', value: 'status' },
        { name: '💬 会话管理', value: 'sessions', disabled: !running ? '服务未运行' : false },
        { name: '📊 查看统计', value: 'statistics', disabled: !running ? '服务未运行' : false },
        { name: '📋 任务列表', value: 'tasks', disabled: !running ? '服务未运行' : false },
        { name: '🏠 历史项目', value: 'projects', disabled: !running ? '服务未运行' : false },
        { name: '📋 查看日志 (tail -f)', value: 'logs', disabled: !fs.existsSync(logFile) ? '无日志文件' : false },
        { name: '📖 查看接口文档', value: 'docs' },
        { name: '📝 配置设置', value: 'visualConfig' },
        { name: '🧪 测试 API', value: 'test', disabled: !running ? '服务未运行' : false },
        { name: '✖ 退出', value: 'exit' },
      ],
    },
  ]);

  switch (action) {
    case 'start':
      await startServer();
      break;
    case 'stop':
      await stopServer();
      break;
    case 'status':
      await showStatus();
      break;
    case 'sessions':
      await sessionManagementMenu();
      break;
    case 'statistics':
      await statisticsMenu();
      break;
    case 'tasks':
      await tasksMenu();
      break;
    case 'projects':
      await listProjects();
      break;
    case 'logs':
      await viewLogs();
      break;
    case 'docs':
      await showApiDocs();
      break;
    case 'visualConfig':
      await visualConfigEditor();
      break;
    case 'test':
      await testApi();
      break;
    case 'exit':
      console.log(chalk.gray('再见！'));
      process.exit(0);
  }

  console.log('');
  await mainMenu();
}

// 命令行参数处理
const args = process.argv.slice(2);

// 处理 -v / --version
if (args.includes('-v') || args.includes('--version')) {
  console.log(`@csdwd/ccs v${version}`);
  process.exit(0);
}

if (args.length === 0) {
  // 交互式菜单
  mainMenu().catch(console.error);
} else {
  // 命令行模式
  const command = args[0];

  switch (command) {
    case 'start':
      startServer().then(() => process.exit(0));
      break;
    case 'stop':
      stopServer().then(() => process.exit(0));
      break;
    case 'status':
      showStatus().then(() => process.exit(0));
      break;
    case 'logs':
      viewLogs();
      break;
    case 'docs':
      showApiDocs().then(() => process.exit(0));
      break;
    case 'config':
      configureSettings().then(() => process.exit(0));
      break;
    case 'test':
      testApi().then(() => process.exit(0));
      break;
    default:
      console.log(chalk.red('未知命令: ') + command);
      console.log(chalk.gray('可用命令: start, stop, status, logs, docs, config, test'));
      console.log(chalk.gray('选项: -v, --version  查看版本号'));
      console.log(chalk.gray('或直接运行进入交互式菜单'));
      process.exit(1);
  }
}
