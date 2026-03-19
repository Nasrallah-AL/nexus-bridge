#!/usr/bin/env node

const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { generateSecretKey, deriveApiKey } = require('./src/utils/keyGenerator');
const { syncNodeBinConfig } = require('./src/utils/runtimePaths');
const { version } = require('./package.json');

// Configuration directory and files
const runtimeDirName = '.nexus-bridge';
const configDir = path.join(process.env.HOME || os.homedir(), runtimeDirName);
const configPath = path.join(configDir, 'config.json');

/**
 * Build fetch headers with authentication.
 * Automatically add the Authorization header when API authentication is enabled.
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
 * Authenticated fetch wrapper.
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
  claudePath: 'claude',  // Use the claude command from the system PATH.
  nodeBinDir: null,  // Optional Node.js bin directory (for example /usr/local/bin or ~/.nvm/versions/node/v22.21.0/bin).
  workspacePath: path.join(process.env.HOME || os.homedir(), runtimeDirName, 'workspace'),  // Workspace root directory.
  logFile: path.join(process.env.HOME || os.homedir(), runtimeDirName, 'logs', 'server.log'),
  pidFile: path.join(process.env.HOME || os.homedir(), runtimeDirName, 'server.pid'),
  dataDir: path.join(process.env.HOME || os.homedir(), runtimeDirName, 'data'),
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

// Ensure the config directory exists and load the configuration
function loadConfig() {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  if (!fs.existsSync(configPath)) {
    // Create the default config file
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    console.log(chalk.yellow(`Created default config file: ${configPath}`));
    return defaultConfig;
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.log(chalk.red(`Config file is corrupted, resetting: ${configPath}`));
    const backupPath = `${configPath}.backup.${Date.now()}`;
    fs.renameSync(configPath, backupPath);
    console.log(chalk.gray(`Backed up corrupted config to: ${backupPath}`));
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    return defaultConfig;
  }

  // Backward compatibility: rename defaultProjectPath to workspacePath when present
  if (config.defaultProjectPath && !config.workspacePath) {
    config.workspacePath = config.defaultProjectPath;
    delete config.defaultProjectPath;
    // Save the updated config (excluding _pathDetection)
    const configToSave = { ...config };
    delete configToSave._pathDetection;
    fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 2));
    console.log(chalk.yellow('Configuration updated: defaultProjectPath renamed to workspacePath'));
  }

  const syncResult = syncNodeBinConfig(config);
  if (syncResult.changed) {
    const configToSave = { ...config };
    delete configToSave._pathDetection;
    fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 2));
    console.log(chalk.yellow('Configuration updated: synchronized nodeBinDir and legacy nvmBin'));
  }

  // Expand `~` in the workspace path
  if (config.workspacePath && config.workspacePath.startsWith('~')) {
    config.workspacePath = path.join(os.homedir(), config.workspacePath.substring(2));
  }

  // Ensure the workspace directory exists
  if (config.workspacePath && !fs.existsSync(config.workspacePath)) {
    fs.mkdirSync(config.workspacePath, { recursive: true });
    console.log(chalk.yellow(`Created workspace directory: ${config.workspacePath}`));
  }

  return config;
}

let config = loadConfig();

// Log and PID file paths
const pidFile = config.pidFile;
const logFile = config.logFile;

// Check whether the service is running
function isServerRunning() {
  try {
    if (!fs.existsSync(pidFile)) {
      return { running: false };
    }

    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());

    // Check whether the process exists
    try {
      process.kill(pid, 0); // Send signal 0 to check whether the process exists.
      return { running: true, pid };
    } catch (e) {
      // The PID file exists, but the process does not.
      fs.unlinkSync(pidFile);
      return { running: false };
    }
  } catch (e) {
    return { running: false };
  }
}

// Start the service
async function startServer() {
  const { running, pid } = isServerRunning();

  if (running) {
    console.log(chalk.yellow('✓ Service is already running (PID: ' + pid + ')'));
    return;
  }

  const spinner = ora('Starting Nexus Bridge service...').start();

  try {
    // Ensure the log directory exists
    const logDir = path.dirname(logFile);
    if (!fs.existsSync(logDir)) {
      try {
        fs.mkdirSync(logDir, { recursive: true });
        console.log(chalk.gray(`✅ Created log directory: ${logDir}`));
      } catch (err) {
        console.error(chalk.red(`❌ Failed to create log directory ${logDir}:`, err.message));
      }
    }

    // Start the background process in detached mode
    const out = fs.openSync(logFile, 'a');
    const err = fs.openSync(logFile, 'a');

    const child = spawn('node', ['server.js'], {
      detached: true,
      stdio: ['ignore', out, err],
      cwd: __dirname,
      env: {
        ...process.env,
        NODE_ENV: 'production', // Set production mode to disable console logging.
        CLAUDE_BACKGROUND: 'true', // Additional background-mode flag.
      },
    });

    // Detach the child process
    child.unref();

    // Wait briefly for the process to start
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check whether startup succeeded
    const { running: nowRunning } = isServerRunning();
    if (nowRunning) {
      spinner.succeed(chalk.green('Service started successfully!'));
      console.log(chalk.gray(`  Port: ${config.port}`));
      console.log(chalk.gray(`  Log: ${logFile}`));
      console.log(chalk.cyan(`\nTest: curl http://localhost:${config.port}/health`));
    } else {
      spinner.fail('Service failed to start. Check the log: ' + logFile);
    }
  } catch (error) {
    spinner.fail('Startup failed: ' + error.message);
  }
}

// Stop the service
async function stopServer() {
  const { running, pid } = isServerRunning();

  if (!running) {
    console.log(chalk.yellow('○ Service is not running'));
    return;
  }

  const spinner = ora(`Stopping service (PID: ${pid})...`).start();

  try {
    process.kill(pid, 'SIGTERM');

    // Wait for the process to exit
    let retries = 10;
    while (retries > 0 && isServerRunning().running) {
      await new Promise(resolve => setTimeout(resolve, 500));
      retries--;
    }

    // If it is still running, force kill it
    if (isServerRunning().running) {
      process.kill(pid, 'SIGKILL');
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Remove the PID file
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }

    spinner.succeed(chalk.green('Service stopped'));
  } catch (error) {
    spinner.fail('Stop failed: ' + error.message);
  }
}

// View status
async function showStatus() {
  const { running, pid } = isServerRunning();

  console.log('');
  console.log(chalk.bold('┌─────────────────────────────────────┐'));
  console.log(chalk.bold('│        Nexus Bridge Status          │'));
  console.log(chalk.bold('├─────────────────────────────────────┤'));

  if (running) {
    // Get the process uptime
    try {
      const stats = fs.statSync(logFile);
      const startTime = stats.mtime;
      const uptime = Math.floor((Date.now() - startTime) / 1000);
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);

      console.log(chalk.bold('│ ') + chalk.green('● ') + chalk.white('Status: Running'));
      console.log(chalk.bold('│ ') + chalk.white(`   PID: ${pid}`));
      console.log(chalk.bold('│ ') + chalk.white(`   Port: ${config.port}`));
      console.log(chalk.bold('│ ') + chalk.white(`   Uptime: ${hours}h ${minutes}m`));
      console.log(chalk.bold('│ ') + chalk.white(`   Log: ${logFile}`));
    } catch (e) {
      console.log(chalk.bold('│ ') + chalk.green('● ') + chalk.white('Status: Running'));
      console.log(chalk.bold('│ ') + chalk.white(`   PID: ${pid}`));
      console.log(chalk.bold('│ ') + chalk.white(`   Port: ${config.port}`));
    }
  } else {
    console.log(chalk.bold('│ ') + chalk.gray('○ ') + chalk.white('Status: Not running'));
    console.log(chalk.bold('│ ') + chalk.white(`   Port: ${config.port} (configured)`));
    console.log(chalk.bold('│ ') + chalk.white(`   Log: ${logFile}`));
  }

  console.log(chalk.bold('└─────────────────────────────────────┘'));
  console.log('');
}

// View logs
async function viewLogs() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.yellow('Service is not running, so the log may not be up to date'));
  }

  // Log viewer menu
  while (true) {
    // Clear the screen and display logs
    console.clear();
    console.log(chalk.bold.cyan(`📋 Log Viewer - ${logFile}`));
    console.log(chalk.gray('='.repeat(60)));
    console.log('');

    try {
      // Read the last 20 log lines (using stdio: 'pipe' to avoid writing to the terminal)
      const { execSync } = require('child_process');
      const lastLines = execSync(`tail -n 20 ${logFile}`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      // Parse and format logs
      const lines = lastLines.split('\n').filter(line => line.trim());
      lines.forEach(line => {
        try {
          const log = JSON.parse(line);
          const level = log.level || 'info';
          const timestamp = log.timestamp || '';
          const message = log.message || '';

          // Set colors by log level
          let colorFn = chalk.white;
          if (level === 'error') colorFn = chalk.red;
          else if (level === 'warn') colorFn = chalk.yellow;
          else if (level === 'info') colorFn = chalk.green;

          console.log(colorFn(`[${timestamp}] ${message}`));

          // Show key information when extra metadata is present
          if (log.task_id) console.log(chalk.gray(`  Task: ${log.task_id.substring(0, 8)}...`));
          if (log.session_id) console.log(chalk.gray(`  Session: ${log.session_id.substring(0, 8)}...`));
          if (log.cost_usd !== undefined) console.log(chalk.gray(`  Cost: $${log.cost_usd.toFixed(4)}`));
        } catch (e) {
          // If the line is not JSON, display it as-is
          console.log(chalk.gray(line));
        }
      });
    } catch (error) {
      console.log(chalk.yellow('Unable to read the log, or the log is empty'));
    }

    console.log('');
    console.log(chalk.gray('='.repeat(60)));

    // Show available actions
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Action:',
        choices: [
          { name: '🔄 Refresh logs', value: 'refresh' },
          { name: '📄 View more (last 500 lines)', value: 'more' },
          { name: '🔍 Search logs', value: 'search' },
          { name: '◀ Back to main menu', value: 'back' },
        ],
      },
    ]);

    if (action === 'back') {
      break;
    } else if (action === 'more') {
      // Show more logs
      console.clear();
      console.log(chalk.bold.cyan(`📋 Last 500 log lines - ${logFile}`));
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
        console.log(chalk.yellow('Unable to read the log'));
      }

      console.log('');
      await inquirer.prompt([
        {
          type: 'input',
          name: 'continue',
          message: 'Press Enter to return...',
        },
      ]);
    } else if (action === 'search') {
      // Search logs
      const { keyword } = await inquirer.prompt([
        {
          type: 'input',
          name: 'keyword',
          message: 'Enter a search keyword:',
        },
      ]);

      if (keyword) {
        console.clear();
        console.log(chalk.bold.cyan(`🔍 Search results: "${keyword}" - ${logFile}`));
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
            console.log(chalk.yellow('No matching logs found'));
          }
        } catch (error) {
          console.log(chalk.yellow('Search failed or no results were found'));
        }

        console.log('');
        await inquirer.prompt([
          {
            type: 'input',
            name: 'continue',
            message: 'Press Enter to return...',
          },
        ]);
      }
    }
    // refresh: continue the loop and render the logs again
  }

  // Clear the screen before returning
  console.clear();
}

// Configuration management
async function configureSettings() {
  // Part 1: basic configuration
  const basicAnswers = await inquirer.prompt([
    {
      type: 'input',
      name: 'port',
      message: 'Service port:',
      default: config.port,
    },
    {
      type: 'input',
      name: 'host',
      message: 'Host address:',
      default: config.host,
    },
    {
      type: 'input',
      name: 'claudePath',
      message: 'Claude path:',
      default: config.claudePath,
    },
    {
      type: 'input',
      name: 'nodeBinDir',
      message: 'Node.js bin directory (optional, press Enter to skip):',
      default: config.nodeBinDir || '',
    },
    {
      type: 'input',
      name: 'workspacePath',
      message: 'Workspace path (all projects must live under this directory):',
      default: config.workspacePath,
    },
  ]);

  // Update the basic configuration
  Object.assign(config, basicAnswers);

  // Convert an empty nodeBinDir string to null
  if (config.nodeBinDir === '') {
    config.nodeBinDir = null;
  }

  // Part 2: webhook configuration
  const { enableWebhook } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enableWebhook',
      message: 'Enable webhook callbacks?',
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
          if (!input) return true; // Empty values are allowed.
          try {
            new URL(input);
            return true;
          } catch {
            return 'Please enter a valid URL';
          }
        },
      },
      {
        type: 'input',
        name: 'webhookTimeout',
        message: 'Webhook timeout (milliseconds):',
        default: (config.webhook?.timeout || 5000).toString(),
        filter: (input) => parseInt(input),
      },
      {
        type: 'input',
        name: 'webhookRetries',
        message: 'Webhook retry count:',
        default: (config.webhook?.retries || 3).toString(),
        filter: (input) => parseInt(input),
      },
    ]);

    // Update the webhook configuration
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

  // Part 3: task queue configuration
  const queueAnswers = await inquirer.prompt([
    {
      type: 'input',
      name: 'concurrency',
      message: 'Task queue concurrency (1-10):',
      default: (config.taskQueue?.concurrency || 3).toString(),
      validate: (input) => {
        const num = parseInt(input);
        if (isNaN(num) || num < 1 || num > 10) {
          return 'Please enter a number between 1 and 10';
        }
        return true;
      },
      filter: (input) => parseInt(input),
    },
    {
      type: 'input',
      name: 'timeout',
      message: 'Task timeout (milliseconds):',
      default: (config.taskQueue?.defaultTimeout || 300000).toString(),
      filter: (input) => parseInt(input),
    },
  ]);

  config.taskQueue = {
    concurrency: queueAnswers.concurrency,
    defaultTimeout: queueAnswers.timeout,
  };

  // Part 4: security configuration
  const { enableAuth } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enableAuth',
      message: 'Enable API authentication?',
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
      console.log(chalk.cyan('Current API key:'));
      console.log(chalk.bold.white(`  ${currentApiKey}`));
      console.log('');
    }

    const { shouldRegenerate, bypassHealthCheck } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'shouldRegenerate',
        message: 'Regenerate API key?',
        default: false,
      },
      {
        type: 'confirm',
        name: 'bypassHealthCheck',
        message: 'Allow the health check to bypass authentication?',
        default: config.security.auth.bypassHealthCheck !== undefined ? config.security.auth.bypassHealthCheck : true,
      },
    ]);

    if (shouldRegenerate) {
      const { confirmRegenerate } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmRegenerate',
          message: chalk.yellow('Confirm regeneration? The old API key will become invalid immediately!'),
          default: false,
        },
      ]);

      if (confirmRegenerate) {
        config.security.auth.secretKey = generateSecretKey();
        const newApiKey = deriveApiKey(config.security.auth.secretKey);
        console.log('');
        console.log(chalk.green('✓ A new API key has been generated'));
        console.log(chalk.bold.white(`  ${newApiKey}`));
        console.log(chalk.yellow('  Store this key safely!'));
        console.log('');
      }
    } else if (!config.security.auth.secretKey) {
      // Auto-generate if missing
      config.security.auth.secretKey = generateSecretKey();
      const newApiKey = deriveApiKey(config.security.auth.secretKey);
      console.log('');
      console.log(chalk.green('✓ SECRET_KEY was generated automatically'));
      console.log(chalk.bold.white(`  API Key: ${newApiKey}`));
      console.log(chalk.yellow('  Store this key safely!'));
      console.log('');
    }

    config.security.auth.bypassHealthCheck = bypassHealthCheck;
  } else {
    // Auth disabled - keep secretKey for future use
    if (config.security.auth.bypassHealthCheck === undefined) {
      config.security.auth.bypassHealthCheck = true;
    }
  }

  // Swagger documentation configuration
  const { enableSwaggerDocs } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enableSwaggerDocs',
      message: 'Enable Swagger API documentation (/api-docs)?',
      default: config.security?.swaggerDocs?.enabled !== false,
    },
  ]);

  // Initialize swaggerDocs config if not exists
  if (!config.security.swaggerDocs) {
    config.security.swaggerDocs = { enabled: true };
  }
  config.security.swaggerDocs.enabled = enableSwaggerDocs;

  // Save the configuration
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  console.log(chalk.green('✓ Configuration saved'));
  console.log(chalk.cyan('ℹ Configuration will be applied automatically in 1 second (hot reload)'));

  // Show the configuration summary
  console.log('');
  console.log(chalk.bold.cyan('Configuration summary:'));
  console.log(`  ${chalk.white('Port:')} ${config.port}`);
  console.log(`  ${chalk.white('Workspace:')} ${config.workspacePath}`);
  console.log(`  ${chalk.white('Skip permission checks:')} ${config.allowDangerouslySkipPermissions ? chalk.red('Enabled') : chalk.gray('Disabled (default)')}`);
  console.log(`  ${chalk.white('Webhook:')} ${config.webhook.enabled ? chalk.green('Enabled') : chalk.gray('Disabled')}`);
  if (config.webhook.enabled && config.webhook.defaultUrl) {
    console.log(`  ${chalk.white('URL:')} ${config.webhook.defaultUrl}`);
  }
  console.log(`  ${chalk.white('Task queue:')} concurrency ${config.taskQueue?.concurrency || 3}, timeout ${config.taskQueue?.defaultTimeout || 300000}ms`);

  // Security info
  if (config.security?.auth?.enabled) {
    console.log(`  ${chalk.white('API authentication:')} ${chalk.green('Enabled')}`);
    if (config.security.auth.secretKey) {
      const apiKey = deriveApiKey(config.security.auth.secretKey);
      console.log(`  ${chalk.white('API Key:')} ${chalk.bold.cyan(apiKey)}`);
    }
    console.log(`  ${chalk.white('Health check:')} ${config.security.auth.bypassHealthCheck ? chalk.yellow('Bypass authentication') : chalk.gray('Authentication required')}`);
  } else {
    console.log(`  ${chalk.white('API authentication:')} ${chalk.gray('Disabled')}`);
  }
  console.log(`  ${chalk.white('Swagger documentation:')} ${config.security?.swaggerDocs?.enabled !== false ? chalk.green('Enabled') : chalk.red('Disabled')}`);
  console.log('');
}

// Configuration settings
async function visualConfigEditor() {
  // Two-level menu structure: top-level category -> config items grouped by subcategory
  const configHierarchy = [
    {
      name: '📦 Server Configuration',
      categories: [
        {
          name: 'Basic Settings',
          items: [
            { key: 'port', label: 'Service Port', type: 'number' },
            { key: 'host', label: 'Host Address', type: 'string' },
            { key: 'logLevel', label: 'Log Level', type: 'string', options: ['debug', 'info', 'warn', 'error'] },
            { key: 'maxBudgetUsd', label: 'Maximum Budget (USD)', type: 'number' },
          ]
        },
        {
          name: 'Path Settings',
          items: [
            { key: 'claudePath', label: 'Claude Path', type: 'string' },
            { key: 'nodeBinDir', label: 'Node.js Bin Directory', type: 'string' },
            { key: 'workspacePath', label: 'Workspace Path', type: 'string' },
          ]
        },
        {
          name: 'Session Management',
          items: [
            { key: 'sessionRetentionDays', label: 'Session Retention Days', type: 'number' },
          ]
        }
      ]
    },
    {
      name: '⚙️ Feature Configuration',
      categories: [
        {
          name: 'Task Queue',
          items: [
            { key: 'taskQueue.concurrency', label: 'Queue Concurrency', type: 'number' },
            { key: 'taskQueue.defaultTimeout', label: 'Task Timeout (ms)', type: 'number' },
          ]
        },
        {
          name: 'Rate Limiting',
          items: [
            { key: 'rateLimit.enabled', label: 'Enable Rate Limiting', type: 'boolean' },
            { key: 'rateLimit.windowMs', label: 'Time Window (ms)', type: 'number' },
            { key: 'rateLimit.maxRequests', label: 'Maximum Requests', type: 'number' },
          ]
        },
        {
          name: 'Statistics Collection',
          items: [
            { key: 'statistics.enabled', label: 'Enable Statistics Collection', type: 'boolean' },
            { key: 'statistics.collectionInterval', label: 'Collection Interval (ms)', type: 'number' },
          ]
        },
        {
          name: 'Webhook',
          items: [
            { key: 'webhook.enabled', label: 'Enable Webhook', type: 'boolean' },
            { key: 'webhook.defaultUrl', label: 'Webhook URL', type: 'string' },
            { key: 'webhook.timeout', label: 'Timeout (ms)', type: 'number' },
            { key: 'webhook.retries', label: 'Retry Count', type: 'number' },
          ]
        }
      ]
    },
    {
      name: '🔐 Security Configuration',
      categories: [
        {
          name: 'API Authentication',
          items: [
            { key: 'security.auth.enabled', label: 'Enable API Authentication', type: 'boolean' },
            { key: 'security.auth.bypassHealthCheck', label: 'Bypass Health Check Authentication', type: 'boolean' },
            { key: 'view_api_key', label: '🔑 View API Key', type: 'viewkey' },
          ]
        },
        {
          name: 'Permissions and Documentation',
          items: [
            { key: 'security.swaggerDocs.enabled', label: 'Enable Swagger Documentation', type: 'boolean' },
            { key: 'allowDangerouslySkipPermissions', label: 'Skip Permission Checks', type: 'boolean' },
          ]
        }
      ]
    },
    {
      name: '⚖️ Load Balancing',
      categories: [
        {
          name: 'Load Balancing Management',
          items: [
            { key: 'loadbalance', label: '📊 Load Balancing Management', type: 'loadbalance' },
          ]
        },
        {
          name: 'Strategy Settings',
          items: [
            { key: 'loadBalance.strategy', label: 'Balancing Strategy', type: 'string', options: ['round-robin', 'weighted'] },
            { key: 'loadBalance.failover', label: 'Enable Failover', type: 'boolean' },
            { key: 'loadBalance.failureThreshold', label: 'Failure Threshold', type: 'number' },
          ]
        }
      ]
    }
  ];

  console.log('');
  console.log(chalk.bold.cyan('╔═══════════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║        📝 Configuration Settings                              ║'));
  console.log(chalk.bold.cyan('╠═══════════════════════════════════════════════════════════════╣'));
  console.log(chalk.bold.cyan('║ 💡 Select a category → choose a setting                        ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════════════╝'));
  console.log('');

  // Show the API key if authentication is enabled
  if (config.security?.auth?.enabled && config.security.auth.secretKey) {
    const apiKey = deriveApiKey(config.security.auth.secretKey);
    console.log(chalk.bold.cyan('🔐 API authentication info:'));
    console.log(`  ${chalk.white('API Key:')} ${chalk.bold.green(apiKey)}`);
    console.log(`  ${chalk.gray('Tip: add Authorization: Bearer <API-Key> to the request headers')}`);
    console.log('');
  }

  // Helper: build the display label for a config item
  function buildItemDisplay(categoryName, item) {
    const currentValue = getNestedValue(config, item.key);
    const displayValue = formatValue(currentValue, item.type);
    return {
      name: `${chalk.gray(`[${categoryName}]`)} ${chalk.cyan(item.label)}: ${chalk.yellow(displayValue)}`,
      value: item,
      short: `${item.label} (${displayValue})`,
    };
  }

  // Main menu loop
  while (true) {
    // First level: select a category
    const { selectedCategory } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedCategory',
        message: 'Select a configuration category:',
        pageSize: 15,
        choices: [
          ...configHierarchy.map(cat => ({ name: cat.name, value: cat })),
          new inquirer.Separator(),
          { name: '📄 Open the config file in an external editor', value: 'edit' },
          { name: '✖ Save and exit', value: 'quit' },
        ],
      },
    ]);

    if (selectedCategory === 'quit') {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log('');
      console.log(chalk.green('✓ Configuration saved'));
      console.log(chalk.cyan('ℹ Configuration will be applied by hot reload in about 1 second'));
      console.log('');
      break;
    }

    if (selectedCategory === 'edit') {
      await openInEditor();
      config = loadConfig();
      continue;
    }

    // Second level: show all settings in the selected category grouped by subcategory
    const category = selectedCategory;
    let stayInCategory = true;

    while (stayInCategory) {
      // Build the settings list, including subcategory separators
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
          message: `${category.name} - Select a setting:`,
          pageSize: 20,
          choices: [
            ...itemChoices,
            new inquirer.Separator(),
            { name: '◀ Back', value: 'back' },
          ],
        },
      ]);

      if (selectedItem === 'back') {
        stayInCategory = false;
        continue;
      }

      // Edit the selected setting
      const item = selectedItem;
      const currentValue = getNestedValue(config, item.key);

      // Special handling: view the API key
      if (item.type === 'viewkey') {
        console.log('');
        console.log(chalk.bold.cyan('╔═══════════════════════════════════════════════════════════════╗'));
        console.log(chalk.bold.cyan('║                   🔑 API Key Information                      ║'));
        console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════════════╝'));
        console.log('');

        if (config.security?.auth?.enabled && config.security.auth.secretKey) {
          const apiKey = deriveApiKey(config.security.auth.secretKey);
          console.log(`${chalk.white('API Key:')} ${chalk.bold.green(apiKey)}`);
          console.log('');
          console.log(chalk.cyan('Usage:'));
          console.log(chalk.gray('  curl -X POST http://localhost:5546/api/messages \\'));
          console.log(chalk.gray('    -H "Content-Type: application/json" \\'));
          console.log(chalk.gray('    -H "Authorization: Bearer ' + apiKey + '" \\'));
          console.log(chalk.gray('    -d \'{"prompt": "Hello"}\''));
          console.log('');
        } else {
          console.log(chalk.yellow('⚠ API authentication is not enabled'));
          console.log('');
          console.log(chalk.gray('Enable "Enable API Authentication" first and the system will generate an API key automatically'));
          console.log('');
        }

        await inquirer.prompt([
          {
            type: 'confirm',
            name: 'continue',
            message: 'Press Enter to continue',
            default: true,
          },
        ]);
      } else if (item.type === 'loadbalance') {
        // Special handling: load balancing management
        await loadBalanceMenu();
        // Reload the configuration because it may have changed
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
        console.log(chalk.green(`✓ ${item.label} updated`));
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
        console.log(chalk.green(`✓ ${item.label} updated`));
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
        console.log(chalk.green(`✓ ${item.label} updated`));
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
        console.log(chalk.green(`✓ ${item.label} updated`));
      }
    }
  }
}

function formatValue(value, type) {
  // Special type: viewing the API key always shows a fixed label
  if (type === 'viewkey') return 'Click to view';

  // Check whether the value exists first
  if (value === undefined || value === null) return 'Not set';

  // Type-specific formatting
  if (type === 'boolean') return value ? 'Yes' : 'No';

  // Safe conversion for other value types
  try {
    return String(value);
  } catch (e) {
    return 'Not set';
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
  console.log(chalk.cyan(`Opening the configuration file with ${editor}...`));
  console.log(chalk.gray(`File: ${configPath}`));
  console.log('');

  const { execSync } = require('child_process');
  try {
    execSync(`${editor} ${configPath}`, { stdio: 'inherit' });
    console.log('');
    console.log(chalk.green('✓ Editor closed and configuration updated'));

    // Reload the configuration
    const updatedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    Object.assign(config, updatedConfig);
  } catch (error) {
    console.log('');
    console.error(chalk.red('✗ Failed to open editor:', error.message));
  }
}

// Show API documentation
async function showApiDocs() {
  const docsUrl = `http://localhost:${config.port}/api-docs`;

  console.log('');
  console.log(chalk.bold.cyan('╔════════════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║            Nexus Bridge - API Documentation                   ║'));
  console.log(chalk.bold.cyan('╚════════════════════════════════════════════════════════════════╝'));
  console.log('');

  console.log(chalk.bold('📖 Interactive API Documentation (Swagger UI)'));
  console.log('');
  console.log(chalk.white('Open this URL in your browser:'));
  console.log('');
  console.log(chalk.bold.cyan(`  ${docsUrl}`));
  console.log('');
  console.log(chalk.gray('Swagger UI provides:'));
  console.log(chalk.gray('  • A complete list of API endpoints and descriptions'));
  console.log(chalk.gray('  • In-browser API testing'));
  console.log(chalk.gray('  • Request/response examples'));
  console.log(chalk.gray('  • Authentication setup guidance'));
  console.log('');

  const { openBrowser } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'openBrowser',
      message: 'Open the documentation in your browser?',
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
        console.log(chalk.yellow('⚠ Unable to open the browser automatically. Please visit: ' + docsUrl));
      } else {
        console.log(chalk.green('✓ Opened documentation in the browser'));
      }
    });
  }
  console.log('');
}

// Test the API
async function testApi() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ Service is not running. Start it first.'));
    return;
  }

  const spinner = ora('Testing the API...').start();

  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/health`, {}, config);
    const data = await response.json();

    spinner.succeed(chalk.green('Health check passed'));
    console.log(JSON.stringify(data, null, 2));

    // Test the Nexus Bridge API
    const spinner2 = ora('Testing the Nexus Bridge API...').start();
    const claudeResponse = await authenticatedFetch(`http://localhost:${config.port}/api/messages`, {
      method: 'POST',
      body: JSON.stringify({ prompt: 'Say hello' }),
    }, config);
    const claudeData = await claudeResponse.json();

    if (claudeData.success) {
      spinner2.succeed(chalk.green('Nexus Bridge API test succeeded'));
      console.log(chalk.gray('Reply: ') + claudeData.result);
      console.log(chalk.gray(`Duration: ${claudeData.duration_ms}ms, Cost: $${claudeData.cost_usd}`));
    } else {
      spinner2.warn(chalk.yellow('Nexus Bridge API returned an error'));
      console.log(JSON.stringify(claudeData, null, 2));
    }
  } catch (error) {
    spinner.fail('Test failed: ' + error.message);
  }
}

// ========== Session Management ==========

// List all sessions
async function listSessions() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ Service is not running. Start it first.'));
    return;
  }

  const spinner = ora('Fetching session list...').start();

  try {
    // Fetch the session list and load-balancing bindings in parallel
    const [sessionsResponse, bindingsResponse, lbStatusResponse] = await Promise.all([
      authenticatedFetch(`http://localhost:${config.port}/api/sessions`, {}, config),
      authenticatedFetch(`http://localhost:${config.port}/api/load-balance/bindings`, {}, config).catch(() => ({ json: () => ({ success: false, bindings: {} }) })),
      authenticatedFetch(`http://localhost:${config.port}/api/load-balance/status`, {}, config).catch(() => ({ json: () => ({ success: false, providers: [] }) })),
    ]);

    const data = await sessionsResponse.json();
    const bindingsData = await bindingsResponse.json();
    const lbStatusData = await lbStatusResponse.json();

    spinner.stop();

    // Build a providerId -> providerName mapping
    const providerNames = {};
    if (lbStatusData.success && lbStatusData.providers) {
      lbStatusData.providers.forEach(p => {
        providerNames[p.id] = p.name;
      });
    }

    if (data.success && data.sessions.length > 0) {
      console.log('');
      console.log(chalk.bold.cyan(`Found ${data.sessions.length} sessions:`));
      console.log('');

      data.sessions.forEach((session, index) => {
        const statusColor = session.status === 'active' ? chalk.green : chalk.gray;
        const providerId = bindingsData.bindings?.[session.id];
        const providerName = providerId ? (providerNames[providerId] || providerId) : null;

        console.log(`${chalk.bold((index + 1) + '.')} ${chalk.white(session.id.substring(0, 8))}... - ${statusColor('● ' + session.status)}`);
        console.log(`   ${chalk.gray('Project:')} ${session.project_path}`);
        console.log(`   ${chalk.gray('Model:')} ${session.model}`);
        if (providerName) {
          console.log(`   ${chalk.gray('Provider:')} ${chalk.magenta(providerName)}`);
        }
        console.log(`   ${chalk.gray('Messages:')} ${session.messages_count} | ${chalk.gray('Cost:')} $${session.total_cost_usd.toFixed(4)}`);
        console.log(`   ${chalk.gray('Created:')} ${new Date(session.created_at).toLocaleString()}`);
        console.log('');
      });
    } else {
      spinner.warn('No sessions found');
    }
  } catch (error) {
    spinner.fail('Failed to fetch the session list: ' + error.message);
  }
}

// List historical projects
async function listProjects() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ Service is not running. Start it first.'));
    return;
  }

  const spinner = ora('Fetching historical projects...').start();

  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/projects`, {}, config);
    const data = await response.json();

    spinner.stop();

    if (data.success && data.projects.length > 0) {
      console.log('');
      console.log(chalk.bold.cyan(`Found ${data.projects.length} historical projects:`));
      console.log('');

      data.projects.forEach((project, index) => {
        console.log(`${chalk.bold((index + 1) + '.')} ${chalk.white(project.relative_path)}`);
        console.log(`   ${chalk.gray('Path:')} ${project.project_path}`);
        console.log(`   ${chalk.gray('Sessions:')} ${project.session_count} | ${chalk.gray('Messages:')} ${project.messages_count} | ${chalk.gray('Cost:')} $${project.total_cost_usd.toFixed(4)}`);
        console.log(`   ${chalk.gray('Last Activity:')} ${new Date(project.last_activity).toLocaleString()}`);
        console.log('');
      });
    } else {
      spinner.warn('No historical projects found');
    }
  } catch (error) {
    spinner.fail('Failed to fetch the project list: ' + error.message);
  }
}

// View session details
async function viewSessionDetails() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ Service is not running. Start it first.'));
    return;
  }

  const spinner = ora('Fetching session list...').start();

  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/sessions`, {}, config);
    const data = await response.json();

    spinner.stop();

    if (!data.success || data.sessions.length === 0) {
      console.log(chalk.yellow('No sessions found'));
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
        message: 'Select a session to view:',
        choices,
      },
    ]);

    const spinner2 = ora('Fetching session details...').start();

    // Fetch session details and load-balancing binding information in parallel
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

      // Build a providerId -> providerName mapping
      const providerNames = {};
      if (lbStatusData.success && lbStatusData.providers) {
        lbStatusData.providers.forEach(p => {
          providerNames[p.id] = p.name;
        });
      }

      const providerId = bindingsData.bindings?.[session.id];
      const providerName = providerId ? (providerNames[providerId] || providerId) : null;

      console.log('');
      console.log(chalk.bold.cyan('Session Details:'));
      console.log('');
      console.log(`${chalk.white('ID:')}            ${session.id}`);
      console.log(`${chalk.white('Status:')}        ${session.status}`);
      console.log(`${chalk.white('Project Path:')}  ${session.project_path}`);
      console.log(`${chalk.white('Model:')}         ${session.model}`);
      if (providerName) {
        console.log(`${chalk.white('Provider:')}      ${chalk.magenta(providerName)}`);
      }
      console.log(`${chalk.white('Messages:')}      ${session.messages_count}`);
      console.log(`${chalk.white('Total Cost:')}    $${session.total_cost_usd.toFixed(4)}`);
      console.log(`${chalk.white('Created At:')}    ${new Date(session.created_at).toLocaleString()}`);
      console.log(`${chalk.white('Updated At:')}    ${new Date(session.updated_at).toLocaleString()}`);
      if (session.metadata && Object.keys(session.metadata).length > 0) {
        console.log(`${chalk.white('Metadata:')}      ${JSON.stringify(session.metadata)}`);
      }
      console.log('');
    } else {
      console.log(chalk.red('Failed to fetch session details'));
    }
  } catch (error) {
    spinner.fail('Operation failed: ' + error.message);
  }
}

// Delete a session
async function deleteSession() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ Service is not running. Start it first.'));
    return;
  }

  const spinner = ora('Fetching session list...').start();

  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/sessions`, {}, config);
    const data = await response.json();

    spinner.stop();

    if (!data.success || data.sessions.length === 0) {
      console.log(chalk.yellow('No sessions found'));
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
        message: 'Select a session to delete:',
        choices,
      },
    ]);

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Confirm deletion of this session?',
        default: false,
      },
    ]);

    if (!confirm) {
      console.log(chalk.gray('Cancelled'));
      return;
    }

    const spinner2 = ora('Deleting session...').start();
    const deleteResponse = await authenticatedFetch(`http://localhost:${config.port}/api/sessions/${sessionId}`, {
      method: 'DELETE',
    }, config);
    const deleteData = await deleteResponse.json();

    spinner2.stop();

    if (deleteData.success) {
      console.log(chalk.green('✓ Session deleted'));
    } else {
      console.log(chalk.red('Delete failed: ' + deleteData.error));
    }
  } catch (error) {
    spinner.fail('Operation failed: ' + error.message);
  }
}

// Session management menu
async function sessionManagementMenu() {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Session Management',
      pageSize: 10,
      choices: [
        { name: '📜 List All Sessions', value: 'list' },
        { name: '🔍 View Session Details', value: 'view' },
        { name: '🗑 Delete Session', value: 'delete' },
        { name: '◀ Back to main menu', value: 'back' },
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

// ========== Statistics ==========

// View summary statistics
async function viewStatisticsSummary() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ Service is not running. Start it first.'));
    return;
  }

  const spinner = ora('Fetching statistics...').start();

  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/statistics/summary`, {}, config);
    const data = await response.json();

    spinner.stop();

    if (data.success) {
      const stats = data.statistics;
      console.log('');
      console.log(chalk.bold.cyan('Usage Summary:'));
      console.log('');
      console.log(`${chalk.white('Total Requests:')}   ${stats.requests.total}`);
      console.log(`${chalk.green('Successful:')}       ${stats.requests.successful}`);
      console.log(`${chalk.red('Failed:')}           ${stats.requests.failed}`);
      console.log(`${chalk.white('Token Usage:')}`);
      console.log(`  ${chalk.gray('- Input:')}       ${stats.tokens.total_input.toLocaleString()}`);
      console.log(`  ${chalk.gray('- Output:')}      ${stats.tokens.total_output.toLocaleString()}`);
      console.log(`${chalk.white('Total Cost:')}       $${stats.costs.total_usd.toFixed(4)}`);
      console.log('');
    } else {
      console.log(chalk.red('Failed to fetch statistics'));
    }
  } catch (error) {
    spinner.fail('Failed to fetch statistics: ' + error.message);
  }
}

// View daily statistics
async function viewDailyStatistics() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ Service is not running. Start it first.'));
    return;
  }

  const spinner = ora('Fetching daily statistics...').start();

  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/statistics/daily?limit=7`, {}, config);
    const data = await response.json();

    spinner.stop();

    if (data.success && data.daily.length > 0) {
      console.log('');
      console.log(chalk.bold.cyan(`Last ${data.daily.length} days of statistics:`));
      console.log('');

      data.daily.forEach((day, index) => {
        console.log(`${chalk.bold((index + 1) + '.')} ${chalk.white(day.date)}`);
        console.log(`   ${chalk.gray('Requests:')} ${day.total_requests} | ${chalk.gray('Successful:')} ${day.successful_requests} | ${chalk.gray('Failed:')} ${day.failed_requests}`);
        console.log(`   ${chalk.gray('Cost:')} $${day.total_cost_usd.toFixed(4)} | ${chalk.gray('Input Tokens:')} ${day.total_input_tokens.toLocaleString()} | ${chalk.gray('Output Tokens:')} ${day.total_output_tokens.toLocaleString()}`);
        console.log('');
      });
    } else {
      spinner.warn('No statistics found');
    }
  } catch (error) {
    spinner.fail('Failed to fetch statistics: ' + error.message);
  }
}

// Statistics menu
async function statisticsMenu() {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Statistics',
      choices: [
        { name: '📊 View Summary Statistics', value: 'summary' },
        { name: '📅 View Daily Statistics', value: 'daily' },
        { name: '◀ Back to main menu', value: 'back' },
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

// ========== Tasks ==========

// List all tasks
async function listTasks() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ Service is not running. Start it first.'));
    return;
  }

  const spinner = ora('Fetching task list...').start();

  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/tasks`, {}, config);
    const data = await response.json();

    spinner.stop();

    if (data.success && data.tasks.length > 0) {
      console.log('');
      console.log(chalk.bold.cyan(`Found ${data.tasks.length} tasks:`));
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

        console.log(`${chalk.bold((index + 1) + '.')} ${chalk.white(task.id)} - ${statusColor('● ' + task.status)} ${chalk.gray('(Priority: ' + task.priority + ')')}`);
        console.log(`   ${chalk.gray('Prompt:')} ${task.prompt.substring(0, 180)}${task.prompt.length > 120 ? '...' : ''}`);
        if (task.status === 'completed') {
          console.log(`   ${chalk.green('Result:')} ${task.result?.substring(0, 120)}${task.result?.length > 120 ? '...' : ''}`);
          console.log(`   ${chalk.gray('Duration:')} ${task.duration_ms}ms | ${chalk.gray('Cost:')} $${task.cost_usd.toFixed(4)}`);
        } else if (task.status === 'failed') {
          console.log(`   ${chalk.red('Error:')} ${task.error}`);
        }
        console.log(`   ${chalk.gray('Created:')} ${new Date(task.created_at).toLocaleString()}`);
        console.log('');
      });
    } else {
      spinner.warn('No tasks found');
    }
  } catch (error) {
    spinner.fail('Failed to fetch the task list: ' + error.message);
  }
}

// View queue status
async function viewQueueStatus() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ Service is not running. Start it first.'));
    return;
  }

  const spinner = ora('Fetching queue status...').start();

  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/tasks/queue/status`, {}, config);
    const data = await response.json();

    spinner.stop();

    if (data.success) {
      const queue = data.queue;
      console.log('');
      console.log(chalk.bold.cyan('Task Queue Status:'));
      console.log('');
      console.log(`${chalk.white('Running State:')} ${queue.running ? chalk.green('Running') : chalk.gray('Stopped')}`);
      console.log(`${chalk.white('Concurrency:')}   ${queue.concurrency}`);
      console.log(`${chalk.white('Active Tasks:')}  ${queue.active_tasks}`);
      console.log(`${chalk.white('Task Statistics:')}`);
      console.log(`  ${chalk.gray('- Total:')}      ${queue.total}`);
      console.log(`  ${chalk.yellow('- Pending:')}    ${queue.pending}`);
      console.log(`  ${chalk.blue('- Processing:')} ${queue.processing}`);
      console.log(`  ${chalk.green('- Completed:')}  ${queue.completed}`);
      console.log(`  ${chalk.red('- Failed:')}      ${queue.failed}`);
      console.log(`  ${chalk.gray('- Cancelled:')}   ${queue.cancelled}`);
      console.log(`  ${chalk.gray('- Total Cost:')}  $${queue.total_cost_usd.toFixed(4)}`);
      console.log('');
    } else {
      console.log(chalk.red('Failed to fetch queue status'));
    }
  } catch (error) {
    spinner.fail('Failed to fetch queue status: ' + error.message);
  }
}

// Adjust task priority
async function changeTaskPriority() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ Service is not running. Start it first.'));
    return;
  }

  const spinner = ora('Fetching pending tasks...').start();

  try {
    // Fetch tasks in pending and processing states
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/tasks?status=pending`, {}, config);
    const data = await response.json();

    spinner.stop();

    if (!data.success || data.tasks.length === 0) {
      console.log(chalk.yellow('No tasks are available for priority changes'));
      return;
    }

    // Let the user choose a task
    const choices = data.tasks.map(task => ({
      name: `${task.id.substring(0, 8)}... - Priority: ${task.priority} - ${task.prompt.substring(0, 50)}...`,
      value: task.id,
      short: task.id.substring(0, 8),
    }));

    const { taskId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'taskId',
        message: 'Select a task to reprioritize:',
        choices: choices,
      },
    ]);

    const task = data.tasks.find(t => t.id === taskId);

    // Let the user enter the new priority
    const { priority } = await inquirer.prompt([
      {
        type: 'input',
        name: 'priority',
        message: `Enter a new priority (1-10, current: ${task.priority}):`,
        default: task.priority.toString(),
        validate: (input) => {
          const num = parseInt(input);
          if (isNaN(num) || num < 1 || num > 10) {
            return 'Please enter a number between 1 and 10';
          }
          return true;
        },
        filter: (input) => parseInt(input),
      },
    ]);

    // Update the priority
    const updateSpinner = ora('Updating priority...').start();
    const updateResponse = await authenticatedFetch(`http://localhost:${config.port}/api/tasks/${taskId}/priority`, {
      method: 'PATCH',
      body: JSON.stringify({ priority }),
    }, config);

    const updateData = await updateResponse.json();
    updateSpinner.stop();

    if (updateData.success) {
      console.log('');
      console.log(chalk.green('✓ Priority updated'));
      console.log(`  Task ID: ${updateData.task_id.substring(0, 8)}...`);
      console.log(`  Old Priority: ${updateData.old_priority}`);
      console.log(`  New Priority: ${updateData.new_priority}`);
      console.log('');
    } else {
      console.log(chalk.red('✗ Update failed: ' + updateData.error));
    }
  } catch (error) {
    spinner.fail('Operation failed: ' + error.message);
  }
}

// Cancel a task
async function cancelTask() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ Service is not running. Start it first.'));
    return;
  }

  const spinner = ora('Fetching cancellable tasks...').start();

  try {
    // Fetch tasks in pending and processing states
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
      console.log(chalk.yellow('No cancellable tasks found'));
      return;
    }

    // Let the user choose a task
    const choices = cancellableTasks.map(task => ({
      name: `${task.id.substring(0, 8)}... [${task.status}] Priority: ${task.priority} - ${task.prompt.substring(0, 40)}...`,
      value: task.id,
      short: task.id.substring(0, 8),
    }));

    const { taskId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'taskId',
        message: 'Select a task to cancel:',
        choices: choices,
      },
    ]);

    // Confirm cancellation
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Are you sure you want to cancel this task?',
        default: false,
      },
    ]);

    if (!confirm) {
      console.log(chalk.gray('Operation cancelled'));
      return;
    }

    // Cancel the task
    const cancelSpinner = ora('Cancelling task...').start();
    const cancelResponse = await authenticatedFetch(`http://localhost:${config.port}/api/tasks/${taskId}`, {
      method: 'DELETE',
    }, config);

    const cancelData = await cancelResponse.json();
    cancelSpinner.stop();

    if (cancelData.success) {
      console.log('');
      console.log(chalk.green('✓ Task cancelled'));
      console.log(`  Task ID: ${taskId.substring(0, 8)}...`);
      console.log('');
    } else {
      console.log(chalk.red('✗ Cancellation failed: ' + cancelData.error));
    }
  } catch (error) {
    spinner.fail('Operation failed: ' + error.message);
  }
}

// Tasks menu
async function tasksMenu() {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Task List',
      pageSize: 10,
      choices: [
        { name: '📜 List All Tasks', value: 'list' },
        { name: '📊 View Queue Status', value: 'status' },
        { name: '⚡ Adjust Task Priority', value: 'priority' },
        { name: '✖ Cancel Task', value: 'cancel' },
        { name: '◀ Back to main menu', value: 'back' },
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

// ========== Load Balancing Management ==========

// View load-balancing status
async function viewLoadBalanceStatus() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ Service is not running. Start it first.'));
    return;
  }

  const spinner = ora('Fetching load-balancing status...').start();

  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/load-balance/status`, {}, config);
    const data = await response.json();

    spinner.stop();

    if (data.success) {
      // The API returns strategy, failover, and providers directly, not nested under status.
      const strategy = data.strategy || 'none';
      const failover = data.failover || false;
      const providers = data.providers || [];

      console.log('');
      console.log(chalk.bold.cyan('Load Balancing Status:'));
      console.log('');

      if (strategy === 'none') {
        console.log(chalk.gray('Load balancing is not enabled (providers are not configured)'));
        console.log('');
        console.log(chalk.gray('Tip: add providers to config.json to enable load balancing'));
      } else {
        console.log(`${chalk.white('Strategy:')} ${strategy === 'round-robin' ? 'Round Robin' : 'Weighted'}`);
        console.log(`${chalk.white('Failover:')} ${failover ? 'Enabled' : 'Disabled'}`);
        console.log('');

        if (providers.length > 0) {
          console.log(chalk.bold.white('Provider List:'));
          console.log('');
          providers.forEach((provider, index) => {
            const healthIcon = provider.healthy ? chalk.green('✓') : chalk.red('✗');
            const healthText = provider.healthy ? chalk.green('Healthy') : chalk.red('Unhealthy');
            console.log(`${chalk.bold((index + 1) + '.')} ${chalk.white(provider.name || provider.id)}`);
            console.log(`   ${healthIcon} Status: ${healthText} | ${chalk.gray('Weight:')} ${provider.weight} | ${chalk.gray('Bound Sessions:')} ${provider.boundSessions}`);
            console.log(`   ${chalk.gray('Total Requests:')} ${provider.totalRequests} | ${chalk.gray('Consecutive Failures:')} ${provider.consecutiveFailures}`);
            console.log('');
          });
        } else {
          console.log(chalk.gray('No providers are configured'));
        }
      }
    } else {
      console.log(chalk.red('Failed to fetch load-balancing status: ' + (data.error || 'Unknown error')));
    }
  } catch (error) {
    spinner.fail('Failed to fetch load-balancing status: ' + error.message);
  }
}

// View session bindings
async function viewSessionBindings() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ Service is not running. Start it first.'));
    return;
  }

  const spinner = ora('Fetching session bindings...').start();

  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/load-balance/bindings`, {}, config);
    const data = await response.json();

    spinner.stop();

    if (data.success) {
      const bindings = data.bindings;
      const entries = Object.entries(bindings);

      console.log('');
      console.log(chalk.bold.cyan('Session Bindings:'));
      console.log('');

      if (entries.length > 0) {
        entries.forEach(([sessionId, providerId], index) => {
          console.log(`${chalk.bold((index + 1) + '.')} ${chalk.white('Session:')} ${sessionId.substring(0, 8)}... → ${chalk.white('Provider:')} ${providerId}`);
        });
        console.log('');
        console.log(chalk.gray(`Total: ${entries.length} session bindings`));
      } else {
        console.log(chalk.gray('No session bindings'));
      }
      console.log('');
    } else {
      console.log(chalk.red('Failed to fetch session bindings'));
    }
  } catch (error) {
    spinner.fail('Failed to fetch session bindings: ' + error.message);
  }
}

// Reset provider health
async function resetProviderHealth() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ Service is not running. Start it first.'));
    return;
  }

  // Fetch the provider list first
  let providers = [];
  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/load-balance/status`, {}, config);
    const data = await response.json();
    if (data.success && data.providers) {
      providers = data.providers;
    }
  } catch (error) {
    console.log(chalk.red('Failed to fetch the provider list: ' + error.message));
    return;
  }

  if (providers.length === 0) {
    console.log(chalk.yellow('No providers are available (configure providers first in ~/.nexus-bridge/config.json)'));
    return;
  }

  const { providerId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'providerId',
      message: 'Select a provider to reset',
      choices: providers.map(p => ({
        name: `${p.name || p.id} ${p.healthy ? chalk.green('(healthy)') : chalk.red('(unhealthy)')}`,
        value: p.id,
      })),
    },
  ]);

  const spinner = ora('Resetting provider health...').start();

  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/load-balance/providers/${providerId}/reset`, {
      method: 'POST',
    }, config);
    const data = await response.json();

    spinner.stop();

    if (data.success) {
      console.log(chalk.green(`✓ Provider ${providerId} was reset to healthy`));
    } else {
      console.log(chalk.red(`Reset failed: ${data.error}`));
    }
  } catch (error) {
    spinner.fail('Reset failed: ' + error.message);
  }
}

// Enable or disable a provider
async function toggleProvider() {
  const { running } = isServerRunning();

  if (!running) {
    console.log(chalk.red('✗ Service is not running. Start it first.'));
    return;
  }

  // Fetch the provider list first
  let providers = [];
  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/load-balance/status`, {}, config);
    const data = await response.json();
    if (data.success && data.providers) {
      providers = data.providers;
    }
  } catch (error) {
    console.log(chalk.red('Failed to fetch the provider list: ' + error.message));
    return;
  }

  if (providers.length === 0) {
    console.log(chalk.yellow('No providers are available (configure providers first in ~/.nexus-bridge/config.json)'));
    return;
  }

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Select an action',
      choices: [
        { name: '✓ Enable Provider', value: 'enable' },
        { name: '✗ Disable Provider', value: 'disable' },
        { name: '◀ Back', value: 'back' },
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
      message: `Select a provider to ${action === 'enable' ? 'enable' : 'disable'}`,
      choices: providers.map(p => ({
        name: `${p.name || p.id} ${p.enabled ? chalk.green('(enabled)') : chalk.gray('(disabled)')}`,
        value: p.id,
      })),
    },
  ]);

  const spinner = ora(`${action === 'enable' ? 'Enabling' : 'Disabling'} provider...`).start();

  try {
    const response = await authenticatedFetch(`http://localhost:${config.port}/api/load-balance/providers/${providerId}/${action}`, {
      method: 'POST',
    }, config);
    const data = await response.json();

    spinner.stop();

    if (data.success) {
      console.log(chalk.green(`✓ Provider ${providerId} ${action === 'enable' ? 'enabled' : 'disabled'}`));
    } else {
      console.log(chalk.red(`Operation failed: ${data.error}`));
    }
  } catch (error) {
    spinner.fail('Operation failed: ' + error.message);
  }
}

// ========== Load Balancing Configuration ==========

// Read the config file
function readConfigFile() {
  const configPath = path.join(os.homedir(), runtimeDirName, 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.log(chalk.red('Failed to read the config file: ' + error.message));
  }
  return {};
}

// Write the config file
function writeConfigFile(configData) {
  const configPath = path.join(os.homedir(), runtimeDirName, 'config.json');
  try {
    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.log(chalk.red('Failed to write the config file: ' + error.message));
    return false;
  }
}

// Add a provider
async function addProvider() {
  console.log('');
  console.log(chalk.bold.cyan('Add a New Provider'));
  console.log('');

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'id',
      message: 'Provider ID (unique identifier, for example provider-1):',
      validate: (input) => {
        if (!input || !input.trim()) return 'Please enter a provider ID';
        if (!/^[a-zA-Z0-9_-]+$/.test(input)) return 'The ID may contain only letters, numbers, underscores, and hyphens';
        return true;
      },
    },
    {
      type: 'input',
      name: 'name',
      message: 'Provider name (display name):',
      default: (answers) => answers.id,
    },
    {
      type: 'input',
      name: 'apiKey',
      message: 'Auth Token (ANTHROPIC_AUTH_TOKEN):',
      validate: (input) => input && input.trim() ? true : 'Please enter an auth token',
    },
    {
      type: 'input',
      name: 'baseUrl',
      message: 'Base URL (default: https://api.anthropic.com):',
      default: 'https://api.anthropic.com',
    },
    {
      type: 'number',
      name: 'weight',
      message: 'Weight (used for weighted balancing, default 1):',
      default: 1,
      min: 1,
      max: 100,
    },
    {
      type: 'confirm',
      name: 'enabled',
      message: 'Enable it?',
      default: true,
    },
    {
      type: 'confirm',
      name: 'addEnv',
      message: 'Add custom environment variables?',
      default: false,
    },
  ]);

  // Add environment variables if requested
  let env = {};
  if (answers.addEnv) {
    let addMore = true;
    while (addMore) {
      const envAnswer = await inquirer.prompt([
        {
          type: 'input',
          name: 'key',
          message: 'Environment variable name (for example CUSTOM_API_HEADER):',
          validate: (input) => input && input.trim() ? true : 'Please enter an environment variable name',
        },
        {
          type: 'input',
          name: 'value',
          message: 'Environment variable value:',
          validate: (input) => input !== undefined && input !== null ? true : 'Please enter an environment variable value',
        },
        {
          type: 'confirm',
          name: 'addMore',
          message: 'Add more environment variables?',
          default: false,
        },
      ]);
      env[envAnswer.key] = envAnswer.value;
      addMore = envAnswer.addMore;
    }
  }

  // Read the current config
  const configData = readConfigFile();
  if (!configData.providers) {
    configData.providers = [];
  }

  // Check whether the ID already exists
  if (configData.providers.some(p => p.id === answers.id)) {
    console.log(chalk.red(`Provider ID "${answers.id}" already exists`));
    return;
  }

  // Add the new provider
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

  // Automatically initialize loadBalance when adding the first provider
  if (!configData.loadBalance) {
    configData.loadBalance = {
      strategy: 'round-robin',
      failureThreshold: 3,
      failover: true,
    };
  }

  if (writeConfigFile(configData)) {
    console.log(chalk.green(`✓ Provider "${answers.name}" added`));
    console.log(chalk.gray('Configuration saved, the server will reload automatically'));
  }
}

// Edit a provider
async function editProvider() {
  const configData = readConfigFile();
  const providers = configData.providers || [];

  if (providers.length === 0) {
    console.log(chalk.yellow('No providers are available to edit'));
    return;
  }

  const { providerId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'providerId',
      message: 'Select a provider to edit',
      choices: providers.map(p => ({
        name: `${p.name || p.id} (${p.enabled ? chalk.green('enabled') : chalk.gray('disabled')})`,
        value: p.id,
      })),
    },
  ]);

  const provider = providers.find(p => p.id === providerId);
  if (!provider) {
    console.log(chalk.red('Provider not found'));
    return;
  }

  console.log('');
  console.log(chalk.bold.cyan(`Edit Provider: ${provider.name || provider.id}`));
  console.log(chalk.gray('(press Enter to keep the current value)'));
  console.log('');

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Provider Name:',
      default: provider.name,
    },
    {
      type: 'input',
      name: 'apiKey',
      message: 'API Key (leave blank to keep unchanged):',
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
      message: 'Weight:',
      default: provider.weight || 1,
      min: 1,
      max: 100,
    },
    {
      type: 'confirm',
      name: 'enabled',
      message: 'Enable it?',
      default: provider.enabled !== false,
    },
  ]);

  // Update the provider
  provider.name = answers.name;
  if (answers.apiKey && answers.apiKey.trim()) {
    provider.apiKey = answers.apiKey;
  }
  provider.baseUrl = answers.baseUrl;
  provider.weight = answers.weight;
  provider.enabled = answers.enabled;

  if (writeConfigFile(configData)) {
    console.log(chalk.green(`✓ Provider "${provider.name}" updated`));
    console.log(chalk.gray('Configuration saved, the server will reload automatically'));
  }
}

// Remove a provider
async function removeProvider() {
  const configData = readConfigFile();
  const providers = configData.providers || [];

  if (providers.length === 0) {
    console.log(chalk.yellow('No providers are available to delete'));
    return;
  }

  const { providerId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'providerId',
      message: 'Select a provider to delete',
      choices: providers.map(p => ({
        name: `${p.name || p.id} (${p.enabled ? chalk.green('enabled') : chalk.gray('disabled')})`,
        value: p.id,
      })),
    },
  ]);

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Confirm deletion of this provider?',
      default: false,
    },
  ]);

  if (!confirm) {
    console.log(chalk.gray('Cancelled'));
    return;
  }

  const index = providers.findIndex(p => p.id === providerId);
  if (index !== -1) {
    const removed = providers.splice(index, 1)[0];
    configData.providers = providers;

    if (writeConfigFile(configData)) {
      console.log(chalk.green(`✓ Provider "${removed.name || removed.id}" deleted`));
      console.log(chalk.gray('Configuration saved, the server will reload automatically'));
    }
  }
}

// Configure the load-balancing strategy
async function configureLoadBalance() {
  const configData = readConfigFile();

  console.log('');
  console.log(chalk.bold.cyan('Configure Load-Balancing Strategy'));
  console.log('');

  const currentStrategy = configData.loadBalance?.strategy || 'round-robin';
  const currentFailover = configData.loadBalance?.failover !== false;
  const currentThreshold = configData.loadBalance?.failureThreshold || 3;

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'strategy',
      message: 'Select a load-balancing strategy:',
      choices: [
        { name: 'Round Robin - distribute sequentially', value: 'round-robin' },
        { name: 'Weighted - distribute by weight', value: 'weighted' },
      ],
      default: currentStrategy,
    },
    {
      type: 'confirm',
      name: 'failover',
      message: 'Enable failover (automatically switch when a provider becomes unhealthy)?',
      default: currentFailover,
    },
    {
      type: 'number',
      name: 'failureThreshold',
      message: 'Mark as unhealthy after how many consecutive failures:',
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
    console.log(chalk.green('✓ Load-balancing configuration updated'));
    console.log(chalk.gray('Configuration saved, the server will reload automatically'));
  }
}

// Load-balancing management menu
async function loadBalanceMenu() {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Load Balancing Management',
      pageSize: 12,
      choices: [
        { name: '📊 View Load-Balancing Status', value: 'status' },
        { name: '🔗 View Session Bindings', value: 'bindings' },
        new inquirer.Separator(),
        { name: '➕ Add Provider', value: 'add' },
        { name: '✏️  Edit Provider', value: 'edit' },
        { name: '🗑️  Delete Provider', value: 'remove' },
        new inquirer.Separator(),
        { name: '⚙️  Configure Load-Balancing Strategy', value: 'config' },
        { name: '🔄 Reset Provider Health', value: 'reset' },
        { name: '⚡ Enable/Disable Provider', value: 'toggle' },
        new inquirer.Separator(),
        { name: '◀ Back to main menu', value: 'back' },
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

// Main menu
async function mainMenu() {
  const { running, pid } = isServerRunning();

  const statusText = running ? chalk.green('[Running]') : chalk.gray('[Not running]');
  const versionText = chalk.cyan(`v${version}`);
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: `Nexus Bridge Manager ${versionText} ${statusText}`,
      pageSize: 15, // Number of visible menu rows
      choices: [
        { name: '▶ Start Service', value: 'start', disabled: running ? 'Already running' : false },
        { name: '■ Stop Service', value: 'stop', disabled: !running ? 'Not running' : false },
        { name: '● View Status', value: 'status' },
        { name: '💬 Session Management', value: 'sessions', disabled: !running ? 'Service is not running' : false },
        { name: '📊 View Statistics', value: 'statistics', disabled: !running ? 'Service is not running' : false },
        { name: '📋 Task List', value: 'tasks', disabled: !running ? 'Service is not running' : false },
        { name: '🏠 Historical Projects', value: 'projects', disabled: !running ? 'Service is not running' : false },
        { name: '📋 View Logs (tail -f)', value: 'logs', disabled: !fs.existsSync(logFile) ? 'No log file' : false },
        { name: '📖 View API Documentation', value: 'docs' },
        { name: '📝 Configuration Settings', value: 'visualConfig' },
        { name: '🧪 Test API', value: 'test', disabled: !running ? 'Service is not running' : false },
        { name: '✖ Exit', value: 'exit' },
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
      console.log(chalk.gray('Goodbye!'));
      process.exit(0);
  }

  console.log('');
  await mainMenu();
}

// Command-line argument handling
const args = process.argv.slice(2);

// Handle -v / --version
if (args.includes('-v') || args.includes('--version')) {
  console.log(`nexus-bridge v${version}`);
  process.exit(0);
}

if (args.length === 0) {
  // Interactive menu
  mainMenu().catch(console.error);
} else {
  // Command-line mode
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
      console.log(chalk.red('Unknown command: ') + command);
      console.log(chalk.gray('Available commands: start, stop, status, logs, docs, config, test'));
      console.log(chalk.gray('Options: -v, --version  Show the version'));
      console.log(chalk.gray('Or run without arguments to enter the interactive menu'));
      process.exit(1);
  }
}
