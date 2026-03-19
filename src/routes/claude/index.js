const createSyncRoutes = require('./sync');
const createAsyncRoutes = require('./async');

/**
 * Claude API routes (synchronous).
 * Keep the original function signature for backward compatibility.
 */
function createClaudeRoutes(claudeExecutor, config, taskQueue, sessionManager, providerRouter) {
  return createSyncRoutes(claudeExecutor, config, sessionManager, providerRouter);
}

/**
 * Async Claude API routes.
 * Keep the original function signature for backward compatibility.
 */
function createAsyncClaudeRoutes(claudeExecutor, config, taskQueue, sessionManager, providerRouter) {
  return createAsyncRoutes(claudeExecutor, config, taskQueue, sessionManager, providerRouter);
}

module.exports = {
  createClaudeRoutes,
  createAsyncClaudeRoutes,
};
