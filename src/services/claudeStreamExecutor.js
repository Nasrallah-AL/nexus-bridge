const { spawn } = require('child_process');
const os = require('os');
const getLogger = require('../utils/logger');
const { injectProviderEnv, getSafeProviderInfo, getEnvStatus } = require('../utils/providerEnv');

/**
 * Claude 流式执行器
 * 使用 --output-format stream-json 输出 SSE 事件流
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
   * 设置 SSE 响应头
   */
  setupSSEResponse(res, sessionId, streamId = null) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Session-Id', sessionId);
    if (streamId) {
      res.setHeader('X-Stream-Id', streamId);
    }
    res.flushHeaders(); // 立即发送headers
  }

  /**
   * 发送 SSE 事件
   */
  sendSSEEvent(res, eventType, data) {
    const eventData = typeof data === 'string' ? data : JSON.stringify(data);
    res.write(`event: ${eventType}\n`);
    res.write(`data: ${eventData}\n\n`);
  }

  /**
   * 发送错误事件并关闭连接
   */
  sendSSEError(res, message, details = null) {
    this.sendSSEEvent(res, 'error', {
      error: message,
      details: details,
    });
    res.end();
  }

  /**
   * 发送完成事件并关闭连接
   */
  sendSSEDone(res, data) {
    this.sendSSEEvent(res, 'done', data);
    res.end();
  }

  /**
   * 构建流式命令参数
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

    // 关键：使用 stream-json 格式
    const args = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose'
    ];

    // 添加模型
    if (model) {
      args.push('--model', model);
    }

    // 会话处理：流式必须使用已存在的会话
    if (sessionId) {
      if (sessionExists) {
        args.push('--resume', sessionId);
      } else {
        args.push('--session-id', sessionId);
      }
    }

    // 系统提示
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    // 预算限制
    if (maxBudgetUsd) {
      args.push('--max-budget-usd', maxBudgetUsd.toString());
    }

    // 工具限制
    if (allowedTools && allowedTools.length > 0) {
      args.push('--allowed-tools', allowedTools.join(','));
    }

    if (disallowedTools && disallowedTools.length > 0) {
      args.push('--disallowed-tools', disallowedTools.join(','));
    }

    // MCP 配置
    if (this.config.mcp?.enabled && this.config.mcp?.configPath) {
      args.push('--mcp-config', this.config.mcp.configPath);
    }

    // 添加 permission-mode 参数
    if (permissionMode) {
      args.push('--permission-mode', permissionMode);
      this.logger.info(`Using permission mode: ${permissionMode}`);
    }

    // 权限跳过
    if (this.config.allowDangerouslySkipPermissions === true) {
      args.push('--dangerously-skip-permissions');
    }

    return args;
  }

  /**
   * 执行流式命令
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
    const timings = {}; // 记录各步骤耗时

    // ========== 步骤1：参数验证和Provider选择 ==========
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

    // ========== 步骤2：检查会话状态和预算 ==========
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

    // ========== 步骤3：设置Provider配置（symlink方式） ==========
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

    // 生成 streamId 和创建流式消息（如果 streamManager 可用）
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
        // 流式消息创建失败不影响主流程，继续执行但不支持续传
        streamId = null;
        streamingMessageId = null;
      }
    }
    timings.step3_setup = Date.now() - step3Start;

    // 设置 SSE 响应头
    this.setupSSEResponse(res, sessionId, streamId);

    // 预算检查
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

    // 确保项目目录存在
    const fs = require('fs');
    if (!fs.existsSync(projectPath)) {
      try {
        fs.mkdirSync(projectPath, { recursive: true });
      } catch (mkdirErr) {
        this.sendSSEError(res, `Failed to create project directory: ${mkdirErr.message}`);
        return;
      }
    }

    // 先保存用户消息（在执行前，记录正确的发送时间）
    if (this.messageStore && sessionId) {
      try {
        await this.messageStore.addMessage(sessionId, {
          role: 'user',
          content: prompt,
          metadata: {},
        });
        this.logger.debug(`User message saved for stream session`, { session_id: sessionId });
      } catch (msgErr) {
        // 消息存储失败不影响主流程
        this.logger.warn(`Failed to save user message for stream session`, {
          session_id: sessionId,
          error: msgErr.message,
        });
      }
    }

    // 构建命令参数
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

    // 执行流式命令
    this.spawnStreamCommand(projectPath, args, res, Date.now(), sessionId, model, streamId, streamingMessageId, provider);
  }

  /**
   * 生成流式命令并处理输出
   */
  spawnStreamCommand(projectPath, args, res, startTime, sessionId, model, streamId = null, streamingMessageId = null, provider = null) {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    const env = { ...process.env };

    if (this.config.nodeBinDir) {
      env.PATH = `${this.config.nodeBinDir}:${env.PATH}`;
    }

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
    });

    // Inject Provider environment variables for load balancing
    if (provider) {
      this.logger.info(`Injecting provider env vars for stream`, getSafeProviderInfo(provider));
      injectProviderEnv(env, provider);
      this.logger.info(`Provider env vars injected for stream`, getEnvStatus(env));
    } else {
      this.logger.warn(`No provider selected for stream, using system env vars`);
    }

    const child = spawn(this.config.claudePath, args, {
      cwd: projectPath,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = '';
    let totalCost = 0;
    let lastResult = null;
    // 收集 assistant 消息内容（包括 thinking）
    let assistantContent = [];
    let thinkingContent = '';
    // 从 message_start 事件中获取实际使用的模型
    let actualModel = model;
    // 跟踪原始客户端是否已断开
    let clientDisconnected = false;
    // Flag to prevent double cleanup of session directory
    let sessionHomeCleaned = false;
    // 收集 stderr 输出用于错误诊断
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

    // 如果有 streamManager，注册流并添加客户端
    if (streamId && this.streamManager) {
      this.streamManager.registerStream(sessionId, child, streamId);
      this.streamManager.addClient(streamId, res);
    }

    // 处理客户端断开连接
    res.on('close', () => {
      clientDisconnected = true;

      // 如果有 streamManager，只移除客户端，不终止进程
      if (streamId && this.streamManager) {
        this.logger.info(`Client disconnected, removing from stream (process continues)`, {
          session_id: sessionId,
          stream_id: streamId,
        });
        this.streamManager.removeClient(streamId, res);
      } else {
        // 旧行为：终止进程
        this.logger.info(`Client disconnected, killing Claude process`, { session_id: sessionId });
        child.kill('SIGTERM');
      }
    });

    // 处理 stdout - JSONL 格式
    child.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // 保留未完成的行

      for (const line of lines) {
        if (line.trim()) {
          try {
            const json = JSON.parse(line);

            // 如果有 streamManager，广播到所有客户端（包括初始客户端）
            if (streamId && this.streamManager) {
              this.streamManager.broadcast(streamId, 'message', json);
            } else if (!clientDisconnected) {
              // 没有 streamManager 时，直接发送给初始客户端
              this.sendSSEEvent(res, 'message', json);
            }

            // 从 message_start 事件中提取实际使用的模型
            if (json.type === 'stream_event' && json.event?.type === 'message_start' && json.event?.message?.model) {
              actualModel = json.event.message.model;
              this.logger.debug(`Actual model from message_start`, { model: actualModel });
            }

            // 收集 assistant 消息（包括 thinking）
            if (json.type === 'assistant' && json.message?.content) {
              for (const block of json.message.content) {
                if (block.type === 'thinking' && block.thinking) {
                  thinkingContent += block.thinking;
                } else if (block.type === 'text' && block.text) {
                  assistantContent.push({ type: 'text', text: block.text });

                  // 更新流式消息内容
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

            // 如果是结果事件，记录成本和最终回复
            if (json.type === 'result') {
              lastResult = json;
              totalCost = json.total_cost_usd || 0;
              // 最终结果中的 result 字段是完整回复
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

    // 处理 stderr
    child.stderr.on('data', (data) => {
      const stderrText = data.toString();
      stderrOutput += stderrText;
      this.logger.warn(`Claude stderr`, {
        session_id: sessionId,
        stderr: stderrText.substring(0, 500),
      });
    });

    // 超时处理
    const timeout = setTimeout(() => {
      this.logger.warn(`Stream timeout, killing process`, { session_id: sessionId });
      child.kill('SIGTERM');
      this.sendSSEError(res, 'Stream timeout (300s)');
    }, 300000);

    // 进程结束处理
    child.on('close', async (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;

      // Cleanup temporary HOME directory (safe - uses flag)
      cleanupSessionHome();

      // 完成流式任务（如果有 streamManager）
      if (streamId && this.streamManager) {
        this.streamManager.completeStream(streamId, {
          cost_usd: totalCost,
          duration_ms: duration,
          success: code === 0,
        });
      }

      // 完成流式消息（如果有 streamingMessageId）
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

      // 存储助手消息到 messageStore（用户消息已在执行前保存）
      await this.saveMessages(sessionId, thinkingContent, assistantContent, lastResult, actualModel);

      // 更新会话统计
      await this.updateSessionStats(sessionId, totalCost, duration);

      // 发送完成事件
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

    // 进程错误处理
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
   * 更新会话统计
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
   * 保存助手消息到 messageStore
   * 注意：用户消息已在执行前保存，这里只保存助手回复
   * @param {string} sessionId - 会话 ID
   * @param {string} thinkingContent - 思考内容
   * @param {Array} assistantContent - 助手回复内容
   * @param {object} lastResult - 最终结果对象
   * @param {string} model - 使用的模型
   */
  async saveMessages(sessionId, thinkingContent, assistantContent, lastResult, model) {
    if (!this.messageStore || !sessionId) return;

    try {
      // 构建助手消息内容
      let assistantText = '';
      const metadata = {
        model: model || this.config.defaultModel,
      };

      // 如果有最终结果，优先使用
      if (lastResult?.result) {
        assistantText = lastResult.result;
        metadata.cost_usd = lastResult.total_cost_usd;
        metadata.duration_ms = lastResult.duration_ms;
        metadata.model_usage = lastResult.modelUsage;
      } else if (assistantContent.length > 0) {
        // 否则拼接收集到的内容
        assistantText = assistantContent.map(c => c.text).join('\n');
      }

      // 添加思考内容到元数据
      if (thinkingContent) {
        metadata.thinking = thinkingContent;
      }

      // 只保存助手消息（用户消息已在执行前保存）
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
