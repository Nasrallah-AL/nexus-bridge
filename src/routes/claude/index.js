const createSyncRoutes = require('./sync');
const createAsyncRoutes = require('./async');

/**
 * Claude API 路由 (同步)
 * 保持原有函数签名，确保向后兼容
 */
function createClaudeRoutes(claudeExecutor, config, taskQueue, sessionManager) {
  return createSyncRoutes(claudeExecutor, config, sessionManager);
}

/**
 * Async Claude API 路由
 * 保持原有函数签名，确保向后兼容
 */
function createAsyncClaudeRoutes(claudeExecutor, config, taskQueue, sessionManager) {
  return createAsyncRoutes(claudeExecutor, config, taskQueue, sessionManager);
}

module.exports = {
  createClaudeRoutes,
  createAsyncClaudeRoutes,
};
