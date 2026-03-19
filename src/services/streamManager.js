const crypto = require('crypto');
const getLogger = require('../utils/logger');

/**
 * Streaming task manager.
 * Tracks active streaming tasks and supports reconnection and multiple clients.
 */
class StreamManager {
  constructor(config = {}) {
    this.config = config;
    this.logger = getLogger({ logFile: config.logFile, logLevel: config.logLevel });
    this.activeStreams = new Map();
  }

  /**
   * Generate a stream_id.
   */
  generateStreamId() {
    return `stream_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`;
  }

  /**
   * Register a new streaming task.
   * @param {string} sessionId - Session ID
   * @param {ChildProcess} childProcess - Claude CLI child process
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
   * Get a streaming task.
   */
  getStream(streamId) {
    return this.activeStreams.get(streamId);
  }

  /**
   * Get the active streaming task for a session_id.
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
   * Update the accumulated content for a stream.
   */
  updateContent(streamId, chunk) {
    const stream = this.activeStreams.get(streamId);
    if (stream) {
      stream.content += chunk;
    }
  }

  /**
   * Mark a streaming task as completed.
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
   * Add an SSE client.
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
   * Remove an SSE client.
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
   * Broadcast an SSE event to all clients.
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
   * Terminate a streaming task.
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
   * Clean up completed streams to free memory.
   * @param {number} maxAgeMs - Maximum retention time in milliseconds
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
