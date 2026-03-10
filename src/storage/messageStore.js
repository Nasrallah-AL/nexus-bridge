const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * 消息存储类
 * 每个 session 一个独立文件: messages/{session_id}.json
 */
class MessageStore {
  constructor(dataDir = './data/messages') {
    this.dataDir = dataDir;
  }

  /**
   * 初始化存储目录
   */
  async init() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  /**
   * 获取 session 消息文件路径
   */
  getFilePath(sessionId) {
    return path.join(this.dataDir, `${sessionId}.json`);
  }

  /**
   * 生成消息 ID
   */
  generateId() {
    return `msg_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`;
  }

  /**
   * 获取当前时间戳
   */
  now() {
    return new Date().toISOString();
  }

  /**
   * 读取 session 的消息文件
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
   * 写入 session 的消息文件
   */
  async writeSessionMessages(sessionId, data) {
    const filePath = this.getFilePath(sessionId);

    // 确保目录存在
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  /**
   * 添加消息
   * @param {string} sessionId - Session ID
   * @param {object} message - 消息对象
   * @param {string} message.role - user 或 assistant
   * @param {string} message.content - 消息内容
   * @param {object} message.metadata - 元数据
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
   * 批量添加消息（用户消息 + AI 回复）
   * @param {string} sessionId - Session ID
   * @param {object} userMessage - 用户消息
   * @param {object} assistantMessage - AI 回复消息
   */
  async addExchange(sessionId, userMessage, assistantMessage) {
    const data = await this.readSessionMessages(sessionId);
    const now = this.now();

    // 添加用户消息
    const userMsg = {
      id: this.generateId(),
      session_id: sessionId,
      role: 'user',
      content: userMessage.content,
      created_at: now,
      metadata: userMessage.metadata || {},
    };
    data.messages.push(userMsg);

    // 添加 AI 回复
    const assistantMsg = {
      id: this.generateId(),
      session_id: sessionId,
      role: 'assistant',
      content: assistantMessage.content,
      created_at: this.now(), // 稍晚一点的时间戳
      metadata: assistantMessage.metadata || {},
    };
    data.messages.push(assistantMsg);

    data.count = data.messages.length;
    data.updated_at = this.now();

    await this.writeSessionMessages(sessionId, data);

    return { userMessage: userMsg, assistantMessage: assistantMsg };
  }

  /**
   * 获取消息列表（支持游标分页）
   * @param {string} sessionId - Session ID
   * @param {object} options - 分页选项
   * @param {number} options.limit - 每页数量
   * @param {string} options.before_id - 查询此消息 ID 之前的消息
   * @param {string} options.after_id - 查询此消息 ID 之后的消息
   * @param {string} options.order - 排序方式 asc/desc
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

    // 查找消息索引
    const findIndexById = (id) => messages.findIndex(m => m.id === id);

    // 游标过滤
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

    // 排序
    if (order === 'asc') {
      messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    } else {
      messages.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    // 分页
    const actualLimit = Math.min(limit, 100);
    const hasMore = messages.length > actualLimit;
    messages = messages.slice(0, actualLimit);

    // 如果是倒序，返回结果也需要按时间倒序
    // 但如果用户请求的是 asc，保持正序
    if (order === 'desc') {
      // 已经是倒序了
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
   * 删除 session 的所有消息
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

    return true; // 文件不存在也算成功
  }

  /**
   * 批量删除多个 session 的消息
   * @param {string[]} sessionIds - Session ID 数组
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
   * 检查 session 是否有消息
   */
  async hasMessages(sessionId) {
    const data = await this.readSessionMessages(sessionId);
    return data.count > 0;
  }

  /**
   * 获取消息数量
   */
  async getMessageCount(sessionId) {
    const data = await this.readSessionMessages(sessionId);
    return data.count;
  }

  /**
   * 生成流式消息 ID
   */
  generateStreamId() {
    return `stream_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`;
  }

  /**
   * 创建流式消息
   * @param {string} sessionId - Session ID
   * @param {object} options - 选项
   * @param {string} [options.stream_id] - 流式消息 ID（可选，自动生成）
   * @param {string} [options.model] - 模型名称
   * @returns {Promise<object>} 创建的消息对象
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
   * 更新流式消息内容（追加内容）
   * @param {string} sessionId - Session ID
   * @param {string} messageId - 消息 ID
   * @param {string} chunk - 要追加的内容
   * @returns {Promise<boolean>} true if updated, false if message not found
   * @throws {Error} 如果消息不是流式消息
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

    // 追加内容
    data.messages[messageIndex].content = (message.content || '') + chunk;
    data.updated_at = this.now();

    await this.writeSessionMessages(sessionId, data);

    return true;
  }

  /**
   * 完成流式消息
   * @param {string} sessionId - Session ID
   * @param {string} messageId - 消息 ID
   * @param {object} metadata - 完成时的元数据
   * @param {number} [metadata.cost_usd] - 费用
   * @param {number} [metadata.duration_ms] - 持续时间
   * @returns {Promise<object|null>} completed message or null if not found
   * @throws {Error} 如果消息不是 streaming 状态
   */
  async completeStreamingMessage(sessionId, messageId, metadata = {}) {
    const data = await this.readSessionMessages(sessionId);
    const messageIndex = data.messages.findIndex(m => m.id === messageId);

    if (messageIndex === -1) {
      return null;
    }

    const now = this.now();
    const message = data.messages[messageIndex];

    // 验证消息状态必须是 streaming
    if (message.status !== 'streaming') {
      throw new Error(`Cannot complete message with status '${message.status}'. Only 'streaming' messages can be completed.`);
    }

    // 更新状态和元数据
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
   * 根据 stream_id 查找消息
   * @param {string} sessionId - Session ID
   * @param {string} streamId - 流式消息 ID
   * @returns {Promise<object|null>} message or null if not found
   */
  async getStreamingMessage(sessionId, streamId) {
    const data = await this.readSessionMessages(sessionId);
    const message = data.messages.find(m => m.metadata && m.metadata.stream_id === streamId);
    return message || null;
  }
}

module.exports = MessageStore;
