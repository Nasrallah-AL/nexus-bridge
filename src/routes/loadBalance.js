function createLoadBalanceRoutes(providerRouter) {
  const router = require('express').Router();

  // GET /api/load-balance/status
  router.get('/status', (req, res) => {
    if (!providerRouter || providerRouter.providers.length === 0) {
      return res.json({
        success: true,
        strategy: 'none',
        failover: false,
        providers: [],
      });
    }

    const status = providerRouter.getStatus();
    res.json({ success: true, ...status });
  });

  // GET /api/load-balance/bindings
  router.get('/bindings', (req, res) => {
    const bindings = providerRouter ? providerRouter.getBindings() : {};
    res.json({ success: true, bindings });
  });

  // POST /api/load-balance/providers/:id/reset
  router.post('/providers/:id/reset', (req, res) => {
    if (!providerRouter) {
      return res.status(404).json({ success: false, error: 'Load balancing not configured' });
    }

    const result = providerRouter.resetProvider(req.params.id);
    if (!result) {
      return res.status(404).json({ success: false, error: 'Provider not found' });
    }
    res.json({ success: true, message: `Provider ${req.params.id} health reset` });
  });

  // POST /api/load-balance/providers/:id/enable
  router.post('/providers/:id/enable', (req, res) => {
    if (!providerRouter) {
      return res.status(404).json({ success: false, error: 'Load balancing not configured' });
    }

    const result = providerRouter.enableProvider(req.params.id);
    if (!result) {
      return res.status(404).json({ success: false, error: 'Provider not found' });
    }
    res.json({ success: true, message: `Provider ${req.params.id} enabled` });
  });

  // POST /api/load-balance/providers/:id/disable
  router.post('/providers/:id/disable', (req, res) => {
    if (!providerRouter) {
      return res.status(404).json({ success: false, error: 'Load balancing not configured' });
    }

    const result = providerRouter.disableProvider(req.params.id);
    if (!result) {
      return res.status(404).json({ success: false, error: 'Provider not found' });
    }
    res.json({ success: true, message: `Provider ${req.params.id} disabled` });
  });

  return router;
}

module.exports = createLoadBalanceRoutes;
