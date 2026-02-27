const crypto = require('crypto');
const { deriveApiKey } = require('../utils/keyGenerator');

/**
 * Creates Express middleware for API key authentication
 *
 * Features:
 * - Bearer token validation using constant-time comparison
 * - API key format validation (ccs_ak_<base64url>)
 * - Configurable health check bypass
 * - Can be disabled via config.security.auth.enabled
 * - Audit logging for auth failures and successful API calls
 *
 * @param {Object} config - Server configuration object
 * @param {Object} config.security - Security configuration
 * @param {Object} config.security.auth - Authentication configuration
 * @param {boolean} config.security.auth.enabled - Whether authentication is enabled
 * @param {string} config.security.auth.secretKey - Secret key for deriving API keys
 * @param {boolean} config.security.auth.bypassHealthCheck - Whether to bypass auth for /health endpoint
 * @param {Object} auditLogger - Audit logger service instance (optional)
 * @returns {Function} Express middleware function
 */
function createAuthMiddleware(config, auditLogger = null) {
  return (req, res, next) => {
    // Check if authentication is enabled
    if (!config.security?.auth?.enabled) {
      return next();
    }

    // Validate that secretKey exists
    if (!config.security.auth.secretKey) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: Missing secret key'
      });
    }

    // Bypass health check if configured
    if (config.security?.auth?.bypassHealthCheck && req.path === '/health') {
      return next();
    }

    // Extract Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      if (auditLogger) {
        auditLogger.logAuthFailure(req, 'missing_header');
      }
      res.setHeader('WWW-Authenticate', 'Bearer');
      return res.status(401).json({
        success: false,
        error: 'Missing Authorization header',
        hint: 'Use: Authorization: Bearer ccs_ak_<your-api-key>'
      });
    }

    if (!authHeader.startsWith('Bearer ')) {
      if (auditLogger) {
        auditLogger.logAuthFailure(req, 'invalid_format');
      }
      res.setHeader('WWW-Authenticate', 'Bearer');
      return res.status(401).json({
        success: false,
        error: 'Invalid Authorization format',
        hint: 'Use: Authorization: Bearer ccs_ak_<your-api-key>'
      });
    }

    // Extract API key
    const clientApiKey = authHeader.substring(7);

    // Validate API key format (ccs_ak_<base64url>)
    if (!clientApiKey.startsWith('ccs_ak_')) {
      if (auditLogger) {
        auditLogger.logAuthFailure(req, 'invalid_format');
      }
      res.setHeader('WWW-Authenticate', 'Bearer');
      return res.status(401).json({
        success: false,
        error: 'Invalid API Key format',
        hint: 'API key must start with "ccs_ak_"'
      });
    }

    // Derive expected API key
    const expectedApiKey = deriveApiKey(config.security.auth.secretKey);

    // Use constant-time comparison to prevent timing attacks
    // Both keys are strings, so we need to use Buffer
    try {
      const clientKeyBuffer = Buffer.from(clientApiKey, 'utf-8');
      const expectedKeyBuffer = Buffer.from(expectedApiKey, 'utf-8');

      // Ensure buffers are same length before comparison
      if (clientKeyBuffer.length !== expectedKeyBuffer.length) {
        if (auditLogger) {
          auditLogger.logAuthFailure(req, 'invalid_api_key');
        }
        res.setHeader('WWW-Authenticate', 'Bearer');
        return res.status(401).json({
          success: false,
          error: 'Invalid API Key'
        });
      }

      // Constant-time comparison
      if (!crypto.timingSafeEqual(clientKeyBuffer, expectedKeyBuffer)) {
        if (auditLogger) {
          auditLogger.logAuthFailure(req, 'invalid_api_key');
        }
        res.setHeader('WWW-Authenticate', 'Bearer');
        return res.status(401).json({
          success: false,
          error: 'Invalid API Key'
        });
      }
    } catch (error) {
      // If comparison fails for any reason, reject the request
      if (auditLogger) {
        auditLogger.logAuthFailure(req, 'invalid_api_key');
      }
      res.setHeader('WWW-Authenticate', 'Bearer');
      return res.status(401).json({
        success: false,
        error: 'Invalid API Key'
      });
    }

    // Authentication successful - log API usage
    if (auditLogger) {
      auditLogger.logApiUsage(req);
    }

    next();
  };
}

module.exports = createAuthMiddleware;
