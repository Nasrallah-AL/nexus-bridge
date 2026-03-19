const { spawn } = require('child_process');
const os = require('os');
const getLogger = require('../utils/logger');
const { injectProviderEnv, getSafeProviderInfo, getEnvStatus } = require('../utils/providerEnv');
const { buildCommandEnv, getEffectiveNodeBinDir } = require('../utils/runtimePaths');

/**
 * Claude streaming executor.
 * Uses `--output-format stream-json` to emit an SSE event stream.
 */
class ClaudeStreamExecutor {
  constructor(config, sessionStore = null, statsStore = null, messageStore = null, streamManager = null, providerRouter = null) {
    this.config = config;
    this.sessionStore = sessionStore;
    this.statsStore = statsStore;
    this.messageStore = messageStore;
    this.streamManager = streamManager;
    this.providerRouter = providerRouter;
    this.logger = getLogger({ logFile: config.logFile, logLevel: config.logLevel });
  }

  /**
   * Set SSE response headers.
   */
  setupSSEResponse(res, sessionId, streamId = null) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Session-Id', sessionId);
    if (streamId) {
      res.setHeader('X-Stream-Id', streamId);
    }
    res.flushHeaders(); // Send headers immediately.
  }

  /**
   * Send an SSE event.
   */
  sendSSEEvent(res, eventType, data) {
    const eventData = typeof data === 'string' ? data : JSON.stringify(data);
    res.write(`event: ${eventType}\n`);
    res.write(`data: ${eventData}\n\n`);
  }

  /**
   * Send an error event and close the connection.
   */
  sendSSEError(res, message, details = null) {
    this.sendSSEEvent(res, 'error', {
      error: message,
      details: details,
    });
    res.end();
  }

  /**
   * Send a completion event and close the connection.
   */
  sendSSEDone(res, data) {
    this.sendSSEEvent(res, 'done', data);
    res.end();
  }

  /**
   * Build command arguments for streaming execution.
   */
  buildStreamCommandArgs(options) {
    const {
      prompt,
      model = this.config.defaultModel,
      sessionId,
      sessionExists = false,
      systemPrompt,
      maxBudgetUsd,
      allowedTools,
      disallowedTools,
      permissionMode,
    } = options;

    // Key requirement: use the stream-json format
    const args = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose'
    ];

    // Add the model
    if (model) {
      args.push('--model', model);
    }

    // Session handling: streaming must use an existing session
    if (sessionId) {
      if (sessionExists) {
        args.push('--resume', sessionId);
      } else {
        args.push('--session-id', sessionId);
      }
    }

    // System prompt
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    // Budget limit
    if (maxBudgetUsd) {
      args.push('--max-budget-usd', maxBudgetUsd.toString());
    }

    // Tool restrictions
    if (allowedTools && allowedTools.length > 0) {
      args.push('--allowed-tools', allowedTools.join(','));
    }

    if (disallowedTools && disallowedTools.length > 0) {
      args.push('--disallowed-tools', disallowedTools.join(','));
    }

    // MCP configuration
    if (this.config.mcp?.enabled && this.config.mcp?.configPath) {
      args.push('--mcp-config', this.config.mcp.configPath);
    }

    // Add the permission-mode argument
    if (permissionMode) {
      args.push('--permission-mode', permissionMode);
      this.logger.info(`Using permission mode: ${permissionMode}`);
    }

    // Permission bypass
    if (this.config.allowDangerouslySkipPermissions === true) {
      args.push('--dangerously-skip-permissions');
    }

    return args;
  }

  /**
   * Execute a streaming command.
   */
  async executeStream(options, res) {
    const {
      prompt,
      projectPath,
      model = this.config.defaultModel,
      sessionId,
      systemPrompt = null,
      maxBudgetUsd = this.config.maxBudgetUsd,
      allowedTools = null,
      disallowedTools = null,
      permissionMode = null,
      providerId = null,  // Optional: force specific provider
    } = options;

    const startTime = Date.now();
    const timings = {}; // Record the duration of each step.

    // ========== Step 1: validate parameters and select a provider ==========
    const step1Start = Date.now();
    this.logger.info(`[Step 1/5] Starting stream execution`, {
      session_id: sessionId,
      model: model,
      project_path: projectPath,
      prompt_length: prompt?.length || 0,
      prompt_preview: prompt?.substring(0, 100) || '',
      has_system_prompt: !!systemPrompt,
      max_budget_usd: maxBudgetUsd,
      permission_mode: permissionMode,
      provider_id_forced: providerId || 'none',
    });

    // Select provider for load balancing
    let provider = null;
    if (this.providerRouter) {
      provider = this.providerRouter.select(sessionId, providerId);
      this.logger.info(`[Step 1/5] Provider selected`, {
        session_id: sessionId,
        provider_id: provider?.id || 'none',
        provider_name: provider?.name || 'none',
        forced: !!providerId,
      });
    }
    timings.step1_provider_select = Date.now() - step1Start;

    // ========== Step 2: check session state and budget ==========
    const step2Start = Date.now();
    let sessionExists = false;
    if (sessionId && this.sessionStore) {
      try {
        const session = await this.sessionStore.get(sessionId);
        sessionExists = !!(session && session.messages_count > 0);
        this.logger.info(`[Step 2/5] Session check completed`, {
          session_id: sessionId,
          exists: !!session,
          messages_count: session?.messages_count || 0,
          will_resume: sessionExists,
          current_cost_usd: session?.total_cost_usd || 0,
        });
      } catch (err) {
        this.logger.debug(`[Step 2/5] Session check failed`, { session_id: sessionId, error: err.message });
      }
    }
    timings.step2_session_check = Date.now() - step2Start;

    // ========== Step 3: configure the provider (symlink approach) ==========
    const step3Start = Date.now();

    // Setup provider settings symlink in project directory
    if (this.providerRouter && provider) {
      const settingsManager = this.providerRouter.getSettingsManager();
      if (settingsManager) {
        const symlinkResult = settingsManager.setupProjectSymlink(projectPath, provider.id);
        this.logger.info(`[Step 3/5] Provider settings symlink setup`, {
          provider_id: provider.id,
          project_path: projectPath,
          symlink_created: symlinkResult,
        });
      }
    }

    // Generate streamId and create the streaming message when streamManager is available
    let streamId = null;
    let streamingMessageId = null;
    if (this.streamManager && this.messageStore && sessionId) {
      try {
        streamId = this.streamManager.generateStreamId();
        const streamingMessage = await this.messageStore.addStreamingMessage(sessionId, {
          stream_id: streamId,
          model,
        });
        streamingMessageId = streamingMessage.id;
        this.logger.debug(`[Step 3/5] Created streaming message`, {
          session_id: sessionId,
          stream_id: streamId,
          message_id: streamingMessageId,
        });
      } catch (err) {
        this.logger.warn(`[Step 3/5] Failed to create streaming message`, {
          session_id: sessionId,
          error: err.message,
        });
        // A streaming message creation failure should not block the main flow; continue without resume support
        streamId = null;
        streamingMessageId = null;
      }
    }
    timings.step3_setup = Date.now() - step3Start;

    // Set SSE response headers
    this.setupSSEResponse(res, sessionId, streamId);

    // Budget check
    if (sessionId && maxBudgetUsd && this.sessionStore) {
      const session = await this.sessionStore.get(sessionId);
      if (session && session.total_cost_usd >= maxBudgetUsd) {
        this.sendSSEError(res, `Budget exceeded: session has already spent $${session.total_cost_usd.toFixed(2)}`, {
          current_cost_usd: session.total_cost_usd,
          max_budget_usd: maxBudgetUsd,
        });
        return;
      }
    }

    // Ensure the project directory exists
    const fs = require('fs');
    if (!fs.existsSync(projectPath)) {
      try {
        fs.mkdirSync(projectPath, { recursive: true });
      } catch (mkdirErr) {
        this.sendSSEError(res, `Failed to create project directory: ${mkdirErr.message}`);
        return;
      }
    }

    // Save the user message before execution so the send time is accurate
    if (this.messageStore && sessionId) {
      try {
        await this.messageStore.addMessage(sessionId, {
          role: 'user',
          content: prompt,
          metadata: {},
        });
        this.logger.debug(`User message saved for stream session`, { session_id: sessionId });
      } catch (msgErr) {
        // Message storage failures should not interrupt the main flow
        this.logger.warn(`Failed to save user message for stream session`, {
          session_id: sessionId,
          error: msgErr.message,
        });
      }
    }

    // Build command arguments
    const args = this.buildStreamCommandArgs({
      prompt,
      model,
      sessionId,
      sessionExists,
      systemPrompt,
      maxBudgetUsd,
      allowedTools,
      disallowedTools,
      permissionMode,
    });

    this.logger.info(`Starting stream execution`, {
      session_id: sessionId,
      project_path: projectPath,
      model,
      stream_id: streamId,
    });

    // Execute the streaming command
    this.spawnStreamCommand(projectPath, args, res, Date.now(), sessionId, model, streamId, streamingMessageId, provider);
  }

  /**
   * Spawn the streaming command and process its output.
   */
  spawnStreamCommand(projectPath, args, res, startTime, sessionId, model, streamId = null, streamingMessageId = null, provider = null) {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    const env = buildCommandEnv(this.config, process.env);
    const effectiveNodeBinDir = getEffectiveNodeBinDir(this.config);

    // Create session-specific HOME directory to isolate from local ~/.claude/settings.json
    // This ensures provider environment variables take precedence
    // Use session_id for persistent conversation data
    // Use project data directory for session storage
    const dataDir = this.config.dataDir || path.join(process.cwd(), 'data');
    const homeBase = path.join(dataDir, 'sessions');
    // Ensure base directory exists
    if (!fs.existsSync(homeBase)) {
      fs.mkdirSync(homeBase, { recursive: true });
    }
    // Use session_id for persistent session data
    const homeName = sessionId ? `session-${sessionId}` : fs.mkdtempSync(path.join(homeBase, 'temp-'));
    const sessionHome = path.join(homeBase, homeName);
    if (!fs.existsSync(sessionHome)) {
      fs.mkdirSync(sessionHome, { recursive: true });
    }
    env.HOME = sessionHome;

    // Create symlinks to global Claude config files for skills, plugins, etc.
    // Link everything in ~/.claude/ except settings.json and settings.local.json
    const realHome = os.homedir();
    const globalClaudeDir = path.join(realHome, '.claude');
    const sessionClaudeDir = path.join(sessionHome, '.claude');

    // Files/directories to exclude from symlink (these may contain provider-specific settings)
    const excludeFromSymlink = ['settings.json', 'settings.local.json'];

    if (fs.existsSync(globalClaudeDir)) {
      // Ensure session .claude directory exists
      if (!fs.existsSync(sessionClaudeDir)) {
        fs.mkdirSync(sessionClaudeDir, { recursive: true });
      }

      // Symlink all contents from global ~/.claude/ except excluded files
      const claudeDirContents = fs.readdirSync(globalClaudeDir);
      for (const item of claudeDirContents) {
        if (excludeFromSymlink.includes(item)) {
          continue; // Skip settings files
        }

        const globalItemPath = path.join(globalClaudeDir, item);
        const sessionItemPath = path.join(sessionClaudeDir, item);

        // Only create symlink if target doesn't exist
        if (!fs.existsSync(sessionItemPath)) {
          try {
            const stat = fs.lstatSync(globalItemPath);
            const linkType = stat.isDirectory() ? 'junction' : 'file';
            fs.symlinkSync(globalItemPath, sessionItemPath, linkType);
            this.logger.debug(`Created symlink for ~/.claude/${item}`, { sessionItemPath, globalItemPath });
          } catch (linkErr) {
            this.logger.warn(`Failed to create symlink for ~/.claude/${item}`, { error: linkErr.message });
          }
        }
      }
    }

    // Symlink ~/.claude.json (for accessing global settings)
    const globalClaudeJson = path.join(realHome, '.claude.json');
    const sessionClaudeJsonLink = path.join(sessionHome, '.claude.json');
    if (fs.existsSync(globalClaudeJson) && !fs.existsSync(sessionClaudeJsonLink)) {
      try {
        fs.symlinkSync(globalClaudeJson, sessionClaudeJsonLink, 'file');
        this.logger.debug(`Created symlink for .claude.json`, { sessionClaudeJsonLink, globalClaudeJson });
      } catch (linkErr) {
        this.logger.warn(`Failed to create .claude.json symlink`, { error: linkErr.message });
      }
    }

    // Unset CLAUDECODE to allow running Claude CLI from within Claude Code
    // Without this, Claude CLI detects nested session and refuses to run
    delete env.CLAUDECODE;

    this.logger.info(`Using session HOME directory for stream`, {
      sessionHome,
      CLAUDECODE_unset: true,
      session_id: sessionId,
      stream_id: streamId,
      node_bin_dir: effectiveNodeBinDir || 'not configured',
    });

    // Inject Provider environment variables for load balancing
    if (provider) {
      this.logger.info(`Injecting provider env vars for stream`, getSafeProviderInfo(provider));
      injectProviderEnv(env, provider);
      this.logger.info(`Provider env vars injected for stream`, getEnvStatus(env));
    } else {
      this.logger.warn(`No provider selected for stream, using system env vars`);
    }

    const child = spawn(this.config.claudePath || 'claude', args, {
      cwd: projectPath,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = '';
    let totalCost = 0;
    let lastResult = null;
    // Collect assistant message content, including thinking blocks
    let assistantContent = [];
    let thinkingContent = '';
    // Read the actual model from the message_start event
    let actualModel = model;
    // Track whether the original client has disconnected
    let clientDisconnected = false;
    // Flag to prevent double cleanup of session directory
    let sessionHomeCleaned = false;
    // Collect stderr output for diagnostics
    let stderrOutput = '';

    // Helper to cleanup session directory safely
    // Only cleanup if it's a temporary directory (no sessionId)
    const cleanupSessionHome = () => {
      if (sessionHomeCleaned) return;
      sessionHomeCleaned = true;

      // Don't cleanup session directories - they need to persist for --resume
      if (sessionId) {
        this.logger.debug(`Keeping session HOME directory for future resume`, {
          sessionHome,
          session_id: sessionId,
        });
        return;
      }

      // Only cleanup temporary directories
      try {
        fs.rmSync(sessionHome, { recursive: true, force: true });
        this.logger.debug(`Cleaned up temporary HOME directory for stream`, {
          sessionHome,
        });
      } catch (cleanupErr) {
        this.logger.warn(`Failed to cleanup temporary HOME directory for stream`, {
          sessionHome,
          error: cleanupErr.message,
        });
      }
    };

    // Register the stream and add the client when streamManager is available
    if (streamId && this.streamManager) {
      this.streamManager.registerStream(sessionId, child, streamId);
      this.streamManager.addClient(streamId, res);
    }

    // Handle client disconnects
    res.on('close', () => {
      clientDisconnected = true;

      // When streamManager is available, only remove the client and keep the process running
      if (streamId && this.streamManager) {
        this.logger.info(`Client disconnected, removing from stream (process continues)`, {
          session_id: sessionId,
          stream_id: streamId,
        });
        this.streamManager.removeClient(streamId, res);
      } else {
        // Legacy behavior: terminate the process
        this.logger.info(`Client disconnected, killing Claude process`, { session_id: sessionId });
        child.kill('SIGTERM');
      }
    });

    // Process stdout in JSONL format.
    child.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep any incomplete line in the buffer.

      for (const line of lines) {
        if (line.trim()) {
          try {
            const json = JSON.parse(line);

            // Broadcast to all clients when streamManager is available, including the initial client
            if (streamId && this.streamManager) {
              this.streamManager.broadcast(streamId, 'message', json);
            } else if (!clientDisconnected) {
              // Without streamManager, send directly to the initial client
              this.sendSSEEvent(res, 'message', json);
            }

            // Extract the actual model used from the message_start event
            if (json.type === 'stream_event' && json.event?.type === 'message_start' && json.event?.message?.model) {
              actualModel = json.event.message.model;
              this.logger.debug(`Actual model from message_start`, { model: actualModel });
            }

            // Collect assistant messages, including thinking content
            if (json.type === 'assistant' && json.message?.content) {
              for (const block of json.message.content) {
                if (block.type === 'thinking' && block.thinking) {
                  thinkingContent += block.thinking;
                } else if (block.type === 'text' && block.text) {
                  assistantContent.push({ type: 'text', text: block.text });

                  // Update the streaming message content
                  if (streamingMessageId && this.messageStore && sessionId) {
                    this.messageStore.updateStreamingContent(sessionId, streamingMessageId, block.text).catch(err => {
                      this.logger.warn(`Failed to update streaming content`, {
                        session_id: sessionId,
                        message_id: streamingMessageId,
                        error: err.message,
                      });
                    });
                  }
                }
              }
            }

            // If this is a result event, record the cost and final reply
            if (json.type === 'result') {
              lastResult = json;
              totalCost = json.total_cost_usd || 0;
              // The result field in the final event contains the full reply
              if (json.result) {
                assistantContent = [{ type: 'result', text: json.result }];
              }
            }
          } catch (parseErr) {
            this.logger.warn(`Failed to parse JSON line`, {
              line: line.substring(0, 200),
              error: parseErr.message,
            });
          }
        }
      }
    });

    // Process stderr
    child.stderr.on('data', (data) => {
      const stderrText = data.toString();
      stderrOutput += stderrText;
      this.logger.warn(`Claude stderr`, {
        session_id: sessionId,
        stderr: stderrText.substring(0, 500),
      });
    });

    // Timeout handling
    const timeout = setTimeout(() => {
      this.logger.warn(`Stream timeout, killing process`, { session_id: sessionId });
      child.kill('SIGTERM');
      this.sendSSEError(res, 'Stream timeout (300s)');
    }, 300000);

    // Process exit handling
    child.on('close', async (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;

      // Cleanup temporary HOME directory (safe - uses flag)
      cleanupSessionHome();

      // Complete the streaming task when streamManager is available
      if (streamId && this.streamManager) {
        this.streamManager.completeStream(streamId, {
          cost_usd: totalCost,
          duration_ms: duration,
          success: code === 0,
        });
      }

      // Complete the streaming message when streamingMessageId is available
      if (streamingMessageId && this.messageStore && sessionId) {
        try {
          await this.messageStore.completeStreamingMessage(sessionId, streamingMessageId, {
            cost_usd: totalCost,
            duration_ms: duration,
          });
        } catch (err) {
          this.logger.warn(`Failed to complete streaming message`, {
            session_id: sessionId,
            message_id: streamingMessageId,
            error: err.message,
          });
        }
      }

      if (code !== 0) {
        this.logger.error(`Claude process exited with code ${code}`, {
          session_id: sessionId,
          stderr: stderrOutput.substring(0, 2000),
          args: args.join(' ').substring(0, 500),
          claude_path: this.config.claudePath,
          project_path: projectPath,
        });
        this.sendSSEError(res, `Process exited with code ${code}`, {
          stderr: stderrOutput.substring(0, 1000) || null,
          args: args.join(' ').substring(0, 300),
        });
        return;
      }

      // Store the assistant message in messageStore (the user message was already saved before execution)
      await this.saveMessages(sessionId, thinkingContent, assistantContent, lastResult, actualModel);

      // Update session statistics
      await this.updateSessionStats(sessionId, totalCost, duration);

      // Send the completion event
      this.sendSSEDone(res, {
        session_id: sessionId,
        duration_ms: duration,
        cost_usd: totalCost,
      });

      this.logger.info(`Stream completed`, {
        session_id: sessionId,
        duration_ms: duration,
        cost_usd: totalCost,
      });
    });

    // Process error handling
    child.on('error', (err) => {
      clearTimeout(timeout);

      // Cleanup temporary HOME directory on error (safe - uses flag)
      cleanupSessionHome();

      this.logger.error(`Failed to start Claude process`, {
        session_id: sessionId,
        error: err.message,
      });
      this.sendSSEError(res, `Failed to start Claude: ${err.message}`);
    });
  }

  /**
   * Update session statistics.
   */
  async updateSessionStats(sessionId, costUsd, durationMs) {
    if (!this.sessionStore || !sessionId) return;

    try {
      await this.sessionStore.addCost(sessionId, costUsd);
      await this.sessionStore.incrementMessages(sessionId);

      if (this.statsStore && this.config.statistics?.enabled) {
        await this.statsStore.recordRequest({
          success: true,
          cost_usd: costUsd,
        });
      }
    } catch (err) {
      this.logger.warn(`Failed to update session stats`, {
        session_id: sessionId,
        error: err.message,
      });
    }
  }

  /**
   * Save the assistant message to messageStore.
   * Note: the user message is already saved before execution; this stores only the assistant reply.
   * @param {string} sessionId - Session ID
   * @param {string} thinkingContent - Thinking content
   * @param {Array} assistantContent - Assistant reply content
   * @param {object} lastResult - Final result object
   * @param {string} model - Model used
   */
  async saveMessages(sessionId, thinkingContent, assistantContent, lastResult, model) {
    if (!this.messageStore || !sessionId) return;

    try {
      // Build the assistant message content
      let assistantText = '';
      const metadata = {
        model: model || this.config.defaultModel,
      };

      // Prefer the final result when it is available
      if (lastResult?.result) {
        assistantText = lastResult.result;
        metadata.cost_usd = lastResult.total_cost_usd;
        metadata.duration_ms = lastResult.duration_ms;
        metadata.model_usage = lastResult.modelUsage;
      } else if (assistantContent.length > 0) {
        // Otherwise, concatenate the collected content
        assistantText = assistantContent.map(c => c.text).join('\n');
      }

      // Add thinking content to metadata
      if (thinkingContent) {
        metadata.thinking = thinkingContent;
      }

      // Save only the assistant message (the user message was already saved before execution)
      await this.messageStore.addMessage(sessionId, {
        role: 'assistant',
        content: assistantText,
        metadata,
      });

      this.logger.debug(`Assistant message saved for session`, {
        session_id: sessionId,
        has_thinking: !!thinkingContent,
        response_length: assistantText.length,
      });
    } catch (err) {
      this.logger.warn(`Failed to save assistant message`, {
        session_id: sessionId,
        error: err.message,
      });
    }
  }
}

module.exports = ClaudeStreamExecutor;
