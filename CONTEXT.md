# Project Context

> This is the longer-form project reference. For the concise agent prime prompt loaded at repo root, see [`AGENTS.md`](./AGENTS.md).

## What this repository is

This repository contains **Nexus Bridge**, published as `nexus-bridge`: a Node.js HTTP API wrapper around the Claude CLI.

It exposes Claude as a REST API and adds operational features that the raw CLI does not provide by itself:

- persistent multi-turn sessions
- synchronous and asynchronous message execution
- SSE streaming and stream resume/reconnect support
- task queueing with priorities and webhooks
- per-session message storage
- statistics collection
- configurable rate limiting
- API key authentication
- multi-provider load balancing with failover and provider-specific settings
- a terminal UI for local management

## Runtime + stack

- **Runtime:** Node.js >= 18
- **Server:** Express
- **Storage:** LowDB JSON files with a file-locking layer
- **Docs:** Swagger UI + OpenAPI JSON
- **CLI/TUI:** `blessed`, `inquirer`, `ora`
- **Validation/tests:** Joi, Jest, Supertest

There is no frontend app here; the main product is the server and the management CLI.

## Primary entry points

- `server.js` — boots the Express server, loads config, initializes stores/services, mounts routes, starts hot reload, and handles graceful shutdown.
- `cli.js` — interactive management tool and command runner (`start`, `stop`, `status`).
- `swagger-config.js` — OpenAPI generation.

## High-level architecture

The codebase follows a layered pattern:

1. **Routes** in `src/routes/`
   - translate HTTP requests into service calls
   - validate inputs
   - return standardized JSON responses
2. **Services** in `src/services/`
   - hold business logic for execution, sessions, queueing, streams, routing, statistics, etc.
3. **Storage** in `src/storage/`
   - JSON-backed persistence with locking for concurrent safety
4. **Utils/middleware** in `src/utils/` and `src/middleware/`
   - path resolution, auth, provider env handling, logging, validation helpers

## Main request surfaces

### Core HTTP routes

Mounted in `server.js`:

- `GET /health`
- `GET /api/config`
- `GET /api/config/features`
- `GET /api/config/providers`
- `GET /api/models`
- `GET /api/mcp`
- `GET /api/mcp/config`
- `POST /api/messages` — synchronous Claude execution
- `POST /api/async/messages` — enqueue async Claude execution
- `USE /api/sessions` — session CRUD, continuation, message history, streaming, stream resume
- `USE /api/projects` — project history and aggregate project stats
- `USE /api/statistics` — usage and analytics endpoints
- `USE /api/tasks` — task inspection/cancellation/management
- `USE /api/load-balance` — provider health, bindings, enable/disable, provider settings
- `GET /api-docs`
- `GET /api-docs.json`

### Important flows

#### 1. Synchronous execution
`/api/messages` routes eventually call `ClaudeExecutor`, which spawns the Claude CLI, captures JSON output, calculates duration/cost, and updates stores.

#### 2. Session continuation
`SessionManager` loads a session, validates the session/project path, records the user message, and calls `ClaudeExecutor` with the correct `sessionId` so Claude can continue or resume state.

#### 3. Async execution
`/api/async/messages` writes a task through `TaskStore`; `TaskQueue` polls pending work, runs it with configurable concurrency, persists status changes, and emits webhook notifications.

#### 4. Streaming execution
Streaming paths use `ClaudeStreamExecutor` + `StreamManager`.
The CLI is spawned with `--output-format stream-json`, output is forwarded as SSE, and active streams can be resumed/reconnected later by `stream_id`.

#### 5. Provider routing / load balancing
`ProviderRouter` selects a provider using round-robin or weighted strategy, keeps session affinity bindings, tracks health/failures, and supports failover. `ProviderSettingsManager` manages per-provider Claude settings files and symlinks them into project `.claude/settings.json` when needed.

## Most important services

- `src/services/claudeExecutor.js`
  - non-streaming Claude CLI execution
  - session-aware `--session-id` vs `--resume`
  - budget checks before and after execution
  - provider environment injection
  - stats/session/message persistence hooks

- `src/services/claudeStreamExecutor.js`
  - streaming CLI execution
  - SSE event formatting
  - stream registration + completion tracking
  - reconnect/resume support

- `src/services/sessionManager.js`
  - create/read/list/delete sessions
  - continue multi-turn conversations
  - session status and cleanup

- `src/services/taskQueue.js`
  - priority queue + concurrency control
  - startup recovery of unfinished tasks
  - task cancellation/timeouts
  - webhook events for started/completed/failed tasks

- `src/services/providerRouter.js`
  - provider selection
  - sticky session bindings
  - health tracking and automatic failover
  - hot config updates

- `src/services/providerSettingsManager.js`
  - persists provider-specific Claude settings files under `~/.nexus-bridge/provider/`
  - creates/removes project symlinks so requests run with the selected provider settings

- `src/services/streamManager.js`
  - tracks active streams, connected SSE clients, accumulated content, and cleanup

- `src/services/statisticsCollector.js`
  - periodic collection and analytics-oriented summaries

## Storage model

All stores extend `src/storage/baseStore.js`, which provides:

- LowDB-backed JSON persistence
- a `.lock` file mechanism for safe concurrent writes
- stale lock cleanup
- `withLock()` for atomic write operations

Key stores:

- `sessionStore` — session metadata and lifecycle
- `taskStore` — async task state machine (`pending -> processing -> completed/failed/cancelled`)
- `statsStore` — usage statistics and aggregates
- `messageStore` — per-session message history and streaming message support

## Configuration model

Runtime configuration lives in:

- `~/.nexus-bridge/config.json`

Other runtime files live under the same home directory:

- logs: `~/.nexus-bridge/logs/`
- pid: `~/.nexus-bridge/server.pid`
- data: `~/.nexus-bridge/data/`
- provider settings: `~/.nexus-bridge/provider/`
- default workspace: `~/.nexus-bridge/workspace/`

Important config themes:

- network: `port`, `host`, `trustProxy`
- Claude execution: `claudePath`, `nodeBinDir`, `workspacePath`, `defaultModel`, `maxBudgetUsd`
- queueing: `taskQueue.concurrency`, `taskQueue.defaultTimeout`
- observability: `logFile`, `logLevel`, `statistics.*`
- security: `security.auth.*`, `security.swaggerDocs.enabled`, `allowDangerouslySkipPermissions`
- integrations: `webhook.*`, `mcp.*`
- multi-provider: `providers[]`, `loadBalance.*`

### Config behavior worth knowing

- missing config is auto-generated on first run
- `defaultProjectPath` is migrated to `workspacePath` for backward compatibility
- path detection/repair is performed during startup
- `server.js` watches the config file and hot-reloads changes for several subsystems
- environment overrides exist for auth (`NEXUS_BRIDGE_SECRET_KEY`, `NEXUS_BRIDGE_AUTH_ENABLED`)

## Security and runtime behavior

- API auth is implemented in `src/middleware/auth.js` using bearer tokens derived from a secret key.
- Auth can be enabled for all `/api/*` routes.
- Health checks may bypass auth if configured.
- Rate limiting is applied to `/api/*` via `RateLimiter`.
- Swagger docs can be disabled at runtime.
- Graceful shutdown stops the config watcher, statistics collector, and task queue, then closes the server.

## Development commands

From `package.json`:

```bash
npm install
npm start
npm run cli
npm test
npm run test:watch
npm run test:coverage
```

Direct equivalents:

```bash
node server.js
node cli.js
node cli.js start
node cli.js stop
node cli.js status
```

## Testing landscape

The repo uses Jest with tests under `tests/**/*.test.js`.
Current coverage areas include:

- routes: config, health, load balance, MCP, models, session streaming
- services: Claude executor, streaming executor, provider router, stream manager
- storage: base store, message store
- utils: key generation, runtime paths, path resolution
- integration/e2e: load balancing and stream resume behavior

Jest config sets a global coverage threshold of 50% for branches/functions/lines/statements.

## Files worth reading first

If you need to understand or modify behavior, start here:

1. `server.js`
2. `cli.js`
3. `src/services/claudeExecutor.js`
4. `src/services/claudeStreamExecutor.js`
5. `src/services/sessionManager.js`
6. `src/services/taskQueue.js`
7. `src/services/providerRouter.js`
8. `src/routes/sessions.js`
9. `src/routes/claude/`
10. `src/storage/baseStore.js`

## Project conventions and implementation notes

- Keep route handlers thin; business logic belongs in services.
- Route factories receive their dependencies explicitly rather than importing singletons.
- Preserve standardized API responses, usually beginning with `success: true/false`.
- Session/project paths should be validated relative to `workspacePath`.
- Streaming support is a first-class feature; changes around sessions should consider stream resume behavior.
- Load balancing is not just provider selection; it also affects project-level Claude settings symlinks and health tracking.
- Because config is hot-reloaded, avoid patterns that assume config is immutable after startup.
- Storage changes should respect the locking model in `BaseStore`.

## Repository-specific note

The workspace folder and project name are both `Nexus Bridge`. Use `Nexus Bridge` for the product name and `nexus-bridge` for package and CLI references.




