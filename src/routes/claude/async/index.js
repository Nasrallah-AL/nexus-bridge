const router = require('express').Router();
const createAsyncMessagesRoute = require('./messages');

function createAsyncRoutes(claudeExecutor, config, taskQueue, sessionManager) {
  // POST /api/async/messages
  router.use('/', createAsyncMessagesRoute(claudeExecutor, config, taskQueue, sessionManager));

  return router;
}

module.exports = createAsyncRoutes;
