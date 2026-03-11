const { spawn } = require('child_process');
const getLogger = require('../utils/logger');

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

    // Select provider for load balancing
    let provider = null;
    if (this.providerRouter) {
      provider = this.providerRouter.select(sessionId, providerId);
      this.logger.info(`Selected provider for stream`, {
        session_id: sessionId,
        provider_id: provider?.id || 'none',
        forced: !!providerId,
      });
    }

    const startTime = Date.now();

    // 检查会话是否存在
    let sessionExists = false;
    if (sessionId && this.sessionStore) {
      try {
        const session = await this.sessionStore.get(sessionId);
        sessionExists = !!(session && session.messages_count > 0);
      } catch (err) {
        this.logger.debug(`Session check failed`, { session_id: sessionId, error: err.message });
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
        this.logger.debug(`Created streaming message`, {
          session_id: sessionId,
          stream_id: streamId,
          message_id: streamingMessageId,
        });
      } catch (err) {
        this.logger.warn(`Failed to create streaming message`, {
          session_id: sessionId,
          error: err.message,
        });
        // 流式消息创建失败不影响主流程，继续执行但不支持续传
        streamId = null;
        streamingMessageId = null;
      }
    }

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
    const env = { ...process.env };

    if (this.config.nodeBinDir) {
      env.PATH = `${this.config.nodeBinDir}:${env.PATH}`;
    }

    // Inject Provider environment variables for load balancing
    if (provider) {
      this.logger.info(`Injecting provider env vars`, {
        provider_id: provider.id,
        provider_name: provider.name,
        has_apiKey: !!provider.apiKey,
        apiKey_prefix: provider.apiKey ? provider.apiKey.substring(0, 8) + '...' : null,
        has_baseUrl: !!provider.baseUrl,
        has_custom_env: !!(provider.env && Object.keys(provider.env).length > 0),
      });

      if (provider.apiKey) {
        // Claude CLI uses ANTHROPIC_AUTH_TOKEN, not ANTHROPIC_API_KEY
        // Set both for compatibility with different tools
        env.ANTHROPIC_AUTH_TOKEN = provider.apiKey;
        env.ANTHROPIC_API_KEY = provider.apiKey;
      }
      if (provider.baseUrl) {
        env.ANTHROPIC_BASE_URL = provider.baseUrl;
      }
      // Inject additional custom environment variables from provider.env
      if (provider.env && typeof provider.env === 'object') {
        for (const [key, value] of Object.entries(provider.env)) {
          if (value !== undefined && value !== null) {
            env[key] = String(value);
          }
        }
      }

      this.logger.info(`Provider env vars injected`, {
        ANTHROPIC_AUTH_TOKEN_set: !!env.ANTHROPIC_AUTH_TOKEN,
        ANTHROPIC_API_KEY_set: !!env.ANTHROPIC_API_KEY,
        ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
      });
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

            // 转发所有事件到客户端（如果客户端还连接）
            if (!clientDisconnected) {
              this.sendSSEEvent(res, 'message', json);
            }

            // 如果有 streamManager，广播到所有客户端
            if (streamId && this.streamManager) {
              this.streamManager.broadcast(streamId, 'message', json);
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
      this.logger.warn(`Claude stderr`, {
        session_id: sessionId,
        stderr: data.toString().substring(0, 500),
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
        this.logger.error(`Claude process exited with code ${code}`, { session_id: sessionId });
        this.sendSSEError(res, `Process exited with code ${code}`);
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
