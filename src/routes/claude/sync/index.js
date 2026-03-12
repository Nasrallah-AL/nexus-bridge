const router = require('express').Router();
const createMessagesRoute = require('./messages');
const createBatchesRoute = require('./batches');

function createSyncRoutes(claudeExecutor, config, sessionManager, providerRouter) {
  // POST /api/messages
  router.use('/', createMessagesRoute(claudeExecutor, config, sessionManager, providerRouter));
  // POST /api/message/batches
  router.use('/batches', createBatchesRoute(claudeExecutor, config));

  return router;
}

module.exports = createSyncRoutes;
