const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const getLogger = require('../utils/logger');
const { injectProviderEnv, getSafeProviderInfo, getEnvStatus } = require('../utils/providerEnv');
const { buildCommandEnv, getEffectiveNodeBinDir } = require('../utils/runtimePaths');

/**
 * Claude executor.
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
   * Execute a Claude command.
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

    // Check whether the session exists and whether it has already been used
    let sessionExists = false;
    if (sessionId && this.sessionStore) {
      try {
        const session = await this.sessionStore.get(sessionId);
        // If the session exists and already has messages, we should use --resume
        sessionExists = !!(session && session.messages_count > 0);
        this.logger.info(`Session check`, {
          session_id: sessionId,
          exists: !!session,
          messages_count: session?.messages_count || 0,
          will_resume: sessionExists
        });
      } catch (err) {
        // If the lookup fails, assume the session does not exist
        sessionExists = false;
        this.logger.debug(`Session check failed, assuming new session`, {
          session_id: sessionId,
          error: err.message
        });
      }
    }

    // Budget control: check the session's current spend
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
    const timings = {}; // Record the duration of each step.

    // ========== Step 1: parameter validation ==========
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
      // ========== Step 2: build command arguments ==========
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
        node_bin_dir: getEffectiveNodeBinDir(this.config) || 'not configured',
        build_time_ms: timings.step2_build_args,
      });

      // ========== Step 3: prepare the project directory ==========
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

      // ========== Step 4: execute the Claude command ==========
      const step4Start = Date.now();
      this.logger.info(`[Step 4/5] Spawning Claude process`, {
        claude_path: this.config.claudePath,
        cwd: projectPath,
        provider_id: provider?.id || 'none',
        env_injection: provider ? 'yes' : 'no',
      });

      // Execute asynchronously with spawn
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
        // If the error is "Session ID already in use", retry with --resume
        if (sessionId && spawnErr.message && spawnErr.message.includes('Session ID') && spawnErr.message.includes('already in use')) {
          this.logger.warn(`[Step 4/5] Session already in use, retrying with --resume`, {
            session_id: sessionId,
            error: spawnErr.message,
            spawn_time_ms: timings.step4_spawn,
          });

          // Remove --session-id or --resume and add --resume
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
          // For all other errors, rethrow immediately
          this.logger.error(`[Step 4/5] Claude process failed`, {
            error: spawnErr.message,
            spawn_time_ms: timings.step4_spawn,
          });
          throw spawnErr;
        }
      }

      // ========== Step 5: process the result ==========
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

      // ========== Execution summary ==========
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

      // Budget control: check whether execution would exceed the budget
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

      // Record statistics
      if (this.statsStore && this.config.statistics?.enabled) {
        await this.statsStore.recordRequest({
          success: true,
          model,
          cost_usd: costUsd,
          input_tokens: result.usage?.input_tokens || 0,
          output_tokens: result.usage?.output_tokens || 0,
        });
      }

      // Update session cost
      if (this.sessionStore && sessionId) {
        await this.sessionStore.addCost(sessionId, costUsd);
        await this.sessionStore.incrementMessages(sessionId);
      }

      // Save the AI reply to message storage (the user message was already saved in the route layer)
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
          // Message storage failures should not interrupt the main flow
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

      // Build a detailed error log
      const logData = {
        error: err.message,
        duration_ms: duration,
        session_id: sessionId,
        model: model,
        project_path: projectPath,
        claude_path: this.config.claudePath,
        node_bin_dir: getEffectiveNodeBinDir(this.config) || 'not configured',
      };

      // Add detailed information to the log when available
      if (err.details) {
        logData.details = err.details;
      }

      this.logger.error(`Claude command failed`, logData);

      // Record failure statistics
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
        details: err.details || null,  // Include detailed error information for debugging.
      };
    }
  }

  /**
   * Execute a command with spawn.
   */
  spawnCommand(projectPath, args, options = {}) {
    const { onSpawn, provider } = options;

    return new Promise((resolve, reject) => {
      const effectiveNodeBinDir = getEffectiveNodeBinDir(this.config);
      const env = buildCommandEnv(this.config, process.env);

      // Provider settings are now handled via symlink in project directory
      // No need to modify HOME environment variable
      this.logger.debug(`Using standard environment`, {
        provider_id: provider?.id || 'none',
        node_bin_dir: effectiveNodeBinDir || 'not configured',
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

      // Ensure the project directory exists.
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

      const claudePath = this.config.claudePath || 'claude';
      const child = spawn(claudePath, args, {
        cwd: projectPath,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Notify the caller that the child process has been created.
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

      // Timeout handling.
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Command execution timeout (300s)'));
      }, 300000); // 5-minute timeout.

      child.on('close', (code) => {
        clearTimeout(timeout);

        const output = stdout || stderr;

        if (code !== 0) {
          const error = new Error(`Command failed with exit code ${code}`);
          error.details = {
            exitCode: code,
            stdout: stdout.substring(0, 1000), // Limit output length.
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

        // Provide a more helpful error message based on the error type
        let errorMessage = `Failed to start Claude CLI: ${err.message}`;

        if (err.code === 'ENOENT') {
          // File-not-found error: determine which file is missing
          const fs = require('fs');

          // Check whether claudePath exists
          if (!fs.existsSync(this.config.claudePath)) {
            errorMessage = `Claude CLI not found at "${this.config.claudePath}".\n\n` +
              `Please check:\n` +
              `1. Claude CLI is installed: npm install -g @anthropic-ai/claude-code\n` +
              `2. Configuration path is correct\n` +
              `3. If using NVM, configure nodeBinDir (or legacy nvmBin) in config.json\n\n` +
              `Current claudePath: ${this.config.claudePath}\n` +
              `Current nodeBinDir: ${effectiveNodeBinDir || 'not configured'}`;
          } else {
            // claudePath exists, so the issue may be elsewhere
            errorMessage = `Failed to execute command. Please check:\n` +
              `1. Claude CLI is properly installed\n` +
              `2. nodeBinDir/nvmBin is correctly configured (if using NVM)\n` +
              `3. File permissions are correct\n\n` +
              `Error: ${err.message}`;
          }
        }

        const error = new Error(errorMessage);
        error.details = {
          spawnError: err.message,
          spawnCode: err.code,
          claudePath: claudePath,
          projectPath,
          args: args.join(' '),
          envPATH: env.PATH,
          nodeBinDir: effectiveNodeBinDir,
          nvmBin: this.config.nvmBin || null,
        };
        return reject(error);
      });
    });
  }

  /**
   * Build the command argument array.
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

    // Add the model
    if (model) {
      args.push('--model', model);
    }

    // Add the session ID or resume the session
    if (sessionId) {
      if (sessionExists) {
        // The session already exists, so resume it with --resume
        args.push('--resume', sessionId);
        this.logger.info(`Resuming existing session`, { session_id: sessionId });
      } else {
        // The session does not exist, so create a new one with --session-id
        args.push('--session-id', sessionId);
        this.logger.info(`Creating new session`, { session_id: sessionId });
      }
    }

    // Add the system prompt
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    // Add the budget limit
    if (maxBudgetUsd) {
      args.push('--max-budget-usd', maxBudgetUsd.toString());
    }

    // Add allowed tools
    if (allowedTools && allowedTools.length > 0) {
      args.push('--allowed-tools', allowedTools.join(','));
    }

    // Add disallowed tools
    if (disallowedTools && disallowedTools.length > 0) {
      args.push('--disallowed-tools', disallowedTools.join(','));
    }

    // Add the agent
    if (agent) {
      args.push('--agent', agent);
    }

    // Add MCP configuration
    const mcpConfigPath = mcpConfig || (this.config.mcp?.enabled ? this.config.mcp.configPath : null);
    if (mcpConfigPath) {
      args.push('--mcp-config', mcpConfigPath);
    }

    // Add the permission-mode argument
    if (permissionMode) {
      args.push('--permission-mode', permissionMode);
      this.logger.info(`Using permission mode: ${permissionMode}`);
    }

    // Decide whether to skip permission checks based on configuration (disabled by default)
    if (this.config.allowDangerouslySkipPermissions === true) {
      args.push('--dangerously-skip-permissions');
      this.logger.warn('Dangerously skipping permissions - use with caution');
    }

    return args;
  }

  /**
   * Escape shell arguments (kept for potential shell commands).
   */
  escapeArg(arg) {
    return arg.replace(/'/g, "'\"'\"'");
  }
}

module.exports = ClaudeExecutor;
