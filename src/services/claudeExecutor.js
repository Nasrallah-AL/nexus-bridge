const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const getLogger = require('../utils/logger');
const { injectProviderEnv, getSafeProviderInfo, getEnvStatus } = require('../utils/providerEnv');

/**
 * Claude 执行器
 */
class ClaudeExecutor {
  constructor(config, sessionStore = null, statsStore = null, messageStore = null) {
    this.config = config;
    this.sessionStore = sessionStore;
    this.statsStore = statsStore;
    this.messageStore = messageStore;
    this.logger = getLogger({ logFile: config.logFile, logLevel: config.logLevel });
  }

  /**
   * 执行 Claude 命令
   */
  async execute(options) {
    const {
      provider = null,
      providerRouter = null,
      prompt,
      projectPath,
      model = this.config.defaultModel,
      sessionId = null,
      systemPrompt = null,
      maxBudgetUsd = this.config.maxBudgetUsd,
      allowedTools = null,
      disallowedTools = null,
      agent = null,
      permissionMode = null,
      stream = false,
    } = options;

    // Setup provider settings symlink in project directory
    if (providerRouter && provider) {
      const settingsManager = providerRouter.getSettingsManager();
      if (settingsManager) {
        settingsManager.setupProjectSymlink(projectPath, provider.id);
      }
    }

    // 检查会话是否存在以及是否已被使用
    let sessionExists = false;
    if (sessionId && this.sessionStore) {
      try {
        const session = await this.sessionStore.get(sessionId);
        // 会话存在且有消息记录，说明应该使用 --resume
        sessionExists = !!(session && session.messages_count > 0);
        this.logger.info(`Session check`, {
          session_id: sessionId,
          exists: !!session,
          messages_count: session?.messages_count || 0,
          will_resume: sessionExists
        });
      } catch (err) {
        // 如果查询失败，假设会话不存在
        sessionExists = false;
        this.logger.debug(`Session check failed, assuming new session`, {
          session_id: sessionId,
          error: err.message
        });
      }
    }

    // 预算控制：检查会话当前花费
    if (sessionId && maxBudgetUsd && this.sessionStore) {
      const session = await this.sessionStore.get(sessionId);
      if (session && session.total_cost_usd >= maxBudgetUsd) {
        this.logger.warn(`Budget exceeded for session`, {
          session_id: sessionId,
          current_cost: session.total_cost_usd,
          max_budget: maxBudgetUsd,
        });
        return {
          success: false,
          error: `Budget exceeded: session has already spent $${session.total_cost_usd.toFixed(2)} of $${maxBudgetUsd.toFixed(2)} limit`,
          budget_exceeded: true,
          current_cost_usd: session.total_cost_usd,
          max_budget_usd: maxBudgetUsd,
        };
      }
    }

    const startTime = Date.now();
    const timings = {}; // 记录各步骤耗时

    // ========== 步骤1：参数验证 ==========
    const step1Start = Date.now();
    this.logger.info(`[Step 1/5] Starting Claude execution`, {
      session_id: sessionId,
      provider_id: provider?.id || 'none',
      provider_name: provider?.name || 'none',
      model: model,
      project_path: projectPath,
      prompt_length: prompt?.length || 0,
      prompt_preview: prompt?.substring(0, 100) || '',
      has_system_prompt: !!systemPrompt,
      max_budget_usd: maxBudgetUsd,
      permission_mode: permissionMode,
      has_allowed_tools: !!allowedTools,
      has_disallowed_tools: !!disallowedTools,
      agent: agent || 'none',
    });
    timings.step1_validation = Date.now() - step1Start;

    try {
      // ========== 步骤2：构建命令参数 ==========
      const step2Start = Date.now();
      const args = this.buildCommandArgs({
        prompt,
        model,
        sessionId,
        sessionExists,
        systemPrompt,
        maxBudgetUsd,
        allowedTools,
        disallowedTools,
        agent,
        mcpConfig: options.mcpConfig,
        permissionMode,
      });
      timings.step2_build_args = Date.now() - step2Start;

      this.logger.info(`[Step 2/5] Command args built`, {
        args_count: args.length,
        args_full: args.join(' '),
        claude_path: this.config.claudePath,
        node_bin_dir: this.config.nodeBinDir || 'not configured',
        build_time_ms: timings.step2_build_args,
      });

      // ========== 步骤3：准备项目目录 ==========
      const step3Start = Date.now();
      const fs = require('fs');
      if (!fs.existsSync(projectPath)) {
        this.logger.info(`[Step 3/5] Creating project directory`, { project_path: projectPath });
        try {
          fs.mkdirSync(projectPath, { recursive: true });
          this.logger.info(`[Step 3/5] Project directory created`, { project_path: projectPath });
        } catch (mkdirErr) {
          this.logger.warn(`[Step 3/5] Failed to create project directory`, {
            project_path: projectPath,
            error: mkdirErr.message
          });
        }
      }
      timings.step3_prepare_dir = Date.now() - step3Start;

      // ========== 步骤4：执行 Claude 命令 ==========
      const step4Start = Date.now();
      this.logger.info(`[Step 4/5] Spawning Claude process`, {
        claude_path: this.config.claudePath,
        cwd: projectPath,
        provider_id: provider?.id || 'none',
        env_injection: provider ? 'yes' : 'no',
      });

      // 使用 spawn 异步执行
      let result;
      try {
        result = await this.spawnCommand(projectPath, args, {
          onSpawn: options.onSpawn,
          provider,
        });
        timings.step4_spawn = Date.now() - step4Start;

        this.logger.info(`[Step 4/5] Claude process completed`, {
          spawn_time_ms: timings.step4_spawn,
          has_result: !!result,
          has_total_cost: !!result?.total_cost_usd,
        });
      } catch (spawnErr) {
        timings.step4_spawn = Date.now() - step4Start;
        // 如果是 "Session ID already in use" 错误，尝试使用 --resume 重试
        if (sessionId && spawnErr.message && spawnErr.message.includes('Session ID') && spawnErr.message.includes('already in use')) {
          this.logger.warn(`[Step 4/5] Session already in use, retrying with --resume`, {
            session_id: sessionId,
            error: spawnErr.message,
            spawn_time_ms: timings.step4_spawn,
          });

          // 移除 --session-id 或 --resume，添加 --resume
          const retryArgs = args.filter(arg => arg !== '--session-id' && arg !== '--resume' && arg !== sessionId);
          retryArgs.push('--resume', sessionId);

          const retryStart = Date.now();
          this.logger.info(`[Step 4/5] Retrying with --resume`, {
            args_preview: retryArgs.join(' ').substring(0, 200) + '...',
          });

          result = await this.spawnCommand(projectPath, retryArgs, { provider });
          timings.step4_retry = Date.now() - retryStart;

          this.logger.info(`[Step 4/5] Retry succeeded`, {
            session_id: sessionId,
            retry_time_ms: timings.step4_retry,
          });
        } else {
          // 其他错误，直接抛出
          this.logger.error(`[Step 4/5] Claude process failed`, {
            error: spawnErr.message,
            spawn_time_ms: timings.step4_spawn,
          });
          throw spawnErr;
        }
      }

      // ========== 步骤5：处理结果 ==========
      const step5Start = Date.now();
      const duration = Date.now() - startTime;
      const costUsd = result.total_cost_usd || 0;

      this.logger.info(`[Step 5/5] Processing execution result`, {
        duration_ms: duration,
        cost_usd: costUsd,
        session_id: result.session_id,
        has_usage: !!result.usage,
        usage: result.usage || null,
      });
      timings.step5_process = Date.now() - step5Start;

      // ========== 执行完成汇总 ==========
      this.logger.info(`========== Execution Summary ==========`, {
        status: 'SUCCESS',
        total_duration_ms: duration,
        step_timings_ms: timings,
        cost_usd: costUsd,
        session_id: result.session_id,
        provider_id: provider?.id || 'none',
        model: model,
        prompt_length: prompt?.length || 0,
      });

      // 预算控制：检查执行后是否超预算
      if (sessionId && maxBudgetUsd && this.sessionStore) {
        const session = await this.sessionStore.get(sessionId);
        const newTotalCost = (session?.total_cost_usd || 0) + costUsd;

        if (newTotalCost > maxBudgetUsd) {
          this.logger.warn(`Budget would be exceeded`, {
            session_id: sessionId,
            new_total: newTotalCost,
            max_budget: maxBudgetUsd,
          });

          return {
            success: false,
            error: `Budget would be exceeded: this request costs $${costUsd.toFixed(2)}, which would bring total to $${newTotalCost.toFixed(2)} exceeding the $${maxBudgetUsd.toFixed(2)} limit`,
            budget_exceeded: true,
            request_cost_usd: costUsd,
            current_cost_usd: session?.total_cost_usd || 0,
            max_budget_usd: maxBudgetUsd,
          };
        }
      }

      // 记录统计
      if (this.statsStore && this.config.statistics?.enabled) {
        await this.statsStore.recordRequest({
          success: true,
          model,
          cost_usd: costUsd,
          input_tokens: result.usage?.input_tokens || 0,
          output_tokens: result.usage?.output_tokens || 0,
        });
      }

      // 更新会话花费
      if (this.sessionStore && sessionId) {
        await this.sessionStore.addCost(sessionId, costUsd);
        await this.sessionStore.incrementMessages(sessionId);
      }

      // 保存 AI 回复到消息存储（用户消息已在路由层保存）
      if (this.messageStore && sessionId) {
        try {
          await this.messageStore.addMessage(sessionId, {
            role: 'assistant',
            content: result.result,
            metadata: {
              cost_usd: costUsd,
              duration_ms: duration,
              model,
              usage: result.usage,
              raw_response: result,
            },
          });
          this.logger.debug(`AI response saved for session`, { session_id: sessionId });
        } catch (msgErr) {
          // 消息存储失败不影响主流程
          this.logger.warn(`Failed to save AI response for session`, {
            session_id: sessionId,
            error: msgErr.message,
          });
        }
      }

      return {
        success: true,
        result: result.result,
        duration_ms: duration,
        cost_usd: costUsd,
        session_id: result.session_id,
        usage: result.usage,
      };
    } catch (err) {
      const duration = Date.now() - startTime;

      // 构建详细的错误日志
      const logData = {
        error: err.message,
        duration_ms: duration,
        session_id: sessionId,
        model: model,
        project_path: projectPath,
        claude_path: this.config.claudePath,
        node_bin_dir: this.config.nodeBinDir || 'not configured',
      };

      // 如果有详细信息，添加到日志
      if (err.details) {
        logData.details = err.details;
      }

      this.logger.error(`Claude command failed`, logData);

      // 记录失败统计
      if (this.statsStore && this.config.statistics?.enabled) {
        await this.statsStore.recordRequest({
          success: false,
          model,
        });
      }

      return {
        success: false,
        error: err.message,
        duration_ms: duration,
        details: err.details || null,  // 包含详细错误信息用于调试
      };
    }
  }

  /**
   * 使用 spawn 执行命令
   */
  spawnCommand(projectPath, args, options = {}) {
    const { onSpawn, provider } = options;

    return new Promise((resolve, reject) => {
      const env = { ...process.env };

      // 如果配置了 nodeBinDir， 添加到 PATH 中
      // 这样可以确保使用正确的 Node.js 版本（适用于 NVM、nvm-windows 等场景）
      if (this.config.nodeBinDir) {
        env.PATH = `${this.config.nodeBinDir}:${env.PATH}`;
      }

      // Provider settings are now handled via symlink in project directory
      // No need to modify HOME environment variable
      this.logger.debug(`Using standard environment`, {
        provider_id: provider?.id || 'none',
      });

      // Unset CLAUDECODE to allow running Claude CLI from within Claude Code
      // Without this, Claude CLI detects nested session and refuses to run
      delete env.CLAUDECODE;

      // Inject Provider environment variables for load balancing
      if (provider) {
        this.logger.info(`Injecting provider env vars`, getSafeProviderInfo(provider));
        injectProviderEnv(env, provider);
        this.logger.info(`Provider env vars injected`, getEnvStatus(env));
      } else {
        this.logger.debug(`No provider selected, using system env vars`);
      }

      // 确保项目目录存在
      const fs = require('fs');
      if (!fs.existsSync(projectPath)) {
        try {
          fs.mkdirSync(projectPath, { recursive: true });
        } catch (mkdirErr) {
          const error = new Error(`Failed to create project directory: ${mkdirErr.message}`);
          error.details = {
            projectPath,
            mkdirError: mkdirErr.message,
          };
          return reject(error);
        }
      }

      const child = spawn(this.config.claudePath, args, {
        cwd: projectPath,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // 通知调用方子进程已创建
      if (onSpawn) {
        onSpawn(child);
      }

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // 超时处理
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Command execution timeout (300s)'));
      }, 300000); // 5分钟超时

      child.on('close', (code) => {
        clearTimeout(timeout);

        const output = stdout || stderr;

        if (code !== 0) {
          const error = new Error(`Command failed with exit code ${code}`);
          error.details = {
            exitCode: code,
            stdout: stdout.substring(0, 1000), // 限制输出长度
            stderr: stderr.substring(0, 1000),
            fullOutput: output.substring(0, 2000),
          };
          return reject(error);
        }

        if (!output || output.trim().length === 0) {
          const error = new Error('Empty output from Claude CLI');
          error.details = {
            stdout: stdout.substring(0, 500),
            stderr: stderr.substring(0, 500),
          };
          return reject(error);
        }

        try {
          const result = JSON.parse(output.trim());
          resolve(result);
        } catch (err) {
          const error = new Error(`Failed to parse JSON output: ${err.message}`);
          error.details = {
            parseError: err.message,
            rawOutput: output.substring(0, 2000),
            stdoutLength: stdout.length,
            stderrLength: stderr.length,
          };
          return reject(error);
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);

        // 根据错误类型提供更友好的错误信息
        let errorMessage = `Failed to start Claude CLI: ${err.message}`;

        if (err.code === 'ENOENT') {
          // 文件不存在错误 - 检查是哪个文件
          const fs = require('fs');

          // 检查 claudePath 是否存在
          if (!fs.existsSync(this.config.claudePath)) {
            errorMessage = `Claude CLI not found at "${this.config.claudePath}".\n\n` +
              `Please check:\n` +
              `1. Claude CLI is installed: npm install -g @anthropic-ai/claude-code\n` +
              `2. Configuration path is correct\n` +
              `3. If using NVM, configure nodeBinDir in config.json\n\n` +
              `Current claudePath: ${this.config.claudePath}\n` +
              `Current nodeBinDir: ${this.config.nodeBinDir || 'not configured'}`;
          } else {
            // claudePath 存在，可能是其他问题
            errorMessage = `Failed to execute command. Please check:\n` +
              `1. Claude CLI is properly installed\n` +
              `2. nodeBinDir is correctly configured (if using NVM)\n` +
              `3. File permissions are correct\n\n` +
              `Error: ${err.message}`;
          }
        }

        const error = new Error(errorMessage);
        error.details = {
          spawnError: err.message,
          spawnCode: err.code,
          claudePath: this.config.claudePath,
          projectPath,
          args: args.join(' '),
          envPATH: env.PATH,
          nodeBinDir: this.config.nodeBinDir,
        };
        return reject(error);
      });
    });
  }

  /**
   * 构建命令参数数组
   */
  buildCommandArgs(options) {
    const {
      prompt,
      model,
      sessionId,
      sessionExists = false,
      systemPrompt,
      maxBudgetUsd,
      allowedTools,
      disallowedTools,
      agent,
      mcpConfig,
      permissionMode,
    } = options;

    const args = ['-p', prompt, '--output-format', 'json'];

    // 添加模型
    if (model) {
      args.push('--model', model);
    }

    // 添加会话 ID 或恢复会话
    if (sessionId) {
      if (sessionExists) {
        // 会话已存在，使用 --resume 恢复会话
        args.push('--resume', sessionId);
        this.logger.info(`Resuming existing session`, { session_id: sessionId });
      } else {
        // 会话不存在，使用 --session-id 创建新会话
        args.push('--session-id', sessionId);
        this.logger.info(`Creating new session`, { session_id: sessionId });
      }
    }

    // 添加系统提示
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    // 添加预算限制
    if (maxBudgetUsd) {
      args.push('--max-budget-usd', maxBudgetUsd.toString());
    }

    // 添加允许的工具
    if (allowedTools && allowedTools.length > 0) {
      args.push('--allowed-tools', allowedTools.join(','));
    }

    // 添加禁止的工具
    if (disallowedTools && disallowedTools.length > 0) {
      args.push('--disallowed-tools', disallowedTools.join(','));
    }

    // 添加 agent
    if (agent) {
      args.push('--agent', agent);
    }

    // 添加 MCP 配置
    const mcpConfigPath = mcpConfig || (this.config.mcp?.enabled ? this.config.mcp.configPath : null);
    if (mcpConfigPath) {
      args.push('--mcp-config', mcpConfigPath);
    }

    // 添加 permission-mode 参数
    if (permissionMode) {
      args.push('--permission-mode', permissionMode);
      this.logger.info(`Using permission mode: ${permissionMode}`);
    }

    // 根据配置决定是否跳过权限检查（默认不跳过）
    if (this.config.allowDangerouslySkipPermissions === true) {
      args.push('--dangerously-skip-permissions');
      this.logger.warn('Dangerously skipping permissions - use with caution');
    }

    return args;
  }

  /**
   * 转义 shell 参数（保留用于可能的 shell 命令）
   */
  escapeArg(arg) {
    return arg.replace(/'/g, "'\"'\"'");
  }
}

module.exports = ClaudeExecutor;
