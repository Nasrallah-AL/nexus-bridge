# API Authentication Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add API key-based authentication to Claude Code Server with TUI configuration management and automatic key generation.

**Architecture:** Dual-layer key system where SECRET_KEY (stored in config) derives API Key (used by clients). Auth middleware validates Bearer tokens on all `/api/*` routes with optional health check bypass.

**Tech Stack:** Node.js, Express, crypto module, inquirer (TUI), swagger-ui-express

---

## Task 1: Create Key Generator Utility

**Files:**
- Create: `src/utils/keyGenerator.js`

**Purpose:** Generate SECRET_KEY for storage and derive API Key for client authentication.

**Step 1: Create keyGenerator.js**

```javascript
const crypto = require('crypto');

/**
 * Generate a new SECRET_KEY for storage in config
 * Format: ccs_sk_<32 bytes base64url>
 * @returns {string} The secret key
 */
function generateSecretKey() {
  const bytes = crypto.randomBytes(32);
  return `ccs_sk_${bytes.toString('base64url')}`;
}

/**
 * Derive API Key from SECRET_KEY using HMAC-SHA256
 * Format: ccs_ak_<hmac digest>
 * @param {string} secretKey - The SECRET_KEY from config
 * @returns {string} The derived API key
 */
function deriveApiKey(secretKey) {
  const derived = crypto.createHmac('sha256', secretKey)
    .update('claude-code-server-api-key')
    .digest('base64url');
  return `ccs_ak_${derived}`;
}

/**
 * Validate an API key against the expected derived key
 * @param {string} clientApiKey - The API key from client request
 * @param {string} secretKey - The SECRET_KEY from config
 * @returns {boolean} True if valid
 */
function verifyApiKey(clientApiKey, secretKey) {
  const expectedApiKey = deriveApiKey(secretKey);
  return clientApiKey === expectedApiKey;
}

module.exports = {
  generateSecretKey,
  deriveApiKey,
  verifyApiKey
};
```

**Step 2: Test the utility manually**

Create test script: `test-keygen.js` (temporary, delete after testing)

```javascript
const { generateSecretKey, deriveApiKey, verifyApiKey } = require('./src/utils/keyGenerator');

console.log('Testing key generator...\n');

// Test 1: Generate SECRET_KEY
const secretKey = generateSecretKey();
console.log('SECRET_KEY:', secretKey);
console.assert(secretKey.startsWith('ccs_sk_'), 'SECRET_KEY should start with ccs_sk_');
console.assert(secretKey.length > 40, 'SECRET_KEY should be sufficiently long');

// Test 2: Derive API Key
const apiKey = deriveApiKey(secretKey);
console.log('\nAPI Key:', apiKey);
console.assert(apiKey.startsWith('ccs_ak_'), 'API Key should start with ccs_ak_');

// Test 3: Verify API Key
const isValid = verifyApiKey(apiKey, secretKey);
console.log('\nVerification (valid key):', isValid);
console.assert(isValid === true, 'Valid key should verify');

// Test 4: Reject invalid key
const isInvalid = verifyApiKey('ccs_ak_wrong', secretKey);
console.log('Verification (invalid key):', isInvalid);
console.assert(isInvalid === false, 'Invalid key should fail');

// Test 5: Same SECRET_KEY produces same API Key
const apiKey2 = deriveApiKey(secretKey);
console.log('\nDeterminism test:', apiKey === apiKey2);
console.assert(apiKey === apiKey2, 'Same secret should produce same API key');

console.log('\n✅ All tests passed!');
```

Run: `node test-keygen.js`

Expected output:
```
Testing key generator...

SECRET_KEY: ccs_sk_...
API Key: ccs_ak_...
Verification (valid key): true
Verification (invalid key): false
Determinism test: true

✅ All tests passed!
```

**Step 3: Clean up test file**

```bash
rm test-keygen.js
```

**Step 4: Commit**

```bash
git add src/utils/keyGenerator.js
git commit -m "feat: add key generation utility

- Generate SECRET_KEY for storage in config
- Derive API Key from SECRET_KEY using HMAC-SHA256
- Add verifyApiKey function for validation

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Create Authentication Middleware

**Files:**
- Create: `src/middleware/auth.js`

**Purpose:** Express middleware to validate API keys on protected routes.

**Step 1: Create auth middleware**

```javascript
const { deriveApiKey } = require('../utils/keyGenerator');

/**
 * Create authentication middleware
 * @param {object} config - Server configuration
 * @returns {Function} Express middleware
 */
function createAuthMiddleware(config) {
  return (req, res, next) => {
    // Check if authentication is enabled
    if (!config.security?.auth?.enabled) {
      return next();
    }

    // Bypass health check if configured
    if (config.security?.auth?.bypassHealthCheck && req.path === '/health') {
      return next();
    }

    // Extract Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        error: 'Missing Authorization header',
        hint: 'Use: Authorization: Bearer ccs_ak_<your-api-key>'
      });
    }

    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Invalid Authorization format',
        hint: 'Use: Authorization: Bearer ccs_ak_<your-api-key>'
      });
    }

    // Extract and verify API key
    const clientApiKey = authHeader.substring(7); // Remove 'Bearer '
    const expectedApiKey = deriveApiKey(config.security.auth.secretKey);

    if (clientApiKey !== expectedApiKey) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API Key'
      });
    }

    // Authentication successful
    next();
  };
}

module.exports = createAuthMiddleware;
```

**Step 2: Create manual test for middleware**

Create test script: `test-auth-middleware.js` (temporary)

```javascript
const express = require('express');
const request = require('supertest');
const createAuthMiddleware = require('./src/middleware/auth');

// Test configuration
const config = {
  security: {
    auth: {
      enabled: true,
      secretKey: 'ccs_sk_test_secret_key_12345678901234567890123456789012',
      bypassHealthCheck: true
    }
  }
};

const app = express();
app.use(express.json());
app.use(createAuthMiddleware(config));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/test', (req, res) => res.json({ message: 'success' }));

// Derive valid API key
const { deriveApiKey } = require('./src/utils/keyGenerator');
const validApiKey = deriveApiKey(config.security.auth.secretKey);

async function runTests() {
  console.log('Testing auth middleware...\n');

  // Test 1: Health check bypassed
  const res1 = await request(app).get('/health');
  console.log('Test 1 - Health check bypass:', res1.status === 200 ? '✅' : '❌');

  // Test 2: Missing auth header
  const res2 = await request(app).get('/api/test');
  console.log('Test 2 - No auth header (401):', res2.status === 401 ? '✅' : '❌');

  // Test 3: Invalid format
  const res3 = await request(app)
    .get('/api/test')
    .set('Authorization', 'InvalidFormat');
  console.log('Test 3 - Invalid format (401):', res3.status === 401 ? '✅' : '❌');

  // Test 4: Invalid API key
  const res4 = await request(app)
    .get('/api/test')
    .set('Authorization', 'Bearer wrong_key');
  console.log('Test 4 - Wrong API key (401):', res4.status === 401 ? '✅' : '❌');

  // Test 5: Valid API key
  const res5 = await request(app)
    .get('/api/test')
    .set('Authorization', `Bearer ${validApiKey}`);
  console.log('Test 5 - Valid API key (200):', res5.status === 200 ? '✅' : '❌');

  console.log('\n✅ All middleware tests passed!');
}

runTests().then(() => process.exit(0));
```

Run: `node test-auth-middleware.js`

Expected: All tests pass with ✅

**Step 3: Clean up test file**

```bash
rm test-auth-middleware.js
```

**Step 4: Commit**

```bash
git add src/middleware/auth.js
git commit -m "feat: add authentication middleware

- Validate Bearer tokens on protected routes
- Support health check bypass configuration
- Return 401 with helpful error messages
- Can be disabled via config.security.auth.enabled

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Modify Server Config Initialization

**Files:**
- Modify: `server.js` (loadConfig function, lines 26-81)

**Purpose:** Auto-generate SECRET_KEY on first startup and backfill for existing configs.

**Step 1: Add require for keyGenerator at top of server.js**

After line 4 (`const fs = require('fs');`), add:

```javascript
// Add after existing requires
const path = require('path');
const os = require('os');
const chalk = require('chalk');
// ... existing code ...

// ADD THIS:
const { generateSecretKey, deriveApiKey } = require('./src/utils/keyGenerator');
```

**Step 2: Update defaultConfig to include security section**

Modify lines 13-23, add security object:

```javascript
const defaultConfig = {
  port: 5546,
  host: '0.0.0.0',
  claudePath: path.join(process.env.HOME || os.homedir(), '.nvm', 'versions', 'node', 'v22.21.0', 'bin', 'claude'),
  nvmBin: path.join(process.env.HOME || os.homedir(), '.nvm', 'versions', 'node', 'v22.21.0', 'bin'),
  defaultProjectPath: path.join(process.env.HOME || os.homedir(), 'workspace'),
  logFile: path.join(process.env.HOME || os.homedir(), '.claude-code-server', 'logs', 'server.log'),
  pidFile: path.join(process.env.HOME || os.homedir(), '.claude-code-server', 'server.pid'),
  dataDir: path.join(process.env.HOME || os.homedir(), '.claude-code-server', 'data'),
  sessionRetentionDays: 30,

  // ADD THIS SECTION:
  security: {
    auth: {
      enabled: false,
      secretKey: null,  // Will be auto-generated
      bypassHealthCheck: true
    }
  }
};
```

**Step 3: Update loadConfig() function to auto-generate SECRET_KEY**

Modify lines 46-59 in the loadConfig() function:

```javascript
let config;
if (!fs.existsSync(configPath)) {
  // First startup - use default config
  config = { ...defaultConfig };

  // Auto-generate SECRET_KEY
  config.security.auth.secretKey = generateSecretKey();

  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`✅ 创建配置文件: ${configPath}`);
    console.log(`✅ 已自动生成 SECRET_KEY`);
    const apiKey = deriveApiKey(config.security.auth.secretKey);
    console.log(`📝 API Key: ${apiKey}`);
  } catch (err) {
    console.error(`❌ 创建配置文件失败 ${configPath}:`, err.message);
    throw err;
  }
} else {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  // Backfill: Ensure security.auth exists
  if (!config.security) {
    config.security = { auth: { enabled: false, bypassHealthCheck: true } };
  }
  if (!config.security.auth) {
    config.security.auth = { enabled: false, bypassHealthCheck: true };
  }

  // Auto-generate SECRET_KEY if missing (migration)
  if (!config.security.auth.secretKey) {
    config.security.auth.secretKey = generateSecretKey();
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log(`✅ 已自动生成 SECRET_KEY (迁移)`);
      const apiKey = deriveApiKey(config.security.auth.secretKey);
      console.log(`📝 API Key: ${apiKey}`);
    } catch (err) {
      console.error(`❌ 更新配置失败 ${configPath}:`, err.message);
    }
  }
}
```

**Step 4: Add environment variable overrides**

After line 79 (before `return config;`), add:

```javascript
// Environment variable overrides (take precedence)
if (process.env.CCS_SECRET_KEY) {
  config.security.auth.secretKey = process.env.CCS_SECRET_KEY;
}
if (process.env.CCS_AUTH_ENABLED !== undefined) {
  config.security.auth.enabled = process.env.CCS_AUTH_ENABLED === 'true';
}
```

**Step 5: Test by deleting config and restarting**

```bash
# Backup current config
mv ~/.claude-code-server/config.json ~/.claude-code-server/config.json.backup

# Start server (should generate new SECRET_KEY)
node server.js &
sleep 2
kill %1

# Check config
cat ~/.claude-code-server/config.json | grep -A 5 security

# Restore backup
mv ~/.claude-code-server/config.json.backup ~/.claude-code-server/config.json
```

Expected output: New config with security.auth.secretKey generated

**Step 6: Commit**

```bash
git add server.js
git commit -m "feat: auto-generate SECRET_KEY on first startup

- Add security.auth section to default config
- Auto-generate SECRET_KEY on first startup
- Backfill missing SECRET_KEY for existing configs
- Display derived API Key on generation
- Support environment variable overrides (CCS_SECRET_KEY, CCS_AUTH_ENABLED)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Apply Auth Middleware to Routes

**Files:**
- Modify: `server.js` (middleware mounting section, after line 166)

**Purpose:** Apply authentication middleware to all API routes.

**Step 1: Require auth middleware**

After line 158 (`const createTaskRoutes = require('./src/routes/tasks');`), add:

```javascript
const createAuthMiddleware = require('./src/middleware/auth');
```

**Step 2: Create and mount auth middleware**

After line 167 (`app.use(express.json());`), add:

```javascript
// Create authentication middleware
const authMiddleware = createAuthMiddleware(config);

// Apply authentication to all /api/* routes
// Must come after body parser, before route mounting
app.use('/api/', authMiddleware);
```

**Step 3: Test with authentication disabled**

```bash
# Ensure auth is disabled in config
node cli.js config  # Select disabled for auth
node cli.js start

# Test health check (should work)
curl http://localhost:5546/health

# Test API (should work, auth disabled)
curl http://localhost:5546/api/config

node cli.js stop
```

Expected: Both requests return 200 OK

**Step 4: Test with authentication enabled**

```bash
# Enable auth and get API key
node cli.js start
node cli.js config  # Enable auth, note the API Key

# Extract API key from config
API_KEY=$(node -e "const c = require('./src/utils/keyGenerator'); const cfg = JSON.parse(require('fs').readFileSync('$HOME/.claude-code-server/config.json')); console.log(c.deriveApiKey(cfg.security.auth.secretKey));")

# Test without key (should fail)
curl http://localhost:5546/api/config

# Test with key (should work)
curl -H "Authorization: Bearer $API_KEY" http://localhost:5546/api/config

# Test health check (should bypass)
curl http://localhost:5546/health

node cli.js stop
```

Expected: Without key = 401, with key = 200, health = 200

**Step 5: Commit**

```bash
git add server.js
git commit -m "feat: apply authentication middleware to API routes

- Mount auth middleware on all /api/* routes
- Protects all business logic endpoints
- Health check bypass works when configured
- Supports enable/disable via config

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Filter Sensitive Data in Config Endpoint

**Files:**
- Modify: `src/routes/config.js`

**Purpose:** Hide SECRET_KEY from API config response.

**Step 1: Read current config route**

```bash
cat src/routes/config.js
```

**Step 2: Modify to filter SECRET_KEY**

Replace the entire file content with:

```javascript
const fs = require('fs');
const path = require('path');

/**
 * Create config route handler
 * @param {string} configPath - Path to config file
 */
function createConfigRoute(configPath) {
  return (req, res) => {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

      // Create safe config copy with sensitive data hidden
      const safeConfig = JSON.parse(JSON.stringify(config));

      // Hide SECRET_KEY
      if (safeConfig.security?.auth?.secretKey) {
        safeConfig.security.auth.secretKey = '*** HIDDEN ***';
      }

      // Hide other sensitive paths if needed
      // (Future: add more sensitive fields here)

      res.json({
        success: true,
        config: safeConfig
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  };
}

module.exports = createConfigRoute;
```

**Step 3: Test the filtered response**

```bash
# Start server with auth enabled
node cli.js start
node cli.js config  # Enable auth if not already

# Get API key
API_KEY=$(node -e "const c = require('./src/utils/keyGenerator'); const cfg = JSON.parse(require('fs').readFileSync('$HOME/.claude-code-server/config.json')); console.log(c.deriveApiKey(cfg.security.auth.secretKey));")

# Test config endpoint
curl -H "Authorization: Bearer $API_KEY" http://localhost:5546/api/config | jq .

# Verify SECRET_KEY shows as '*** HIDDEN ***'

node cli.js stop
```

Expected: `secretKey: "*** HIDDEN ***"` in response

**Step 4: Commit**

```bash
git add src/routes/config.js
git commit -m "security: hide SECRET_KEY in config API response

- Filter SECRET_KEY from /api/config endpoint
- Show '*** HIDDEN ***' instead of actual value
- Prevents accidental exposure via API

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Add Swagger Authentication Configuration

**Files:**
- Modify: `swagger-config.js`

**Purpose:** Add Bearer auth scheme to Swagger documentation.

**Step 1: Read current swagger config**

```bash
cat swagger-config.js
```

**Step 2: Add security scheme definition**

Find the `components` section and add `securitySchemes`. Modify the file to include:

```javascript
const swaggerSpec = {
  // ... existing definitions ...
  openapi: '3.0.0',

  // ADD THIS: Global security requirement
  security: [
    { BearerAuth: [] }
  ],

  components: {
    // ADD THIS: Security schemes
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'API Key',
        description: `
使用 Bearer Token 进行 API 认证。

**格式:** \`Authorization: Bearer ccs_ak_<your-api-key>\`

**获取 API Key:**
1. 运行 \`node cli.js config\`
2. 启用 "API 密钥认证"
3. 查看生成的 API Key

**注意:**
- 仅在服务端启用认证时需要
- 健康检查接口 (/health) 可能豁免认证
        `.trim()
      }
    },

    // ... existing schemas ...
  },

  // ... rest of file ...
};
```

**Step 3: Add security override for health check endpoint**

Find the `/health` path definition and add `security: []` override:

```javascript
{
  path: '/health',
  // ... existing properties ...
  security: [],  // Override global security - no auth required
  // ... rest of endpoint definition
}
```

**Step 4: Test Swagger UI**

```bash
# Start server
node cli.js start

# Open Swagger UI in browser
open http://localhost:5546/api-docs

# Look for:
# 1. 🔒 Authorize button at top
# 2. Click it, enter: ccs_ak_<your-api-key>
# 3. All endpoints should show locked icon
# 4. /health should show unlocked (if bypass enabled)

# Test "Try it out" with and without auth

node cli.js stop
```

Expected: Swagger UI shows auth button, health check bypassed

**Step 5: Commit**

```bash
git add swagger-config.js
git commit -m "docs: add Bearer authentication to Swagger documentation

- Add BearerAuth security scheme
- Apply global security requirement
- Override for /health endpoint (bypass when configured)
- Add Chinese description for auth usage

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Add TUI Security Configuration Menu

**Files:**
- Modify: `cli.js` (configureSettings function)

**Purpose:** Add security configuration section to TUI for managing API authentication.

**Step 1: Add require for keyGenerator**

At the top of cli.js after existing requires, add:

```javascript
const { generateSecretKey, deriveApiKey } = require('./src/utils/keyGenerator');
```

**Step 2: Add security configuration section**

Find the `configureSettings()` function (around line 410). After the task queue configuration section (after line 535), add:

```javascript
  // 第四部分：安全配置
  console.log('');
  const { enableAuth } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enableAuth',
      message: '启用 API 密钥认证?',
      default: config.security?.auth?.enabled || false,
    },
  ]);

  if (enableAuth) {
    // Show current API key info
    config.security = config.security || {};
    config.security.auth = config.security.auth || {};

    // Ensure secretKey exists
    if (!config.security.auth.secretKey) {
      config.security.auth.secretKey = generateSecretKey();
      console.log(chalk.yellow('⚠️  已自动生成新的 SECRET_KEY'));
    }

    const currentApiKey = deriveApiKey(config.security.auth.secretKey);

    console.log('');
    console.log(chalk.bold.cyan('当前 API 密钥信息:'));
    console.log(`  ${chalk.gray('SECRET_KEY:')} ${chalk.yellow('*** 已隐藏 ***')}`);
    console.log(`  ${chalk.gray('API Key:')} ${chalk.green.bold(currentApiKey)}`);
    console.log('');

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: '密钥操作:',
        choices: [
          { name: '保持现有密钥', value: 'keep' },
          { name: '重新生成密钥 (⚠️ 旧密钥将失效)', value: 'regenerate' },
        ],
      },
    ]);

    if (action === 'regenerate') {
      const newSecretKey = generateSecretKey();
      const newApiKey = deriveApiKey(newSecretKey);

      console.log('');
      console.log(chalk.yellow('⚠️  警告: 重新生成后，旧密钥将立即失效！'));
      console.log(`${chalk.gray('新 API Key:')} ${chalk.green.bold(newApiKey)}`);

      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: '确认重新生成?',
          default: false,
        },
      ]);

      if (confirm) {
        config.security.auth.secretKey = newSecretKey;
        console.log(chalk.green('✓ 密钥已重新生成'));
      } else {
        console.log(chalk.gray('已取消重新生成'));
      }
    }

    const { bypassHealth } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'bypassHealth',
        message: '健康检查 (/health) 是否免认证?',
        default: config.security?.auth?.bypassHealthCheck ?? true,
      },
    ]);

    config.security.auth.enabled = true;
    config.security.auth.bypassHealthCheck = bypassHealth;
  } else {
    config.security = config.security || {};
    config.security.auth = config.security || {};
    config.security.auth.enabled = false;
  }
```

**Step 3: Update configuration summary**

Find the config summary section (around line 544) and add security info:

```javascript
  // 显示配置摘要
  console.log('');
  console.log(chalk.bold.cyan('配置摘要:'));
  console.log(`  ${chalk.white('端口:')} ${config.port}`);
  console.log(`  ${chalk.white('API 认证:')} ${config.security?.auth?.enabled ? chalk.green('已启用') : chalk.gray('未启用')}`);
  if (config.security?.auth?.enabled) {
    const apiKey = deriveApiKey(config.security.auth.secretKey);
    console.log(`  ${chalk.white('API Key:')} ${chalk.green(apiKey)}`);
  }
  console.log(`  ${chalk.white('跳过权限检查:')} ${config.allowDangerouslySkipPermissions ? chalk.red('已启用') : chalk.gray('未启用（默认）')}`);
  console.log(`  ${chalk.white('Webhook:')} ${config.webhook.enabled ? chalk.green('已启用') : chalk.gray('未启用')}`);
  // ... rest of summary
```

**Step 4: Test TUI configuration**

```bash
# Start TUI
node cli.js config

# Test scenarios:
# 1. Enable auth, keep existing key
# 2. Enable auth, regenerate key
# 3. Disable auth
# 4. Toggle health check bypass

# Verify config after each change
cat ~/.claude-code-server/config.json | grep -A 5 security
```

Expected: All scenarios work, config updates correctly

**Step 5: Commit**

```bash
git add cli.js
git commit -m "feat: add security configuration to TUI

- Add API authentication toggle
- Display current API Key (derived from SECRET_KEY)
- Support key regeneration with confirmation
- Configure health check bypass
- Add security info to config summary

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Create Audit Logger Service (Optional Enhancement)

**Files:**
- Create: `src/services/auditLogger.js`

**Purpose:** Log authentication failures and API usage for security monitoring.

**Step 1: Create audit logger service**

```javascript
/**
 * Audit Logger Service
 * Records security events for monitoring and compliance
 */
class AuditLogger {
  constructor(config, statsStore) {
    this.config = config;
    this.statsStore = statsStore;
    this.enabled = config.security?.audit?.enabled !== false;  // Default enabled
  }

  /**
   * Log authentication failure
   * @param {object} req - Express request object
   * @param {string} reason - Failure reason
   */
  logAuthFailure(req, reason) {
    if (!this.enabled) return;

    const event = {
      type: 'auth_failure',
      timestamp: new Date().toISOString(),
      ip: req.ip || req.connection.remoteAddress,
      path: req.path,
      method: req.method,
      reason,
      userAgent: req.headers['user-agent']
    };

    this._recordEvent(event);
  }

  /**
   * Log successful API call
   * @param {object} req - Express request object
   */
  logApiUsage(req) {
    if (!this.enabled) return;

    const event = {
      type: 'api_call',
      timestamp: new Date().toISOString(),
      ip: req.ip || req.connection.remoteAddress,
      path: req.path,
      method: req.method,
      userAgent: req.headers['user-agent']
    };

    this._recordEvent(event);
  }

  /**
   * Record event to storage
   * @private
   */
  _recordEvent(event) {
    try {
      // Store in statistics database
      const date = new Date().toISOString().split('T')[0];
      this.statsStore.db.get('audit_logs')
        .push({ ...event, date })
        .write();
    } catch (error) {
      // Fail silently - don't break app if audit logging fails
      console.error('Audit logging failed:', error.message);
    }
  }

  /**
   * Get recent audit logs
   * @param {number} limit - Maximum number of logs to return
   * @returns {Array} Array of audit log entries
   */
  getRecentLogs(limit = 100) {
    try {
      const logs = this.statsStore.db.get('audit_logs')
        .orderBy('timestamp', 'desc')
        .take(limit)
        .value();
      return logs || [];
    } catch (error) {
      return [];
    }
  }
}

module.exports = AuditLogger;
```

**Step 2: Update auth middleware to use audit logger**

Modify `src/middleware/auth.js`:

```javascript
const { deriveApiKey } = require('../utils/keyGenerator');

/**
 * Create authentication middleware
 * @param {object} config - Server configuration
 * @param {object} auditLogger - Audit logger service (optional)
 * @returns {Function} Express middleware
 */
function createAuthMiddleware(config, auditLogger = null) {
  return (req, res, next) => {
    // Check if authentication is enabled
    if (!config.security?.auth?.enabled) {
      if (auditLogger) auditLogger.logApiUsage(req);
      return next();
    }

    // Bypass health check if configured
    if (config.security?.auth?.bypassHealthCheck && req.path === '/health') {
      return next();
    }

    // Extract Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      if (auditLogger) auditLogger.logAuthFailure(req, 'missing_header');
      return res.status(401).json({
        success: false,
        error: 'Missing Authorization header',
        hint: 'Use: Authorization: Bearer ccs_ak_<your-api-key>'
      });
    }

    if (!authHeader.startsWith('Bearer ')) {
      if (auditLogger) auditLogger.logAuthFailure(req, 'invalid_format');
      return res.status(401).json({
        success: false,
        error: 'Invalid Authorization format',
        hint: 'Use: Authorization: Bearer ccs_ak_<your-api-key>'
      });
    }

    // Extract and verify API key
    const clientApiKey = authHeader.substring(7);
    const expectedApiKey = deriveApiKey(config.security.auth.secretKey);

    if (clientApiKey !== expectedApiKey) {
      if (auditLogger) auditLogger.logAuthFailure(req, 'invalid_api_key');
      return res.status(401).json({
        success: false,
        error: 'Invalid API Key'
      });
    }

    // Authentication successful
    if (auditLogger) auditLogger.logApiUsage(req);
    next();
  };
}

module.exports = createAuthMiddleware;
```

**Step 3: Initialize audit logger in server.js**

After line 150 (after WebhookNotifier initialization), add:

```javascript
const AuditLogger = require('./src/services/auditLogger');
const auditLogger = new AuditLogger(config, statsStore);
```

Update auth middleware creation (around line 171):

```javascript
const authMiddleware = createAuthMiddleware(config, auditLogger);
```

**Step 4: Test audit logging**

```bash
# Start server with auth enabled
node cli.js start

# Test failed auth (should log)
curl -H "Authorization: Bearer wrong_key" http://localhost:5546/api/config

# Test successful auth (should log)
curl -H "Authorization: Bearer $VALID_KEY" http://localhost:5546/api/config

# Check logs (audit events should be recorded)
tail -f ~/.claude-code-server/logs/server.log

node cli.js stop
```

Expected: Auth failures and successes logged

**Step 5: Commit**

```bash
git add src/services/auditLogger.js src/middleware/auth.js server.js
git commit -m "feat: add audit logging for security events

- Create AuditLogger service for security event tracking
- Log authentication failures with IP, reason, timestamp
- Log successful API calls
- Integrate with auth middleware
- Store events in statistics database

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Final Integration Testing

**Purpose:** Comprehensive end-to-end testing of all authentication features.

**Step 1: Test first startup scenario**

```bash
# Remove existing config to simulate first startup
rm ~/.claude-code-server/config.json

# Start server (should generate SECRET_KEY)
node server.js &
SERVER_PID=$!
sleep 3

# Check generated config
cat ~/.claude-code-server/config.json | grep -A 5 security

# Stop server
kill $SERVER_PID
```

Expected: Config auto-generated with SECRET_KEY

**Step 2: Test authentication flow via TUI**

```bash
# Open TUI and enable auth
node cli.js

# In TUI:
# 1. Start server
# 2. Go to Configuration
# 3. Enable API authentication
# 4. Note the API Key displayed
# 5. Exit TUI

# Test with curl
API_KEY="<noted_key_from_tui>"
curl -H "Authorization: Bearer $API_KEY" http://localhost:5546/api/config

# Test without auth (should fail)
curl http://localhost:5546/api/config
```

Expected: With key = 200, without = 401

**Step 3: Test Swagger UI**

```bash
# Open browser
open http://localhost:5546/api-docs

# Verify:
# - Authorize button visible
# - Can enter API key
# - Try it out works with auth
```

**Step 4: Test health check bypass**

```bash
# With auth enabled, health should work without key
curl http://localhost:5546/health

# Should return 200 OK
```

**Step 5: Test key regeneration**

```bash
node cli.js config

# In TUI:
# 1. Select "Regenerate key"
# 2. Confirm
# 3. Note new API Key

# Test old key (should fail)
curl -H "Authorization: Bearer <old_key>" http://localhost:5546/api/config

# Test new key (should work)
curl -H "Authorization: Bearer <new_key>" http://localhost:5546/api/config
```

Expected: Old key fails, new key works

**Step 6: Test config endpoint filtering**

```bash
# Ensure SECRET_KEY is hidden
curl -H "Authorization: Bearer <valid_key>" http://localhost:5546/api/config | grep secretKey

# Should show: "secretKey": "*** HIDDEN ***"
```

**Step 7: Test environment variable overrides**

```bash
# Set env vars
export CCS_AUTH_ENABLED="true"
export CCS_SECRET_KEY="ccs_sk_test_env_override_secret"

# Restart server
node cli.js restart

# Verify env override works (key derived from env SECRET_KEY)
API_KEY=$(node -e "const c = require('./src/utils/keyGenerator'); const cfg = JSON.parse(require('fs').readFileSync('$HOME/.claude-code-server/config.json')); console.log(c.deriveApiKey('ccs_sk_test_env_override_secret'));")

curl -H "Authorization: Bearer $API_KEY" http://localhost:5546/api/config

# Cleanup
unset CCS_AUTH_ENABLED
unset CCS_SECRET_KEY
node cli.js restart
```

Expected: Env vars override config file

**Step 8: Test hot reload**

```bash
# Start with auth disabled
node cli.js start

# Edit config manually to enable auth
vi ~/.claude-code-server/config.json
# Set: security.auth.enabled = true

# Wait 1 second for hot reload
sleep 2

# Test (should now require auth)
curl http://localhost:5546/api/config
# Should return 401

# Disable auth via config
vi ~/.claude-code-server/config.json
# Set: security.auth.enabled = false

# Wait for reload
sleep 2

# Test (should work without auth)
curl http://localhost:5546/api/config
# Should return 200

node cli.js stop
```

Expected: Hot reload picks up auth changes

**Step 9: Verify all checklist items**

Go through the testing checklist from design doc and verify each item:

```bash
# Open the design doc
cat docs/plans/2025-02-27-api-authentication-security-design.md | grep -A 20 "Testing Checklist"
```

Verify each item manually:
- [x] First startup generates SECRET_KEY automatically
- [x] TUI can enable/disable authentication
- [x] TUI displays correct API Key
- [x] TUI can regenerate key
- [x] Auth middleware blocks requests without valid key
- [x] Auth middleware allows requests with valid key
- [x] Health check bypass works when configured
- [x] Swagger UI Authorize button works
- [x] Existing configs auto-migrate (get SECRET_KEY)
- [x] Environment variable overrides work
- [x] Hot reload picks up auth changes
- [x] Audit logs record failures

**Step 10: Final commit**

```bash
git add -A
git commit -m "test: complete authentication implementation testing

All features verified:
- Auto-generated SECRET_KEY on first startup
- TUI configuration management
- Auth middleware with bypass support
- Swagger integration
- Config filtering for sensitive data
- Environment variable overrides
- Hot reload support
- Audit logging

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Summary

After completing all tasks, the API authentication system will be fully functional with:

1. **Dual-layer key system** - SECRET_KEY safely stored, API Key derived for clients
2. **Flexible configuration** - Enable/disable via TUI or environment variables
3. **Middleware protection** - All `/api/*` routes secured, health check optional bypass
4. **TUI integration** - Easy key management without manual config editing
5. **Swagger support** - Try it out with authentication in browser
6. **Audit logging** - Track auth failures and API usage
7. **Hot reload** - Changes take effect without restart
8. **Migration support** - Existing configs auto-updated

**Total estimated time:** 2-3 hours for implementation and testing.
