# Load Balance Design

## Overview

Add multi-Provider (API Key + Base URL) support with session-affinity load balancing to claude-code-server. Supports round-robin and weighted strategies, with optional automatic failover.

## Requirements

- Multiple Provider configurations (each with independent API Key / Base URL)
- Session affinity: same `session_id` always routes to the same Provider
- Two strategies: round-robin and weighted
- Configurable automatic failover (when bound Provider becomes unhealthy, re-bind to next available)
- Backward compatible: no `providers` config = current behavior unchanged

## Configuration

Added to `~/.claude-code-server/config.json`:

```json
{
  "claudePath": "/path/to/claude",
  "providers": [
    {
      "id": "main",
      "name": "Main Key",
      "apiKey": "sk-ant-xxx",
      "baseUrl": "https://api.anthropic.com",
      "weight": 3,
      "enabled": true
    },
    {
      "id": "backup",
      "name": "Backup Key",
      "apiKey": "sk-ant-yyy",
      "baseUrl": "https://api.anthropic.com",
      "weight": 1,
      "enabled": true
    }
  ],
  "loadBalance": {
    "strategy": "weighted",
    "failover": true,
    "failureThreshold": 3,
    "recoveryTimeout": 60
  }
}
```

### Field Definitions

- `providers[].id` - Unique identifier
- `providers[].apiKey` - Anthropic API Key, injected as `ANTHROPIC_API_KEY` env var
- `providers[].baseUrl` - Optional, for third-party compatible endpoints
- `providers[].weight` - Weight (only for `weighted` strategy)
- `providers[].enabled` - Whether this provider is active
- `loadBalance.strategy` - `"round-robin"` | `"weighted"`
- `loadBalance.failover` - Enable automatic failover
- `loadBalance.failureThreshold` - Consecutive failures before marking unhealthy
- `loadBalance.recoveryTimeout` - Seconds before attempting recovery

## Architecture

```
Route Layer
  │
  │ 1. providerRouter.select(sessionId)
  │ 2. claudeExecutor.execute({ provider })
  │ 3. providerRouter.recordSuccess/recordFailure(providerId)
  │
  ▼
ProviderRouter (new)
  ├─ Strategy Selector (RoundRobin / Weighted)
  ├─ Session Binding Map (sessionId → providerId)
  └─ Health State Map (providerId → { failures, healthy, lastFailAt })
  │
  ▼
ClaudeExecutor (modified)
  └─ spawnCommand injects env: ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL
```

## Component Details

### ProviderRouter (`src/services/providerRouter.js`) - NEW

Core API:

```js
class ProviderRouter {
  constructor(config)
  select(sessionId): Provider | null   // null when no providers configured
  recordSuccess(providerId)
  recordFailure(providerId)
  getStatus(): { strategy, failover, providers[] }
}
```

Selection logic:
1. Has binding + healthy → return bound Provider
2. Has binding + unhealthy + failover enabled → select new Provider, re-bind
3. No binding → select by strategy (RR/Weighted), create binding

Strategy implementation:
- **Round-Robin**: `index++ % enabledProviders.length`
- **Weighted**: expand providers into slot array by weight, then round-robin slots

Session bindings: in-memory `Map<sessionId, providerId>`. No persistence needed - re-binds transparently on restart.

Compatibility: when `providers` is not configured, `select()` returns `null` and all behavior is unchanged.

### ClaudeExecutor (`src/services/claudeExecutor.js`) - MODIFIED

Minimal changes:
- `execute()`: accept optional `provider` param, pass to `spawnCommand`
- `spawnCommand()`: if `provider` is provided, inject `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` into spawn env

### Route Layer - MODIFIED

Both sync and async message routes:
1. Call `providerRouter.select(sessionId)` before execute
2. Pass `provider` to `claudeExecutor.execute()`
3. After execution, call `recordSuccess/recordFailure`

For async (TaskQueue): provider is selected at task creation time, stored in `task.metadata.provider`, retrieved during `executeTask`.

### Management API (`src/routes/loadBalance.js`) - NEW

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/load-balance/status` | Provider health, request counts, binding counts |
| GET | `/api/load-balance/bindings` | Current session-provider bindings |
| POST | `/api/load-balance/providers/:id/reset` | Reset provider health state |
| POST | `/api/load-balance/providers/:id/enable` | Enable a provider |
| POST | `/api/load-balance/providers/:id/disable` | Disable a provider |

## Files Changed

**New files:**
- `src/services/providerRouter.js`
- `src/routes/loadBalance.js`

**Modified files:**
- `server.js` - init ProviderRouter, mount management route
- `src/services/claudeExecutor.js` - accept provider in execute/spawnCommand
- `src/routes/claude/sync/messages.js` - add select + record
- `src/routes/claude/async/messages.js` - add select, store provider in metadata
- `src/services/taskQueue.js` - pass metadata.provider to execute
