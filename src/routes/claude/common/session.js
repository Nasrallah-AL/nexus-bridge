/**
 * 确保 Session 存在，不存在则自动创建
 * @param {object} sessionManager - Session 管理器
 * @param {string} sessionId - 已有的 session ID
 * @param {string} projectPath - 项目路径
 * @param {string} model - 模型名称
 * @param {object} config - 配置对象
 * @returns {Promise<string>} Session ID
 */
async function ensureSession(sessionManager, sessionId, projectPath, model, config) {
  // 如果已有 session_id，直接返回
  if (sessionId) {
    return sessionId;
  }

  // 没有 sessionManager，返回 null
  if (!sessionManager) {
    return null;
  }

  try {
    // 自动创建会话
    const session = await sessionManager.createSession({
      project_path: projectPath,
      model: model || config.defaultModel,
      metadata: {
        auto_created: true,
      },
    });
    return session.id;
  } catch (error) {
    // 如果创建会话失败，记录错误但继续执行
    console.error('Failed to auto-create session:', error.message);
    return null;
  }
}

module.exports = {
  ensureSession,
};
