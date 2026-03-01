const router = require('express').Router();
const createMessagesRoute = require('./messages');
const createBatchesRoute = require('./batches');

function createSyncRoutes(claudeExecutor, config, sessionManager) {
  // POST /api/messages
  router.use('/', createMessagesRoute(claudeExecutor, config, sessionManager));
  // POST /api/message/batches
  router.use('/batches', createBatchesRoute(claudeExecutor, config));

  return router;
}

module.exports = createSyncRoutes;
