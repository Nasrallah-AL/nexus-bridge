const router = require('express').Router();
const createAsyncMessagesRoute = require('./messages');

function createAsyncRoutes(claudeExecutor, config, taskQueue, sessionManager, providerRouter) {
  // POST /api/async/messages
  router.use('/', createAsyncMessagesRoute(claudeExecutor, config, taskQueue, sessionManager, providerRouter));

  return router;
}

module.exports = createAsyncRoutes;
