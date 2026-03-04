const { spawn } = require('child_process');
const getLogger = require('../utils/logger');

/**
 * Claude 流式执行器
 * 使用 --output-format stream-json 输出 SSE 事件流
 */
class ClaudeStreamExecutor {
  constructor(config, sessionStore = null, statsStore = null) {
    this.config = config;
    this.sessionStore = sessionStore;
    this.statsStore = statsStore;
    this.logger = getLogger({ logFile: config.logFile, logLevel: config.logLevel });
  }

  /**
   * 设置 SSE 响应头
   */
  setupSSEResponse(res, sessionId) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Session-Id', sessionId);
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
    } = options;

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

    // 设置 SSE 响应头
    this.setupSSEResponse(res, sessionId);

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
    });

    this.logger.info(`Starting stream execution`, {
      session_id: sessionId,
      project_path: projectPath,
      model,
    });

    // 执行流式命令
    this.spawnStreamCommand(projectPath, args, res, startTime, sessionId);
  }

  /**
   * 生成流式命令并处理输出
   */
  spawnStreamCommand(projectPath, args, res, startTime, sessionId) {
    const env = { ...process.env };

    if (this.config.nodeBinDir) {
      env.PATH = `${this.config.nodeBinDir}:${env.PATH}`;
    }

    const child = spawn(this.config.claudePath, args, {
      cwd: projectPath,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = '';
    let totalCost = 0;
    let lastResult = null;

    // 处理客户端断开连接
    res.on('close', () => {
      this.logger.info(`Client disconnected, killing Claude process`, { session_id: sessionId });
      child.kill('SIGTERM');
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

            // 转发所有事件到客户端
            this.sendSSEEvent(res, 'message', json);

            // 如果是结果事件，记录成本
            if (json.type === 'result') {
              lastResult = json;
              totalCost = json.total_cost_usd || 0;
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
    child.on('close', (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;

      if (code !== 0) {
        this.logger.error(`Claude process exited with code ${code}`, { session_id: sessionId });
        this.sendSSEError(res, `Process exited with code ${code}`);
        return;
      }

      // 更新会话统计
      this.updateSessionStats(sessionId, totalCost, duration);

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
}

module.exports = ClaudeStreamExecutor;
