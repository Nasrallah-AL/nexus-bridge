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

  // ==================== Provider Settings Management ====================

  // GET /api/load-balance/providers/:id/settings
  // Get provider's Claude settings.json content
  router.get('/providers/:id/settings', (req, res) => {
    if (!providerRouter) {
      return res.status(404).json({ success: false, error: 'Load balancing not configured' });
    }

    const settingsManager = providerRouter.getSettingsManager();
    if (!settingsManager) {
      return res.status(501).json({ success: false, error: 'Settings management not available' });
    }

    const settings = settingsManager.loadSettings(req.params.id);
    if (!settings) {
      return res.status(404).json({
        success: false,
        error: 'Provider settings not found',
        hint: 'Create settings using PUT /api/load-balance/providers/:id/settings'
      });
    }

    res.json({ success: true, settings });
  });

  // PUT /api/load-balance/providers/:id/settings
  // Create or update provider's Claude settings.json
  router.put('/providers/:id/settings', (req, res) => {
    if (!providerRouter) {
      return res.status(404).json({ success: false, error: 'Load balancing not configured' });
    }

    const settingsManager = providerRouter.getSettingsManager();
    if (!settingsManager) {
      return res.status(501).json({ success: false, error: 'Settings management not available' });
    }

    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Request body must contain "settings" object'
      });
    }

    try {
      const path = settingsManager.saveSettings(req.params.id, settings);
      res.json({
        success: true,
        message: `Provider ${req.params.id} settings saved`,
        path
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // DELETE /api/load-balance/providers/:id/settings
  // Delete provider's Claude settings.json
  router.delete('/providers/:id/settings', (req, res) => {
    if (!providerRouter) {
      return res.status(404).json({ success: false, error: 'Load balancing not configured' });
    }

    const settingsManager = providerRouter.getSettingsManager();
    if (!settingsManager) {
      return res.status(501).json({ success: false, error: 'Settings management not available' });
    }

    const deleted = settingsManager.deleteSettings(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Provider settings not found' });
    }

    res.json({ success: true, message: `Provider ${req.params.id} settings deleted` });
  });

  // GET /api/load-balance/providers/:id/settings/exists
  // Check if provider has settings configured
  router.get('/providers/:id/settings/exists', (req, res) => {
    if (!providerRouter) {
      return res.status(404).json({ success: false, error: 'Load balancing not configured' });
    }

    const settingsManager = providerRouter.getSettingsManager();
    if (!settingsManager) {
      return res.status(501).json({ success: false, error: 'Settings management not available' });
    }

    const exists = settingsManager.hasSettings(req.params.id);
    res.json({ success: true, exists });
  });

  // GET /api/load-balance/settings/list
  // List all provider settings files
  router.get('/settings/list', (req, res) => {
    if (!providerRouter) {
      return res.status(404).json({ success: false, error: 'Load balancing not configured' });
    }

    const settingsManager = providerRouter.getSettingsManager();
    if (!settingsManager) {
      return res.status(501).json({ success: false, error: 'Settings management not available' });
    }

    const list = settingsManager.listSettings();
    res.json({ success: true, count: list.length, providers: list });
  });

  return router;
}

module.exports = createLoadBalanceRoutes;
