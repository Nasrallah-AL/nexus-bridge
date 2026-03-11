const express = require('express');
const request = require('supertest');
const ProviderRouter = require('../../src/services/providerRouter');
const createLoadBalanceRoutes = require('../../src/routes/loadBalance');

describe('Load Balance Routes', () => {
  let app;
  let providerRouter;

  const config = {
    providers: [
      { id: 'p1', name: 'Provider 1', apiKey: 'k1', weight: 2, enabled: true },
      { id: 'p2', name: 'Provider 2', apiKey: 'k2', weight: 1, enabled: true },
    ],
    loadBalance: { strategy: 'weighted', failover: true, failureThreshold: 3, recoveryTimeout: 60 },
  };

  beforeEach(() => {
    providerRouter = new ProviderRouter(config);
    app = express();
    app.use(express.json());
    app.use('/api/load-balance', createLoadBalanceRoutes(providerRouter));
  });

  test('GET /status returns provider status', async () => {
    const res = await request(app).get('/api/load-balance/status');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.strategy).toBe('weighted');
    expect(res.body.providers).toHaveLength(2);
  });

  test('GET /bindings returns empty initially', async () => {
    const res = await request(app).get('/api/load-balance/bindings');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Object.keys(res.body.bindings)).toHaveLength(0);
  });

  test('GET /bindings returns bindings after select', async () => {
    providerRouter.select('test-session');
    const res = await request(app).get('/api/load-balance/bindings');
    expect(Object.keys(res.body.bindings)).toHaveLength(1);
  });

  test('POST /providers/:id/reset resets health', async () => {
    providerRouter.recordFailure('p1');
    providerRouter.recordFailure('p1');
    providerRouter.recordFailure('p1');

    const res = await request(app).post('/api/load-balance/providers/p1/reset');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const status = await request(app).get('/api/load-balance/status');
    expect(status.body.providers.find(p => p.id === 'p1').healthy).toBe(true);
  });

  test('POST /providers/:id/reset returns 404 for unknown provider', async () => {
    const res = await request(app).post('/api/load-balance/providers/unknown/reset');
    expect(res.status).toBe(404);
  });

  test('returns strategy none when no providers', async () => {
    const emptyRouter = new ProviderRouter({});
    const emptyApp = express();
    emptyApp.use(express.json());
    emptyApp.use('/api/load-balance', createLoadBalanceRoutes(emptyRouter));

    const res = await request(emptyApp).get('/api/load-balance/status');
    expect(res.status).toBe(200);
    expect(res.body.strategy).toBe('none');
  });
});
