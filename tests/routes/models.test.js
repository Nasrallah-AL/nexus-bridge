const express = require('express');
const request = require('supertest');
const createModelRoutes = require('../../src/routes/models');

describe('Model Routes', () => {
  let app;
  let statsCollector;

  beforeEach(() => {
    statsCollector = {
      getTopModels: jest.fn().mockResolvedValue([
        { name: 'claude-sonnet-4-5', count: 5, cost_usd: 1.23 },
        { name: 'glm-5', count: 2, cost_usd: 0.4 },
      ]),
    };

    const config = {
      defaultModel: 'claude-sonnet-4-5',
      providers: [
        {
          id: 'zhipu',
          name: 'Zhipu',
          env: {
            ANTHROPIC_MODEL: 'glm-5',
            ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-5-haiku',
          },
        },
      ],
    };

    app = express();
    app.use('/api/models', createModelRoutes(config, statsCollector));
  });

  test('GET /api/models returns configured and observed models', async () => {
    const res = await request(app).get('/api/models');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.default_model).toBe('claude-sonnet-4-5');
    expect(res.body.configured_models).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'claude-sonnet-4-5', scope: 'global' }),
      expect.objectContaining({ name: 'glm-5', provider_id: 'zhipu', capability: 'default_override' }),
      expect.objectContaining({ name: 'glm-5-haiku', provider_id: 'zhipu', capability: 'haiku' }),
    ]));
    expect(res.body.observed_models).toEqual([
      { name: 'claude-sonnet-4-5', count: 5, cost_usd: 1.23 },
      { name: 'glm-5', count: 2, cost_usd: 0.4 },
    ]);
    expect(statsCollector.getTopModels).toHaveBeenCalledWith(10);
  });

  test('GET /api/models respects observed_limit query param', async () => {
    const res = await request(app).get('/api/models?observed_limit=3');

    expect(res.status).toBe(200);
    expect(statsCollector.getTopModels).toHaveBeenCalledWith(3);
  });
});

