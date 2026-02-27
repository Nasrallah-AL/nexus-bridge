# API Authentication & Security Enhancement Design

**Date:** 2025-02-27
**Author:** Claude + User Collaboration
**Status:** Design Approved

## Overview

Add API key-based authentication to Claude Code Server to secure exposed interfaces, with TUI-based configuration management and automatic key generation.

## Requirements

- Support mixed deployment scenarios (internal network and public internet)
- Single static API key model (simple, suitable for single-user/small teams)
- Protect all API endpoints with optional health check bypass
- TUI integration for enabling/disabling authentication and viewing keys
- Auto-generate SECRET_KEY on first startup
- Swagger documentation integration

## Architecture

### Dual-Layer Key System

```
SECRET_KEY (config) → Derive Function → API Key (client uses)
```

- **SECRET_KEY**: Stored in `config.json`, never exposed, used as seed
- **API Key**: Derived from SECRET_KEY, used for `Authorization: Bearer` header

### Configuration Structure

```json
{
  "security": {
    "auth": {
      "enabled": false,
      "secretKey": "ccs_sk_<base64url>",
      "bypassHealthCheck": true
    }
  }
}
```

### Component Flow

```
Client Request → Express → Auth Middleware (if enabled) → Verify API Key → Route Handler
                                      ↓
                                 401 Unauthorized
```

## Implementation Details

### 1. Key Generator (`src/utils/keyGenerator.js`)

```javascript
// Generate SECRET_KEY (stored in config)
function generateSecretKey() {
  const bytes = crypto.randomBytes(32);
  return `ccs_sk_${bytes.toString('base64url')}`;
}

// Derive API Key from SECRET_KEY
function deriveApiKey(secretKey) {
  const derived = crypto.createHmac('sha256', secretKey)
    .update('claude-code-server-api-key')
    .digest('base64url');
  return `ccs_ak_${derived}`;
}
```

### 2. Auth Middleware (`src/middleware/auth.js`)

- Check `Authorization: Bearer <api-key>` header
- Bypass if `enabled: false`
- Optional bypass for `/health` endpoint
- Return 401 on validation failure

### 3. Server Initialization (`server.js`)

Modify `loadConfig()` to:
- Auto-generate SECRET_KEY on first startup
- Backfill missing SECRET_KEY for existing configs
- Log when SECRET_KEY is auto-generated

Apply middleware:
```javascript
const createAuthMiddleware = require('./src/middleware/auth');
const authMiddleware = createAuthMiddleware(config);
app.use('/api/', authMiddleware);
```

### 4. TUI Integration (`cli.js`)

Add security section to `configureSettings()`:
- Toggle authentication on/off
- Display current API Key
- Option to regenerate key
- Configure health check bypass
- Save with hot reload

### 5. Swagger Configuration (`swagger-config.js`)

Add security scheme:
```javascript
{
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'API Key'
}
```

Apply globally with override for `/health` if bypassed.

## Additional Security Enhancements

### 1. Sensitive Data Filtering
- Hide SECRET_KEY in `/api/config` endpoint
- Show only `*** HIDDEN ***`

### 2. Audit Logging (`src/services/auditLogger.js`)
- Log auth failures with IP, path, reason
- Log API usage with path, method, timestamp
- Store in statistics database

### 3. Environment Variable Support
```bash
export CCS_SECRET_KEY="ccs_sk_xxx"
export CCS_AUTH_ENABLED="true"
```

### 4. CORS Configuration
```javascript
app.use(cors({
  origin: config.security?.cors?.allowedOrigins || ['localhost']
}));
```

### 5. Request Size Limit
```javascript
app.use(express.json({ limit: '1mb' }));
```

## Files to Create

1. `src/middleware/auth.js` - Authentication middleware
2. `src/utils/keyGenerator.js` - Key generation/derivation utilities
3. `src/services/auditLogger.js` - Audit logging service

## Files to Modify

1. `server.js`
   - Auto-generate SECRET_KEY in `loadConfig()`
   - Apply auth middleware to routes
   - Environment variable overrides

2. `cli.js`
   - Add security configuration section to `configureSettings()`
   - Display/regenerate API key options

3. `swagger-config.js`
   - Add BearerAuth security scheme
   - Apply global security with health check override

4. `src/routes/config.js`
   - Filter SECRET_KEY from config response

## Testing Checklist

- [ ] First startup generates SECRET_KEY automatically
- [ ] TUI can enable/disable authentication
- [ ] TUI displays correct API Key
- [ ] TUI can regenerate key
- [ ] Auth middleware blocks requests without valid key
- [ ] Auth middleware allows requests with valid key
- [ ] Health check bypass works when configured
- [ ] Swagger UI Authorize button works
- [ ] Existing configs auto-migrate (get SECRET_KEY)
- [ ] Environment variable overrides work
- [ ] Hot reload picks up auth changes
- [ ] Audit logs record failures

## Migration Path

**Existing Users:**
- On next startup, SECRET_KEY auto-generated if missing
- Authentication disabled by default (`enabled: false`)
- User can opt-in via TUI configuration

**New Users:**
- SECRET_KEY generated on first run
- Authentication disabled by default
- Clear prompt in TUI to enable when needed
