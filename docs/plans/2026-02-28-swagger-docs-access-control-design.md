# Swagger Docs Access Control Design

**Date**: 2026-02-28
**Status**: Design
**Author**: Claude

## Overview

Add a configuration option to control access to Swagger API documentation (`/api-docs` and `/api-docs.json`). This prevents exposing internal API documentation to external users in production environments.

## Requirements

1. **Configuration Toggle**: Add an `enabled` flag to control whether Swagger docs are accessible
2. **Default Enabled**: Maintain backward compatibility - default to `true` for existing and new installations
3. **Hot Reload**: Support runtime configuration changes without server restart
4. **404 on Disabled**: Return 404 (not 403) when disabled to avoid information disclosure
5. **Security Configuration**: Place the option under `security.swaggerDocs` namespace

## Configuration Structure

```json
{
  "security": {
    "auth": {
      "enabled": true,
      "secretKey": "...",
      "bypassHealthCheck": true
    },
    "swaggerDocs": {
      "enabled": true
    }
  }
}
```

## Implementation

### 1. Default Configuration (`server.js`)

Update the `defaultConfig` object to include the new setting:

```javascript
const defaultConfig = {
  // ... other config
  security: {
    auth: {
      enabled: false,
      secretKey: null,
      bypassHealthCheck: true
    },
    swaggerDocs: {
      enabled: true
    }
  }
};
```

### 2. Migration Logic (`loadConfig()` function)

Add automatic migration for existing configs:

```javascript
// In loadConfig() function, after reading existing config
if (config.security && !config.security.swaggerDocs) {
  config.security.swaggerDocs = { enabled: true };
}
```

### 3. Conditional Route Mounting (`server.js` lines 233-255)

Wrap Swagger route mounting with condition check:

```javascript
// Swagger API Documentation
if (config.security?.swaggerDocs?.enabled !== false) {
  const swaggerUi = require('swagger-ui-express');
  const swaggerSpec = require('./swagger-config');

  // Serve Swagger UI
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'Claude Code Server API Documentation',
    customCss: '.swagger-ui .topbar { display: none }',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'list',
      filter: true,
      showRequestHeaders: true,
      tryItOutEnabled: true
    }
  }));

  // Serve raw OpenAPI JSON spec
  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  logger.info('Swagger Documentation: enabled at /api-docs');
} else {
  logger.info('Swagger Documentation: disabled');
}
```

### 4. Hot Reload Support

Add to `hotReloadConfig()` function:

```javascript
if (newConfig.security?.swaggerDocs?.enabled !== config.security?.swaggerDocs?.enabled) {
  configChanges.push(`swaggerDocs.enabled: ${config.security.swaggerDocs.enabled} → ${newConfig.security.swaggerDocs.enabled}`);
  // Note: Route changes require restart, but config is updated for next restart
}
```

## Testing Scenarios

### 1. Default Behavior (Backward Compatibility)
- New installation: docs accessible → `GET /api-docs` returns 200
- Existing config: auto-migrate, docs remain accessible

### 2. Disabled Access
```bash
# Set enabled: false in config
curl http://localhost:5546/api-docs       # 404 Not Found
curl http://localhost:5546/api-docs.json  # 404 Not Found
curl http://localhost:5546/health         # 200 (unaffected)
```

### 3. Configuration Hot Reload
- Modify config to `false` → restart required (routes are static)
- Future improvement: dynamic route mounting/unmounting

### 4. CLI Tool
```bash
node cli.js config
# Displays current swaggerDocs.enabled setting
```

## Files Modified

1. **server.js**
   - Update `defaultConfig` object
   - Add migration logic in `loadConfig()`
   - Wrap Swagger routes with condition check
   - Add logging for enabled/disabled state

## Security Considerations

- **404 vs 403**: Using 404 prevents information disclosure about the existence of documentation
- **Default Safe**: While default is `enabled` for backward compatibility, production deployments should explicitly set `enabled: false`
- **No IP Restriction**: This design does not implement IP-based restrictions (use reverse proxy for that)

## Future Enhancements (Out of Scope)

- IP whitelist/blacklist for documentation access
- Authentication requirement for documentation (re-use existing auth middleware)
- Dynamic route mounting/unmounting without restart
- Separate toggle for Swagger UI vs OpenAPI JSON spec

## Success Criteria

- [ ] Configuration option works as expected
- [ ] Backward compatibility maintained (existing setups unaffected)
- [ ] 404 returned when disabled
- [ ] Other routes unaffected
- [ ] Configuration hot-reload updates value (restart required for routes)
- [ ] CLI tool can view/modify setting
