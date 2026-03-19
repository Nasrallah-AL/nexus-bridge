const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');
const createConfigRoutes = require('../../src/routes/config');

describe('Config Routes', () => {
  let app;
  let config;
  let configPath;
  let providerRouter;

  beforeEach(() => {
    config = {
      claudePath: 'claude',
      nodeBinDir: '/Users/test/.nvm/versions/node/v24/bin',
      workspacePath: '/tmp/workspace',
      rateLimit: { enabled: true, windowMs: 60000, maxRequests: 100 },
      webhook: { enabled: false },
      statistics: { enabled: true },
      mcp: { enabled: true, configPath: '~/mcp.json' },
      providers: [
        {
          id: 'main',
          name: 'Main Provider',
          apiKey: 'secret-key',
          baseUrl: 'https://api.example.com',
          env: {
            ANTHROPIC_MODEL: 'provider-model',
            ANTHROPIC_API_KEY: 'should-hide',
          },
        },
      ],
      security: {
        auth: {
          enabled: true,
          secretKey: 'super-secret',
          bypassHealthCheck: true,
        },
        swaggerDocs: {
          enabled: true,
        },
      },
    };

    configPath = path.join(os.tmpdir(), `config-route-${Date.now()}.json`);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    providerRouter = {
      strategy: 'weighted',
      providers: [{ id: 'main' }],
      getStatus: jest.fn(() => ({
        providers: [{
          id: 'main',
          healthy: true,
          consecutiveFailures: 0,
          totalRequests: 12,
          boundSessions: 2,
        }],
      })),
      getSettingsManager: jest.fn(() => ({
        hasSettings: jest.fn(() => true),
      })),
    };

    app = express();
    app.use('/api/config', createConfigRoutes(config, configPath, providerRouter));
  });

  afterEach(() => {
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
  });

  test('GET /api/config returns redacted config and metadata', async () => {
    const res = await request(app).get('/api/config');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.config.security.auth.secretKey).toBe('*** HIDDEN ***');
    expect(res.body.config.providers[0].apiKey).toBe('*** HIDDEN ***');
    expect(res.body.config.providers[0].env.ANTHROPIC_API_KEY).toBe('*** HIDDEN ***');
    expect(res.body.metadata.configPath).toBe(configPath);
    expect(res.body.metadata.effectiveNodeBinDir).toBe('/Users/test/.nvm/versions/node/v24/bin');
  });

  test('GET /api/config/features returns feature summary', async () => {
    const res = await request(app).get('/api/config/features');

    expect(res.status).toBe(200);
    expect(res.body.features.authentication.enabled).toBe(true);
    expect(res.body.features.loadBalance.enabled).toBe(true);
    expect(res.body.features.loadBalance.strategy).toBe('weighted');
    expect(res.body.features.mcp.enabled).toBe(true);
  });

  test('GET /api/config/providers returns redacted provider summaries', async () => {
    const res = await request(app).get('/api/config/providers');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.providers[0]).toMatchObject({
      id: 'main',
      hasApiKey: true,
      hasSettings: true,
      baseUrl: 'https://api.example.com',
    });
    expect(res.body.providers[0].configuredModels).toEqual([
      { name: 'provider-model', capability: 'default_override' },
    ]);
  });
});

