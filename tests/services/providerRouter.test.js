const ProviderRouter = require('../../src/services/providerRouter');

describe('ProviderRouter', () => {
  const makeConfig = (overrides = {}) => ({
    providers: [
      { id: 'p1', name: 'Provider 1', apiKey: 'key1', weight: 1, enabled: true },
      { id: 'p2', name: 'Provider 2', apiKey: 'key2', weight: 1, enabled: true },
      { id: 'p3', name: 'Provider 3', apiKey: 'key3', weight: 1, enabled: true },
    ],
    loadBalance: {
      strategy: 'round-robin',
      failover: false,
      failureThreshold: 3,
      recoveryTimeout: 60,
    },
    ...overrides,
  });

  describe('no providers configured', () => {
    test('select() returns null when providers is undefined', () => {
      const router = new ProviderRouter({});
      expect(router.select('session-1')).toBeNull();
    });

    test('select() returns null when providers is empty', () => {
      const router = new ProviderRouter({ providers: [] });
      expect(router.select('session-1')).toBeNull();
    });
  });

  describe('round-robin strategy', () => {
    test('distributes across providers in order', () => {
      const router = new ProviderRouter(makeConfig());
      const s1 = router.select('s1');
      const s2 = router.select('s2');
      const s3 = router.select('s3');

      const ids = [s1.id, s2.id, s3.id];
      expect(ids).toEqual(['p1', 'p2', 'p3']);
    });

    test('wraps around after all providers used', () => {
      const router = new ProviderRouter(makeConfig());
      router.select('s1');
      router.select('s2');
      router.select('s3');
      const s4 = router.select('s4');
      expect(s4.id).toBe('p1');
    });

    test('skips disabled providers', () => {
      const config = makeConfig();
      config.providers[1].enabled = false;
      const router = new ProviderRouter(config);

      const s1 = router.select('s1');
      const s2 = router.select('s2');
      expect(s1.id).toBe('p1');
      expect(s2.id).toBe('p3');
    });
  });

  describe('session affinity', () => {
    test('same sessionId always returns same provider', () => {
      const router = new ProviderRouter(makeConfig());
      const first = router.select('session-abc');
      const second = router.select('session-abc');
      const third = router.select('session-abc');

      expect(first.id).toBe(second.id);
      expect(second.id).toBe(third.id);
    });

    test('different sessionIds can get different providers', () => {
      const router = new ProviderRouter(makeConfig());
      const a = router.select('session-a');
      const b = router.select('session-b');
      expect(a.id).not.toBe(b.id);
    });
  });

  describe('weighted strategy', () => {
    const makeWeightedConfig = () => ({
      providers: [
        { id: 'heavy', name: 'Heavy', apiKey: 'k1', weight: 3, enabled: true },
        { id: 'light', name: 'Light', apiKey: 'k2', weight: 1, enabled: true },
      ],
      loadBalance: {
        strategy: 'weighted',
        failover: false,
        failureThreshold: 3,
        recoveryTimeout: 60,
      },
    });

    test('distributes proportionally to weight', () => {
      const router = new ProviderRouter(makeWeightedConfig());
      const counts = { heavy: 0, light: 0 };

      for (let i = 0; i < 4; i++) {
        const p = router.select(`w-session-${i}`);
        counts[p.id]++;
      }

      expect(counts.heavy).toBe(3);
      expect(counts.light).toBe(1);
    });

    test('session affinity works with weighted', () => {
      const router = new ProviderRouter(makeWeightedConfig());
      const first = router.select('sticky');
      const second = router.select('sticky');
      expect(first.id).toBe(second.id);
    });
  });

  describe('health tracking', () => {
    test('recordFailure marks unhealthy after threshold', () => {
      const config = makeConfig();
      config.loadBalance.failureThreshold = 2;
      const router = new ProviderRouter(config);

      router.recordFailure('p1');
      let status = router.getStatus();
      expect(status.providers.find(p => p.id === 'p1').healthy).toBe(true);

      router.recordFailure('p1');
      status = router.getStatus();
      expect(status.providers.find(p => p.id === 'p1').healthy).toBe(false);
    });

    test('recordSuccess resets failure count and restores health', () => {
      const config = makeConfig();
      config.loadBalance.failureThreshold = 2;
      const router = new ProviderRouter(config);

      router.recordFailure('p1');
      router.recordFailure('p1');
      expect(router.getStatus().providers.find(p => p.id === 'p1').healthy).toBe(false);

      router.recordSuccess('p1');
      expect(router.getStatus().providers.find(p => p.id === 'p1').healthy).toBe(true);
    });

    test('totalRequests increments on both success and failure', () => {
      const router = new ProviderRouter(makeConfig());
      router.recordSuccess('p1');
      router.recordFailure('p1');
      router.recordSuccess('p1');

      const status = router.getStatus();
      expect(status.providers.find(p => p.id === 'p1').totalRequests).toBe(3);
    });
  });

  describe('failover', () => {
    test('re-binds to healthy provider when failover enabled', () => {
      const config = makeConfig();
      config.loadBalance.failover = true;
      config.loadBalance.failureThreshold = 1;
      const router = new ProviderRouter(config);

      const first = router.select('fo-session');
      expect(first.id).toBe('p1');

      router.recordFailure('p1');

      const second = router.select('fo-session');
      expect(second.id).not.toBe('p1');
    });

    test('returns bound provider even if unhealthy when failover disabled', () => {
      const config = makeConfig();
      config.loadBalance.failover = false;
      config.loadBalance.failureThreshold = 1;
      const router = new ProviderRouter(config);

      const first = router.select('no-fo');
      expect(first.id).toBe('p1');

      router.recordFailure('p1');

      const second = router.select('no-fo');
      expect(second.id).toBe('p1');
    });

    test('resetProvider restores health', () => {
      const config = makeConfig();
      config.loadBalance.failureThreshold = 1;
      const router = new ProviderRouter(config);

      router.recordFailure('p1');
      expect(router.getStatus().providers.find(p => p.id === 'p1').healthy).toBe(false);

      router.resetProvider('p1');
      expect(router.getStatus().providers.find(p => p.id === 'p1').healthy).toBe(true);
    });
  });

  describe('getStatus and getBindings', () => {
    test('getStatus returns complete info', () => {
      const router = new ProviderRouter(makeConfig());
      router.select('s1');

      const status = router.getStatus();
      expect(status.strategy).toBe('round-robin');
      expect(status.failover).toBe(false);
      expect(status.providers).toHaveLength(3);
      expect(status.providers[0].boundSessions).toBe(1);
    });

    test('getBindings returns session map', () => {
      const router = new ProviderRouter(makeConfig());
      router.select('s1');
      router.select('s2');

      const bindings = router.getBindings();
      expect(Object.keys(bindings)).toHaveLength(2);
      expect(bindings['s1']).toBeDefined();
      expect(bindings['s2']).toBeDefined();
    });
  });
});
