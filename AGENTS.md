# AGENTS.md

## Context
Nexus Bridge (`nexus-bridge`) is a Node.js/Express API wrapper around the Claude CLI. It adds persistent sessions, async task processing, SSE streaming with resume support, statistics, API auth, load balancing across providers, and a TUI management CLI.

## Tooling
- Node.js >= 18
- Express for HTTP APIs
- LowDB JSON storage with file locking in `src/storage/baseStore.js`
- Joi for request validation
- Jest + Supertest for tests
- Swagger UI / OpenAPI for API docs

## Key Commands
```bash
npm install
npm start
npm run cli
node cli.js start
node cli.js stop
node cli.js status
npm test
npm run test:coverage
```

## Project Structure
- `server.js` — server bootstrap, config loading, route mounting, hot reload, shutdown
- `cli.js` — interactive TUI and service lifecycle management
- `src/routes/` — HTTP route factories
- `src/services/` — core business logic (`claudeExecutor`, `claudeStreamExecutor`, `sessionManager`, `taskQueue`, `providerRouter`, `streamManager`)
- `src/storage/` — JSON-backed stores for sessions, tasks, stats, messages
- `src/utils/` + `src/middleware/` — auth, validation, path/runtime/provider helpers
- `tests/` — route, service, storage, utility, integration, and e2e coverage

## Development Guidelines
- Keep route handlers thin; put business logic in services.
- Preserve the dependency-injection pattern used by route factory modules.
- Return the existing response shape conventions, usually `success: true/false` JSON.
- Validate and resolve project paths relative to `config.workspacePath`.
- Respect session semantics: existing conversations may require `--resume` rather than `--session-id`.
- Treat streaming and stream resume as first-class behavior when changing session/message flows.
- Respect the storage locking model; do not bypass `BaseStore` write protections.

## Important Notes
- Runtime config lives at `~/.nexus-bridge/config.json`; it is auto-created and hot-reloaded.
- Main runtime data lives under `~/.nexus-bridge/` (`logs/`, `data/`, `provider/`, `workspace/`).
- `server.js` mounts auth and rate limiting on `/api/*`; `/health` may bypass auth depending on config.
- Load balancing is more than provider selection: it also manages sticky session bindings, health/failover, and provider-specific `.claude/settings.json` symlinks.
- Swagger docs are served from `/api-docs` and can be disabled by config.
- Read these files first for non-trivial work: `server.js`, `src/routes/sessions.js`, `src/services/claudeExecutor.js`, `src/services/claudeStreamExecutor.js`, `src/services/taskQueue.js`, `src/services/providerRouter.js`.
- Use `AGENTS.md` for concise agent guidance and `CONTEXT.md` for the longer project reference.

