# Load Balance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add multi-Provider load balancing with session affinity, round-robin/weighted strategies, and optional failover.

**Architecture:** New `ProviderRouter` service sits between routes and `ClaudeExecutor`. Routes call `select(sessionId)` to pick a Provider, pass it to `execute()`, then `recordSuccess/recordFailure`. `ClaudeExecutor` injects Provider's API Key/Base URL as environment variables when spawning Claude CLI.

**Tech Stack:** Node.js, Express, Jest, supertest

---

### Task 1: ProviderRouter - Round-Robin Strategy

**Files:**
- Create: `src/services/providerRouter.js`
- Create: `tests/services/providerRouter.test.js`

**Step 1: Write the failing tests**

```js
// tests/services/providerRouter.test.js
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
      router.select('s1'); // p1
      router.select('s2'); // p2
      router.select('s3'); // p3
      const s4 = router.select('s4'); // wraps to p1
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
      // They should be different due to round-robin
      expect(a.id).not.toBe(b.id);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx jest tests/services/providerRouter.test.js --verbose`
Expected: FAIL - cannot find module `../../src/services/providerRouter`

**Step 3: Write minimal implementation**

```js
// src/services/providerRouter.js

class ProviderRouter {
  constructor(config) {
    this.providers = (config.providers || []).filter(p => p.enabled !== false);
    this.loadBalance = config.loadBalance || {};
    this.strategy = this.loadBalance.strategy || 'round-robin';

    // Session affinity: sessionId -> providerId
    this.bindings = new Map();

    // Round-robin index
    this.rrIndex = 0;

    // Health state: providerId -> { healthy, consecutiveFailures, lastFailAt, totalRequests }
    this.healthState = new Map();
    for (const p of this.providers) {
      this.healthState.set(p.id, {
        healthy: true,
        consecutiveFailures: 0,
        lastFailAt: null,
        totalRequests: 0,
      });
    }
  }

  /**
   * Select a provider for the given session.
   * Returns null if no providers are configured (backward compatible).
   */
  select(sessionId) {
    if (this.providers.length === 0) {
      return null;
    }

    // Check existing binding
    if (this.bindings.has(sessionId)) {
      const boundId = this.bindings.get(sessionId);
      const provider = this.providers.find(p => p.id === boundId);
      if (provider) {
        const health = this.healthState.get(boundId);
        if (health && health.healthy) {
          return provider;
        }
        // Unhealthy: failover or return anyway
        if (!this.loadBalance.failover) {
          return provider;
        }
        // Failover: select a new provider, re-bind
        const newProvider = this._selectByStrategy(boundId);
        if (newProvider) {
          this.bindings.set(sessionId, newProvider.id);
          return newProvider;
        }
        // All unhealthy, return original
        return provider;
      }
    }

    // No binding: select by strategy
    const provider = this._selectByStrategy();
    if (provider) {
      this.bindings.set(sessionId, provider.id);
    }
    return provider;
  }

  /**
   * Record a successful request.
   */
  recordSuccess(providerId) {
    const health = this.healthState.get(providerId);
    if (!health) return;

    health.consecutiveFailures = 0;
    health.healthy = true;
    health.totalRequests++;
  }

  /**
   * Record a failed request.
   */
  recordFailure(providerId) {
    const health = this.healthState.get(providerId);
    if (!health) return;

    health.consecutiveFailures++;
    health.totalRequests++;
    health.lastFailAt = Date.now();

    const threshold = this.loadBalance.failureThreshold || 3;
    if (health.consecutiveFailures >= threshold) {
      health.healthy = false;
    }
  }

  /**
   * Get status of all providers for the management API.
   */
  getStatus() {
    const providers = this.providers.map(p => {
      const health = this.healthState.get(p.id) || {};
      // Count bound sessions
      let boundSessions = 0;
      for (const [, pid] of this.bindings) {
        if (pid === p.id) boundSessions++;
      }

      return {
        id: p.id,
        name: p.name,
        weight: p.weight || 1,
        enabled: true,
        healthy: health.healthy !== false,
        consecutiveFailures: health.consecutiveFailures || 0,
        totalRequests: health.totalRequests || 0,
        boundSessions,
      };
    });

    return {
      strategy: this.strategy,
      failover: !!this.loadBalance.failover,
      providers,
    };
  }

  /**
   * Get current session-provider bindings.
   */
  getBindings() {
    const result = {};
    for (const [sessionId, providerId] of this.bindings) {
      result[sessionId] = providerId;
    }
    return result;
  }

  /**
   * Reset health state for a provider.
   */
  resetProvider(providerId) {
    const health = this.healthState.get(providerId);
    if (!health) return false;

    health.healthy = true;
    health.consecutiveFailures = 0;
    health.lastFailAt = null;
    return true;
  }

  /**
   * Enable a provider at runtime.
   */
  enableProvider(providerId) {
    const config = (this._allProviders || []).find(p => p.id === providerId);
    if (!config) return false;

    if (!this.providers.find(p => p.id === providerId)) {
      this.providers.push(config);
      this.healthState.set(providerId, {
        healthy: true,
        consecutiveFailures: 0,
        lastFailAt: null,
        totalRequests: 0,
      });
      this._rebuildSlots();
    }
    return true;
  }

  /**
   * Disable a provider at runtime.
   */
  disableProvider(providerId) {
    const idx = this.providers.findIndex(p => p.id === providerId);
    if (idx === -1) return false;

    this.providers.splice(idx, 1);
    this._rebuildSlots();
    return true;
  }

  // --- Private methods ---

  _selectByStrategy(excludeId = null) {
    const candidates = this.providers.filter(p => p.id !== excludeId);
    if (candidates.length === 0) return null;

    if (this.strategy === 'weighted') {
      return this._selectWeighted(candidates);
    }
    return this._selectRoundRobin(candidates);
  }

  _selectRoundRobin(candidates) {
    const idx = this.rrIndex % candidates.length;
    this.rrIndex++;
    return candidates[idx];
  }

  _selectWeighted(candidates) {
    // Build slots if not yet built
    if (!this._slots || this._slotsDirty) {
      this._rebuildSlots();
    }

    // Filter slots to only include current candidates
    const validSlots = (this._slots || []).filter(
      id => candidates.some(c => c.id === id)
    );
    if (validSlots.length === 0) {
      return this._selectRoundRobin(candidates);
    }

    const idx = this.rrIndex % validSlots.length;
    this.rrIndex++;
    const selectedId = validSlots[idx];
    return candidates.find(c => c.id === selectedId);
  }

  _rebuildSlots() {
    this._slots = [];
    for (const p of this.providers) {
      const weight = p.weight || 1;
      for (let i = 0; i < weight; i++) {
        this._slots.push(p.id);
      }
    }
    this._slotsDirty = false;
  }
}

module.exports = ProviderRouter;
```

**Step 4: Run tests to verify they pass**

Run: `npx jest tests/services/providerRouter.test.js --verbose`
Expected: All 6 tests PASS

**Step 5: Commit**

```bash
git add src/services/providerRouter.js tests/services/providerRouter.test.js
git commit -m "feat: add ProviderRouter with round-robin strategy and session affinity"
```

---

### Task 2: ProviderRouter - Weighted Strategy

**Files:**
- Modify: `tests/services/providerRouter.test.js`
- Modify: `src/services/providerRouter.js` (already implemented, just add tests)

**Step 1: Write the failing tests**

Add to `tests/services/providerRouter.test.js`:

```js
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

    // 4 slots total (3+1), assign 4 sessions
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
```

**Step 2: Run tests to verify they pass (implementation already done)**

Run: `npx jest tests/services/providerRouter.test.js --verbose`
Expected: All 8 tests PASS

**Step 3: Commit**

```bash
git add tests/services/providerRouter.test.js
git commit -m "test: add weighted strategy tests for ProviderRouter"
```

---

### Task 3: ProviderRouter - Failover & Health

**Files:**
- Modify: `tests/services/providerRouter.test.js`
- Modify: `src/services/providerRouter.js` (already implemented, just verify with tests)

**Step 1: Write the failing tests**

Add to `tests/services/providerRouter.test.js`:

```js
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

    // Bind session to p1
    const first = router.select('fo-session');
    expect(first.id).toBe('p1');

    // Make p1 unhealthy
    router.recordFailure('p1');

    // Re-select should failover to different provider
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
    expect(second.id).toBe('p1'); // Still returns p1
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
```

**Step 2: Run tests to verify they pass**

Run: `npx jest tests/services/providerRouter.test.js --verbose`
Expected: All 16 tests PASS

**Step 3: Commit**

```bash
git add tests/services/providerRouter.test.js
git commit -m "test: add failover, health tracking, and status tests for ProviderRouter"
```

---

### Task 4: ClaudeExecutor - Accept Provider Param

**Files:**
- Modify: `src/services/claudeExecutor.js:19` (execute method)
- Modify: `src/services/claudeExecutor.js:272` (spawnCommand method)

**Step 1: Modify execute() to accept and pass provider**

In `src/services/claudeExecutor.js`, at line 19 in `execute()`, add `provider` to destructured options:

```js
const {
  provider = null,  // ← ADD THIS LINE
  prompt,
  projectPath,
  // ...rest unchanged
} = options;
```

Then at line 123 where `spawnCommand` is called, pass provider:

```js
result = await this.spawnCommand(projectPath, args, {
  onSpawn: options.onSpawn,
  provider,  // ← ADD THIS LINE
});
```

Also at line 142 (the retry path):

```js
result = await this.spawnCommand(projectPath, retryArgs, { provider });  // ← ADD provider
```

**Step 2: Modify spawnCommand() to inject env vars**

At line 272 in `spawnCommand()`, add `provider` to destructured options:

```js
const { onSpawn, provider } = options;  // ← ADD provider
```

After the existing `nodeBinDir` PATH logic (around line 282), add:

```js
// Inject Provider environment variables for load balancing
if (provider) {
  if (provider.apiKey) {
    env.ANTHROPIC_API_KEY = provider.apiKey;
  }
  if (provider.baseUrl) {
    env.ANTHROPIC_BASE_URL = provider.baseUrl;
  }
}
```

**Step 3: Run existing tests to verify nothing broke**

Run: `npx jest --verbose`
Expected: All existing tests PASS

**Step 4: Commit**

```bash
git add src/services/claudeExecutor.js
git commit -m "feat: ClaudeExecutor accepts provider param for API key injection"
```

---

### Task 5: Route Integration - Sync Messages

**Files:**
- Modify: `src/routes/claude/sync/messages.js`
- Modify: `src/routes/claude/index.js` (pass providerRouter to factory)

**Step 1: Modify route factory to accept providerRouter**

In `src/routes/claude/sync/messages.js`, change the function signature:

```js
function createMessagesRoute(claudeExecutor, config, sessionManager, providerRouter) {
```

Inside the route handler, after `ensureSession` and before `claudeExecutor.execute()`, add:

```js
// Select provider for load balancing
const provider = providerRouter ? providerRouter.select(sessionId) : null;
```

Pass `provider` to execute:

```js
const result = await claudeExecutor.execute({
  prompt: validated.prompt,
  projectPath: validated.projectPath,
  model: validated.model,
  sessionId: sessionId,
  systemPrompt: validated.systemPrompt,
  maxBudgetUsd: validated.maxBudgetUsd,
  allowedTools: validated.allowedTools,
  disallowedTools: validated.disallowedTools,
  agent: validated.agent,
  mcpConfig: validated.mcpConfig,
  permissionMode: validated.permissionMode,
  stream: validated.stream,
  provider,  // ← ADD THIS
});
```

After the result, add health recording:

```js
// Record result for load balancing health tracking
if (provider && providerRouter) {
  result.success
    ? providerRouter.recordSuccess(provider.id)
    : providerRouter.recordFailure(provider.id);
}
```

**Step 2: Update `src/routes/claude/index.js` to pass providerRouter through**

Read `src/routes/claude/index.js` first, then update `createClaudeRoutes` to accept and pass `providerRouter` to the messages sub-route factory.

**Step 3: Run existing tests**

Run: `npx jest --verbose`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/routes/claude/sync/messages.js src/routes/claude/index.js
git commit -m "feat: integrate ProviderRouter into sync message route"
```

---

### Task 6: Route Integration - Async Messages & TaskQueue

**Files:**
- Modify: `src/routes/claude/async/messages.js`
- Modify: `src/services/taskQueue.js:149` (executeTask method)

**Step 1: Modify async route to select provider and store in metadata**

In `src/routes/claude/async/messages.js`, change signature:

```js
function createAsyncMessagesRoute(claudeExecutor, config, taskQueue, sessionManager, providerRouter) {
```

Before `taskQueue.addTask()`, add:

```js
// Select provider for load balancing
const provider = providerRouter ? providerRouter.select(sessionId) : null;
```

Add `provider` to task metadata:

```js
const task = await taskQueue.addTask({
  prompt: validated.prompt,
  project_path: validated.projectPath,
  model: validated.model,
  priority: req.body.priority || 5,
  metadata: {
    // ...existing metadata...
    provider,  // ← ADD THIS (the full provider object)
  },
});
```

**Step 2: Modify TaskQueue.executeTask() to pass provider**

In `src/services/taskQueue.js`, at line ~202 where `claudeExecutor.execute()` is called, add:

```js
const result = await this.claudeExecutor.execute({
  prompt: task.prompt,
  projectPath: task.project_path,
  model: task.model,
  sessionId: metadata.session_id,
  // ...existing params...
  provider: metadata.provider || null,  // ← ADD THIS
  onSpawn: (childProcess) => { /* existing code */ },
});
```

Also need to accept `providerRouter` in TaskQueue constructor to record results. Add after execute:

```js
// Record result for load balancing health tracking
if (metadata.provider && this.providerRouter) {
  result.success
    ? this.providerRouter.recordSuccess(metadata.provider.id)
    : this.providerRouter.recordFailure(metadata.provider.id);
}
```

**Step 3: Run existing tests**

Run: `npx jest --verbose`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/routes/claude/async/messages.js src/services/taskQueue.js
git commit -m "feat: integrate ProviderRouter into async route and TaskQueue"
```

---

### Task 7: Management API Route

**Files:**
- Create: `src/routes/loadBalance.js`
- Create: `tests/routes/loadBalance.test.js`

**Step 1: Write the failing tests**

```js
// tests/routes/loadBalance.test.js
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
```

**Step 2: Run tests to verify they fail**

Run: `npx jest tests/routes/loadBalance.test.js --verbose`
Expected: FAIL - cannot find module

**Step 3: Write implementation**

```js
// src/routes/loadBalance.js
const router = require('express').Router();

function createLoadBalanceRoutes(providerRouter) {

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
```

**Step 4: Run tests to verify they pass**

Run: `npx jest tests/routes/loadBalance.test.js --verbose`
Expected: All 6 tests PASS

**Step 5: Commit**

```bash
git add src/routes/loadBalance.js tests/routes/loadBalance.test.js
git commit -m "feat: add load balance management API routes"
```

---

### Task 8: Server.js Wiring

**Files:**
- Modify: `server.js`

**Step 1: Add ProviderRouter initialization and route mounting**

In `server.js`, after the existing service initializations (around line 248), add:

```js
const ProviderRouter = require('./src/services/providerRouter');
const providerRouter = new ProviderRouter(config);
```

Update the route mounting (around line 282-284) to pass `providerRouter`:

```js
app.use('/api/messages', createClaudeRoutes(claudeExecutor, config, null, sessionManager, providerRouter));
app.use('/api/async/messages', createAsyncClaudeRoutes(claudeExecutor, config, taskQueue, sessionManager, providerRouter));
```

Add the management route:

```js
const createLoadBalanceRoutes = require('./src/routes/loadBalance');
app.use('/api/load-balance', createLoadBalanceRoutes(providerRouter));
```

Also pass `providerRouter` to `TaskQueue` constructor if needed (add to constructor params).

**Step 2: Add providerRouter to module cache reset list**

Add to the `modulePaths` array (around line 201):

```js
'./src/services/providerRouter',
```

**Step 3: Add hot-reload support for loadBalance config**

In `hotReloadConfig()` function, add detection for provider/loadBalance changes:

```js
if (JSON.stringify(newConfig.providers) !== JSON.stringify(config.providers) ||
    JSON.stringify(newConfig.loadBalance) !== JSON.stringify(config.loadBalance)) {
  configChanges.push('providers/loadBalance configuration changed');
  // Re-initialize providerRouter (bindings will be rebuilt on next request)
  Object.assign(providerRouter, new ProviderRouter(newConfig));
}
```

**Step 4: Run all tests**

Run: `npx jest --verbose`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add server.js
git commit -m "feat: wire ProviderRouter into server initialization and routes"
```

---

### Task 9: Final Integration Test

**Files:**
- Create: `tests/integration/loadBalance.test.js`

**Step 1: Write integration test**

```js
// tests/integration/loadBalance.test.js
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
    // After reset, 'a' is available again in round-robin
    expect(['a', 'b']).toContain(s3.id);

    // 8. Status reflects all state
    const status = router.getStatus();
    expect(status.providers.find(p => p.id === 'a').healthy).toBe(true);
    expect(status.providers.find(p => p.id === 'b').totalRequests).toBe(0);
  });

  test('backward compatibility: no providers configured', () => {
    const router = new ProviderRouter({ claudePath: '/usr/bin/claude' });
    expect(router.select('any-session')).toBeNull();
    expect(router.getStatus().providers).toHaveLength(0);
  });
});
```

**Step 2: Run all tests**

Run: `npx jest --verbose`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add tests/integration/loadBalance.test.js
git commit -m "test: add load balance integration test"
```
