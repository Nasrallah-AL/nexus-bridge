const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Message storage class.
 * Each session uses a dedicated file: messages/{session_id}.json
 */
class MessageStore {
  constructor(dataDir = './data/messages') {
    this.dataDir = dataDir;
  }

  /**
   * Initialize the storage directory.
   */
  async init() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  /**
   * Get the path for a session message file.
   */
  getFilePath(sessionId) {
    return path.join(this.dataDir, `${sessionId}.json`);
  }

  /**
   * Generate a message ID.
   */
  generateId() {
    return `msg_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`;
  }

  /**
   * Get the current timestamp.
   */
  now() {
    return new Date().toISOString();
  }

  /**
   * Read the message file for a session.
   */
  async readSessionMessages(sessionId) {
    const filePath = this.getFilePath(sessionId);

    if (!fs.existsSync(filePath)) {
      return {
        session_id: sessionId,
        messages: [],
        count: 0,
        updated_at: null,
      };
    }

    try {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      console.error(`Failed to read messages file for session ${sessionId}:`, err.message);
      return {
        session_id: sessionId,
        messages: [],
        count: 0,
        updated_at: null,
      };
    }
  }

  /**
   * Write the message file for a session.
   */
  async writeSessionMessages(sessionId, data) {
    const filePath = this.getFilePath(sessionId);

    // Ensure the directory exists.
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  /**
   * Add a message.
   * @param {string} sessionId - Session ID
   * @param {object} message - Message object
   * @param {string} message.role - user or assistant
   * @param {string} message.content - Message content
   * @param {object} message.metadata - Metadata
   */
  async addMessage(sessionId, message) {
    const data = await this.readSessionMessages(sessionId);

    const newMessage = {
      id: this.generateId(),
      session_id: sessionId,
      role: message.role,
      content: message.content,
      created_at: this.now(),
      metadata: message.metadata || {},
    };

    data.messages.push(newMessage);
    data.count = data.messages.length;
    data.updated_at = this.now();

    await this.writeSessionMessages(sessionId, data);

    return newMessage;
  }

  /**
   * Add a user/assistant message pair in one operation.
   * @param {string} sessionId - Session ID
   * @param {object} userMessage - User message
   * @param {object} assistantMessage - Assistant reply message
   */
  async addExchange(sessionId, userMessage, assistantMessage) {
    const data = await this.readSessionMessages(sessionId);
    const now = this.now();

    // Add the user message.
    const userMsg = {
      id: this.generateId(),
      session_id: sessionId,
      role: 'user',
      content: userMessage.content,
      created_at: now,
      metadata: userMessage.metadata || {},
    };
    data.messages.push(userMsg);

    // Add the assistant reply.
    const assistantMsg = {
      id: this.generateId(),
      session_id: sessionId,
      role: 'assistant',
      content: assistantMessage.content,
      created_at: this.now(), // Slightly later timestamp.
      metadata: assistantMessage.metadata || {},
    };
    data.messages.push(assistantMsg);

    data.count = data.messages.length;
    data.updated_at = this.now();

    await this.writeSessionMessages(sessionId, data);

    return { userMessage: userMsg, assistantMessage: assistantMsg };
  }

  /**
   * Get a paginated message list using cursors.
   * @param {string} sessionId - Session ID
   * @param {object} options - Pagination options
   * @param {number} options.limit - Items per page
   * @param {string} options.before_id - Messages before this message ID
   * @param {string} options.after_id - Messages after this message ID
   * @param {string} options.order - Sort order: asc/desc
   */
  async getMessages(sessionId, options = {}) {
    const {
      limit = 20,
      before_id,
      after_id,
      order = 'desc',
    } = options;

    const data = await this.readSessionMessages(sessionId);
    let messages = data.messages;

    // Find the message index.
    const findIndexById = (id) => messages.findIndex(m => m.id === id);

    // Apply cursor filters.
    if (before_id) {
      const index = findIndexById(before_id);
      if (index > 0) {
        messages = messages.slice(0, index);
      } else if (index === 0) {
        messages = [];
      }
    }

    if (after_id) {
      const index = findIndexById(after_id);
      if (index !== -1 && index < messages.length - 1) {
        messages = messages.slice(index + 1);
      } else {
        messages = [];
      }
    }

    // Sort the results.
    if (order === 'asc') {
      messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    } else {
      messages.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    // Apply pagination.
    const actualLimit = Math.min(limit, 100);
    const hasMore = messages.length > actualLimit;
    messages = messages.slice(0, actualLimit);

    // When order is desc, the response should stay in descending time order.
    // If the user requested asc, keep ascending order.
    if (order === 'desc') {
      // Already in descending order.
    }

    return {
      session_id: sessionId,
      messages,
      pagination: {
        has_more: hasMore,
        first_id: messages.length > 0 ? messages[0].id : null,
        last_id: messages.length > 0 ? messages[messages.length - 1].id : null,
      },
      count: messages.length,
    };
  }

  /**
   * Delete all messages for a session.
   */
  async deleteMessages(sessionId) {
    const filePath = this.getFilePath(sessionId);

    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        return true;
      } catch (err) {
        console.error(`Failed to delete messages file for session ${sessionId}:`, err.message);
        return false;
      }
    }

    return true; // Treat a missing file as success.
  }

  /**
   * Delete messages for multiple sessions in a batch.
   * @param {string[]} sessionIds - Array of session IDs
   */
  async deleteMessagesBatch(sessionIds) {
    const results = {
      success: 0,
      failed: 0,
    };

    for (const sessionId of sessionIds) {
      const deleted = await this.deleteMessages(sessionId);
      if (deleted) {
        results.success++;
      } else {
        results.failed++;
      }
    }

    return results;
  }

  /**
   * Check whether a session has messages.
   */
  async hasMessages(sessionId) {
    const data = await this.readSessionMessages(sessionId);
    return data.count > 0;
  }

  /**
   * Get the message count.
   */
  async getMessageCount(sessionId) {
    const data = await this.readSessionMessages(sessionId);
    return data.count;
  }

  /**
   * Generate a streaming message ID.
   */
  generateStreamId() {
    return `stream_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`;
  }

  /**
   * Create a streaming message.
   * @param {string} sessionId - Session ID
   * @param {object} options - Options
   * @param {string} [options.stream_id] - Streaming message ID (optional, auto-generated)
   * @param {string} [options.model] - Model name
   * @returns {Promise<object>} The created message object
   */
  async addStreamingMessage(sessionId, options = {}) {
    const data = await this.readSessionMessages(sessionId);
    const now = this.now();

    const streamId = options.stream_id || this.generateStreamId();

    const newMessage = {
      id: this.generateId(),
      session_id: sessionId,
      role: 'assistant',
      content: '',
      status: 'streaming',
      created_at: now,
      metadata: {
        stream_id: streamId,
        model: options.model || null,
        started_at: now,
        completed_at: null,
        cost_usd: null,
        duration_ms: null,
        ...(options.custom_field ? { custom_field: options.custom_field } : {}),
      },
    };

    data.messages.push(newMessage);
    data.count = data.messages.length;
    data.updated_at = now;

    await this.writeSessionMessages(sessionId, data);

    return newMessage;
  }

  /**
   * Update streaming message content by appending text.
   * @param {string} sessionId - Session ID
   * @param {string} messageId - Message ID
   * @param {string} chunk - Content to append
   * @returns {Promise<boolean>} true if updated, false if message not found
   * @throws {Error} If the message is not a streaming message
   */
  async updateStreamingContent(sessionId, messageId, chunk) {
    const data = await this.readSessionMessages(sessionId);
    const messageIndex = data.messages.findIndex(m => m.id === messageId);

    if (messageIndex === -1) {
      return false;
    }

    const message = data.messages[messageIndex];

    if (message.status !== 'streaming') {
      throw new Error(`Message ${messageId} is not a streaming message`);
    }

    // Append content
    data.messages[messageIndex].content = (message.content || '') + chunk;
    data.updated_at = this.now();

    await this.writeSessionMessages(sessionId, data);

    return true;
  }

  /**
   * Complete a streaming message.
   * @param {string} sessionId - Session ID
   * @param {string} messageId - Message ID
   * @param {object} metadata - Completion metadata
   * @param {number} [metadata.cost_usd] - Cost
   * @param {number} [metadata.duration_ms] - Duration
   * @returns {Promise<object|null>} Completed message or null if not found
   * @throws {Error} If the message is not in the streaming state
   */
  async completeStreamingMessage(sessionId, messageId, metadata = {}) {
    const data = await this.readSessionMessages(sessionId);
    const messageIndex = data.messages.findIndex(m => m.id === messageId);

    if (messageIndex === -1) {
      return null;
    }

    const now = this.now();
    const message = data.messages[messageIndex];

    // Validate that the message status is streaming
    if (message.status !== 'streaming') {
      throw new Error(`Cannot complete message with status '${message.status}'. Only 'streaming' messages can be completed.`);
    }

    // Update status and metadata
    data.messages[messageIndex] = {
      ...message,
      status: 'completed',
      metadata: {
        ...message.metadata,
        completed_at: now,
        cost_usd: metadata.cost_usd ?? null,
        duration_ms: metadata.duration_ms ?? null,
      },
    };

    data.updated_at = now;

    await this.writeSessionMessages(sessionId, data);

    return data.messages[messageIndex];
  }

  /**
   * Find a message by stream_id.
   * @param {string} sessionId - Session ID
   * @param {string} streamId - Streaming message ID
   * @returns {Promise<object|null>} message or null if not found
   */
  async getStreamingMessage(sessionId, streamId) {
    const data = await this.readSessionMessages(sessionId);
    const message = data.messages.find(m => m.metadata && m.metadata.stream_id === streamId);
    return message || null;
  }
}

module.exports = MessageStore;
