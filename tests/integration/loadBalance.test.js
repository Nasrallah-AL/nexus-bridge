const ProviderRouter = require('../../src/services/providerRouter');

describe('Load Balance Integration', () => {
  test('full workflow: select, record, failover, reset', () => {
    const config = {
      providers: [
        { id: 'a', name: 'A', apiKey: 'ka', weight: 1, enabled: true },
        { id: 'b', name: 'B', apiKey: 'kb', weight: 1, enabled: true },
      ],
      loadBalance: {
        strategy: 'round-robin',
        failover: true,
        failureThreshold: 2,
        recoveryTimeout: 60,
      },
    };

    const router = new ProviderRouter(config);

    // 1. First session binds to 'a'
    const s1 = router.select('session-1');
    expect(s1.id).toBe('a');
    expect(s1.apiKey).toBe('ka');

    // 2. Second session binds to 'b'
    const s2 = router.select('session-2');
    expect(s2.id).toBe('b');

    // 3. Session affinity: session-1 still goes to 'a'
    expect(router.select('session-1').id).toBe('a');

    // 4. Make 'a' unhealthy
    router.recordFailure('a');
    router.recordFailure('a');

    // 5. Failover: session-1 should now go to 'b'
    const failedOver = router.select('session-1');
    expect(failedOver.id).toBe('b');

    // 6. Reset 'a' health
    router.resetProvider('a');

    // 7. New session can go to 'a' again
    const s3 = router.select('session-3');
    expect(['a', 'b']).toContain(s3.id);

    // 8. Status reflects all state
    const status = router.getStatus();
    expect(status.providers.find(p => p.id === 'a').healthy).toBe(true);
  });

  test('backward compatibility: no providers configured', () => {
    const router = new ProviderRouter({ claudePath: '/usr/bin/claude' });
    expect(router.select('any-session')).toBeNull();
    expect(router.getStatus().providers).toHaveLength(0);
  });

  test('weighted distribution', () => {
    const config = {
      providers: [
        { id: 'heavy', name: 'Heavy', apiKey: 'kh', weight: 3, enabled: true },
        { id: 'light', name: 'Light', apiKey: 'kl', weight: 1, enabled: true },
      ],
      loadBalance: {
        strategy: 'weighted',
        failover: false,
        failureThreshold: 3,
        recoveryTimeout: 60,
      },
    };

    const router = new ProviderRouter(config);
    const counts = { heavy: 0, light: 0 };

    // 4 slots total (3+1)
    for (let i = 0; i < 4; i++) {
      const p = router.select(`w-session-${i}`);
      counts[p.id]++;
    }

    expect(counts.heavy).toBe(3);
    expect(counts.light).toBe(1);
  });

  test('health tracking across requests', () => {
    const config = {
      providers: [
        { id: 'p1', name: 'P1', apiKey: 'k1', weight: 1, enabled: true },
      ],
      loadBalance: {
        strategy: 'round-robin',
        failover: false,
        failureThreshold: 3,
        recoveryTimeout: 60,
      },
    };

    const router = new ProviderRouter(config);

    // Record mixed success/failure
    router.recordSuccess('p1');
    router.recordFailure('p1');
    router.recordSuccess('p1');

    const status = router.getStatus();
    const p1Status = status.providers.find(p => p.id === 'p1');
    expect(p1Status.totalRequests).toBe(3);
    expect(p1Status.consecutiveFailures).toBe(0);
    expect(p1Status.healthy).toBe(true);
  });
});
