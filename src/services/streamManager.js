const crypto = require('crypto');
const getLogger = require('../utils/logger');

/**
 * 流式任务管理器
 * 管理活跃的流式任务，支持断线重连和多客户端监听
 */
class StreamManager {
  constructor(config = {}) {
    this.config = config;
    this.logger = getLogger({ logFile: config.logFile, logLevel: config.logLevel });
    this.activeStreams = new Map();
  }

  /**
   * 生成 stream_id
   */
  generateStreamId() {
    return `stream_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`;
  }

  /**
   * 注册新的流式任务
   * @param {string} sessionId - Session ID
   * @param {ChildProcess} childProcess - Claude CLI 子进程
   * @param {string} streamId - Optional stream ID (generated if not provided)
   * @returns {string} stream_id
   */
  registerStream(sessionId, childProcess, streamId = null) {
    const finalStreamId = streamId || this.generateStreamId();

    this.activeStreams.set(finalStreamId, {
      stream_id: finalStreamId,
      session_id: sessionId,
      childProcess,
      clients: [],
      content: '',
      status: 'streaming',
      started_at: Date.now(),
      metadata: {},
    });

    this.logger.info('Stream registered', { stream_id: finalStreamId, session_id: sessionId });

    return finalStreamId;
  }

  /**
   * 获取流式任务
   */
  getStream(streamId) {
    return this.activeStreams.get(streamId);
  }

  /**
   * 通过 session_id 获取活跃的流式任务
   */
  getStreamBySession(sessionId) {
    for (const [, stream] of this.activeStreams) {
      if (stream.session_id === sessionId && stream.status === 'streaming') {
        return stream;
      }
    }
    return null;
  }

  /**
   * 更新流式任务内容
   */
  updateContent(streamId, chunk) {
    const stream = this.activeStreams.get(streamId);
    if (stream) {
      stream.content += chunk;
    }
  }

  /**
   * 标记流式任务完成
   */
  completeStream(streamId, metadata = {}) {
    const stream = this.activeStreams.get(streamId);
    if (stream) {
      stream.status = 'completed';
      stream.completed_at = Date.now();
      stream.metadata = { ...stream.metadata, ...metadata };

      this.logger.info('Stream completed', {
        stream_id: streamId,
        duration_ms: stream.completed_at - stream.started_at,
      });
    }
  }

  /**
   * 添加 SSE 客户端
   */
  addClient(streamId, res) {
    const stream = this.activeStreams.get(streamId);
    if (stream) {
      stream.clients.push(res);
      this.logger.debug('Client added to stream', {
        stream_id: streamId,
        client_count: stream.clients.length,
      });
    }
  }

  /**
   * 移除 SSE 客户端
   */
  removeClient(streamId, res) {
    const stream = this.activeStreams.get(streamId);
    if (stream) {
      const index = stream.clients.indexOf(res);
      if (index > -1) {
        stream.clients.splice(index, 1);
        this.logger.debug('Client removed from stream', {
          stream_id: streamId,
          client_count: stream.clients.length,
        });
      }
    }
  }

  /**
   * 广播 SSE 事件到所有客户端
   */
  broadcast(streamId, eventType, data) {
    const stream = this.activeStreams.get(streamId);
    if (!stream) return;

    const eventData = typeof data === 'string' ? data : JSON.stringify(data);
    const message = `event: ${eventType}\ndata: ${eventData}\n\n`;

    for (const client of stream.clients) {
      try {
        client.write(message);
      } catch (err) {
        this.logger.warn('Failed to write to client', { error: err.message });
      }
    }
  }

  /**
   * 终止流式任务
   */
  killStream(streamId) {
    const stream = this.activeStreams.get(streamId);
    if (stream) {
      if (stream.childProcess && !stream.childProcess.killed) {
        stream.childProcess.kill('SIGTERM');
      }
      this.activeStreams.delete(streamId);
      this.logger.info('Stream killed', { stream_id: streamId });
    }
  }

  /**
   * 清理已完成的流式任务（释放内存）
   * @param {number} maxAgeMs - 最大保留时间（毫秒）
   */
  cleanupCompletedStreams(maxAgeMs = 3600000) {
    const now = Date.now();
    for (const [streamId, stream] of this.activeStreams) {
      if (stream.status === 'completed' && (now - stream.completed_at > maxAgeMs)) {
        this.activeStreams.delete(streamId);
        this.logger.debug('Cleaned up completed stream', { stream_id: streamId });
      }
    }
  }
}

module.exports = StreamManager;
