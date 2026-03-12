/**
 * Provider environment variable injection utilities
 * Used by ClaudeExecutor and ClaudeStreamExecutor for load balancing
 */

/**
 * Default failure threshold for health tracking
 * @constant {number}
 */
const DEFAULT_FAILURE_THRESHOLD = 3;

/**
 * Inject provider environment variables into the process environment
 *
 * @param {Object} env - The environment object to inject into (will be mutated)
 * @param {Object} provider - The provider configuration object
 * @param {string} provider.id - Provider unique identifier
 * @param {string} provider.name - Provider display name
 * @param {string} [provider.apiKey] - API key/token for authentication
 * @param {string} [provider.baseUrl] - Base URL for API requests
 * @param {Object} [provider.env] - Additional custom environment variables
 * @returns {Object} The modified environment object
 *
 * @example
 * const env = { ...process.env };
 * injectProviderEnv(env, {
 *   id: 'provider-1',
 *   name: 'Main Provider',
 *   apiKey: 'sk-xxx',
 *   baseUrl: 'https://api.example.com'
 * });
 */
function injectProviderEnv(env, provider) {
  if (!provider) {
    return env;
  }

  if (provider.apiKey) {
    // Claude CLI uses ANTHROPIC_AUTH_TOKEN, not ANTHROPIC_API_KEY
    // Set both for compatibility with different tools
    env.ANTHROPIC_AUTH_TOKEN = provider.apiKey;
    env.ANTHROPIC_API_KEY = provider.apiKey;
  }

  if (provider.baseUrl) {
    env.ANTHROPIC_BASE_URL = provider.baseUrl;
  }

  // Inject additional custom environment variables from provider.env
  if (provider.env && typeof provider.env === 'object') {
    for (const [key, value] of Object.entries(provider.env)) {
      if (value !== undefined && value !== null) {
        env[key] = String(value);
      }
    }
  }

  return env;
}

/**
 * Create a log-safe provider info object (removes sensitive data)
 *
 * @param {Object} provider - The provider configuration object
 * @returns {Object} Safe provider info for logging
 *
 * @example
 * const safeInfo = getSafeProviderInfo(provider);
 * logger.info('Provider selected', safeInfo);
 * // Output: { provider_id: 'p1', provider_name: 'P1', has_apiKey: true, has_baseUrl: false }
 */
function getSafeProviderInfo(provider) {
  if (!provider) {
    return null;
  }

  return {
    provider_id: provider.id,
    provider_name: provider.name,
    has_apiKey: !!provider.apiKey,
    // Never log sensitive information like apiKey_prefix
    has_baseUrl: !!provider.baseUrl,
    baseUrl: provider.baseUrl,
    has_custom_env: !!(provider.env && Object.keys(provider.env).length > 0),
  };
}

/**
 * Get environment variable status for logging (safe, no sensitive data)
 *
 * @param {Object} env - The environment object
 * @returns {Object} Safe env status for logging
 */
function getEnvStatus(env) {
  return {
    ANTHROPIC_AUTH_TOKEN_set: !!env.ANTHROPIC_AUTH_TOKEN,
    ANTHROPIC_API_KEY_set: !!env.ANTHROPIC_API_KEY,
    ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
  };
}

module.exports = {
  DEFAULT_FAILURE_THRESHOLD,
  injectProviderEnv,
  getSafeProviderInfo,
  getEnvStatus,
};
