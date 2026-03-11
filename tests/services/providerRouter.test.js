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
});
