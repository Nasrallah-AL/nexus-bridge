const { DEFAULT_FAILURE_THRESHOLD } = require('../utils/providerEnv');
const ProviderSettingsManager = require('./providerSettingsManager');

/**
 * Provider Router for Load Balancing
 *
 * Manages provider selection with support for:
 * - Round-robin and weighted load balancing strategies
 * - Session affinity (sticky sessions)
 * - Health tracking and automatic failover
 * - Hot configuration reload
 *
 * @class ProviderRouter
 * @example
 * const router = new ProviderRouter({
 *   providers: [
 *     { id: 'p1', name: 'Provider 1', apiKey: 'key1', weight: 2, enabled: true },
 *     { id: 'p2', name: 'Provider 2', apiKey: 'key2', weight: 1, enabled: true },
 *   ],
 *   loadBalance: {
 *     strategy: 'weighted',
 *     failover: true,
 *     failureThreshold: 3,
 *     bindingTtl: 1800000, // 30 minutes
 *   },
 * });
 *
 * // Select provider for a session
 * const provider = router.select('session-123');
 *
 * // Record result for health tracking
 * router.recordSuccess(provider.id);
 * // or
 * router.recordFailure(provider.id);
 */
class ProviderRouter {
  /**
   * Default TTL for session bindings (30 minutes)
   * @static
   * @type {number}
   */
  static DEFAULT_BINDING_TTL = 30 * 60 * 1000;

  /**
   * Default interval for cleanup of stale bindings (5 minutes)
   * @static
   * @type {number}
   */
  static DEFAULT_CLEANUP_INTERVAL = 5 * 60 * 1000;

  /**
   * Create a new ProviderRouter instance
   *
   * @constructor
   * @param {Object} config - Configuration object
   * @param {Array<Object>} [config.providers=[]] - Array of provider configurations
   * @param {string} config.providers[].id - Unique provider identifier
   * @param {string} config.providers[].name - Display name for the provider
   * @param {string} [config.providers[].apiKey] - API key/token for authentication
   * @param {string} [config.providers[].baseUrl] - Base URL for API requests
   * @param {number} [config.providers[].weight=1] - Weight for weighted load balancing
   * @param {boolean} [config.providers[].enabled=true] - Whether provider is enabled
   * @param {Object} [config.providers[].env] - Custom environment variables
   * @param {Object} [config.loadBalance={}] - Load balancing configuration
   * @param {string} [config.loadBalance.strategy='round-robin'] - Strategy: 'round-robin' or 'weighted'
   * @param {boolean} [config.loadBalance.failover=false] - Enable automatic failover on unhealthy provider
   * @param {number} [config.loadBalance.failureThreshold=3] - Consecutive failures to mark unhealthy
   * @param {number} [config.loadBalance.bindingTtl=1800000] - TTL for session bindings (ms)
   */
  constructor(config) {
    this._allProviders = config.providers || [];
    this.providers = this._allProviders.filter(p => p.enabled !== false);
    this.loadBalance = config.loadBalance || {};
    this.strategy = this.loadBalance.strategy || 'round-robin';

    /**
     * Session affinity map: sessionId -> { providerId, boundAt }
     * @type {Map<string, {providerId: string, boundAt: number}>}
     */
    this.bindings = new Map();

    /**
     * Binding TTL in milliseconds
     * @type {number}
     */
    this.bindingTtl = this.loadBalance.bindingTtl || ProviderRouter.DEFAULT_BINDING_TTL;

    /**
     * Round-robin index for sequential selection
     * @private
     * @type {number}
     */
    this._rrIndex = 0;

    /**
     * Health state map: providerId -> health info
     * @type {Map<string, {healthy: boolean, consecutiveFailures: number, lastFailAt: number|null, totalRequests: number}>}
     */
    this.healthState = new Map();
    for (const p of this.providers) {
      this.healthState.set(p.id, {
        healthy: true,
        consecutiveFailures: 0,
        lastFailAt: null,
        totalRequests: 0,
      });
    }

    // Initialize Provider Settings Manager
    this.settingsManager = new ProviderSettingsManager(config);

    // Initialize settings files for all configured providers
    this.settingsManager.initializeFromConfig(this.providers);

    // Start periodic cleanup of stale bindings
    this._startCleanupTimer();
  }

  /**
   * Get Provider Settings Manager instance
   * Used for managing provider settings files and project symlinks
   *
   * @returns {ProviderSettingsManager} Settings manager instance
   */
  getSettingsManager() {
    return this.settingsManager;
  }

  /**
   * Update configuration (for hot reload)
   * Properly reinitializes internal state instead of using Object.assign
   *
   * @param {Object} config - New configuration object (same format as constructor)
   * @returns {void}
   */
  updateConfig(config) {
    this._allProviders = config.providers || [];
    this.providers = this._allProviders.filter(p => p.enabled !== false);
    this.loadBalance = config.loadBalance || {};
    this.strategy = this.loadBalance.strategy || 'round-robin';
    this.bindingTtl = this.loadBalance.bindingTtl || ProviderRouter.DEFAULT_BINDING_TTL;

    // Rebuild health state, preserving existing data where possible
    const newHealthState = new Map();
    for (const p of this.providers) {
      const existing = this.healthState.get(p.id);
      newHealthState.set(p.id, existing || {
        healthy: true,
        consecutiveFailures: 0,
        lastFailAt: null,
        totalRequests: 0,
      });
    }
    this.healthState = newHealthState;

    // Clear bindings that point to removed providers
    for (const [sessionId, binding] of this.bindings) {
      if (!this.providers.find(p => p.id === binding.providerId)) {
        this.bindings.delete(sessionId);
      }
    }

    // Rebuild weighted slots
    this._rebuildSlots();
  }

  /**
   * Start periodic cleanup timer for stale bindings
   * @private
   * @returns {void}
   */
  _startCleanupTimer() {
    this._cleanupTimer = setInterval(() => {
      this._cleanupStaleBindings();
    }, ProviderRouter.DEFAULT_CLEANUP_INTERVAL);

    // Don't prevent the process from exiting
    if (this._cleanupTimer.unref) {
      this._cleanupTimer.unref();
    }
  }

  /**
   * Clean up bindings that have exceeded TTL
   * @private
   * @returns {void}
   */
  _cleanupStaleBindings() {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, binding] of this.bindings) {
      if (now - binding.boundAt > this.bindingTtl) {
        this.bindings.delete(sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.debug(`[ProviderRouter] Cleaned up ${cleaned} stale bindings`);
    }
  }

  /**
   * Stop cleanup timer (for graceful shutdown)
   *
   * @returns {void}
   */
  stopCleanup() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
  }

  /**
   * Get next index for round-robin selection
   * Thread-safe in Node.js single-threaded environment
   * @private
   * @param {number} max - Maximum value (exclusive)
   * @returns {number} Index in range [0, max)
   */
  _getNextIndex(max) {
    const idx = this._rrIndex % max;
    this._rrIndex++;
    return idx;
  }

  /**
   * Select a provider for the given session
   *
   * Implements session affinity - the same sessionId will always return
   * the same provider (unless failover is enabled and the provider becomes unhealthy).
   *
   * @param {string} sessionId - Unique session identifier
   * @returns {Object|null} Provider configuration object, or null if no providers available
   *
   * @example
   * const provider = router.select('session-123');
   * if (provider) {
   *   console.log(`Selected provider: ${provider.name}`);
   *   // Use provider.apiKey, provider.baseUrl, etc.
   * }
   */
  select(sessionId) {
    if (this.providers.length === 0) {
      return null;
    }

    // Check existing binding
    if (this.bindings.has(sessionId)) {
      const binding = this.bindings.get(sessionId);
      const boundId = binding.providerId || binding; // Support legacy format

      // Check if binding has expired
      if (binding.boundAt && Date.now() - binding.boundAt > this.bindingTtl) {
        this.bindings.delete(sessionId);
      } else {
        const provider = this.providers.find(p => p.id === boundId);
        if (provider) {
          const health = this.healthState.get(boundId);
          if (health && health.healthy) {
            return provider;
          }
          if (!this.loadBalance.failover) {
            return provider;
          }
          const newProvider = this._selectByStrategy(boundId);
          if (newProvider) {
            this._setBinding(sessionId, newProvider.id);
            return newProvider;
          }
          return provider;
        }
      }
    }

    const provider = this._selectByStrategy();
    if (provider) {
      this._setBinding(sessionId, provider.id);
    }
    return provider;
  }

  /**
   * Set a session binding with timestamp
   * @private
   * @param {string} sessionId - Session identifier
   * @param {string} providerId - Provider identifier
   * @returns {void}
   */
  _setBinding(sessionId, providerId) {
    this.bindings.set(sessionId, {
      providerId,
      boundAt: Date.now(),
    });
  }

  /**
   * Record a successful request to a provider
   * Resets consecutive failure count and marks provider as healthy
   *
   * @param {string} providerId - Provider identifier
   * @returns {void}
   *
   * @example
   * router.recordSuccess('provider-1');
   */
  recordSuccess(providerId) {
    const health = this.healthState.get(providerId);
    if (!health) return;

    health.consecutiveFailures = 0;
    health.healthy = true;
    health.totalRequests++;
  }

  /**
   * Record a failed request to a provider
   * Increments failure count and may mark provider as unhealthy
   *
   * @param {string} providerId - Provider identifier
   * @returns {void}
   *
   * @example
   * router.recordFailure('provider-1');
   */
  recordFailure(providerId) {
    const health = this.healthState.get(providerId);
    if (!health) return;

    health.consecutiveFailures++;
    health.totalRequests++;
    health.lastFailAt = Date.now();

    const threshold = this.loadBalance.failureThreshold || DEFAULT_FAILURE_THRESHOLD;
    if (health.consecutiveFailures >= threshold) {
      health.healthy = false;
    }
  }

  /**
   * Get current status of all providers
   *
   * @returns {Object} Status object containing strategy, failover setting, and provider details
   * @returns {string} returns.strategy - Current load balancing strategy
   * @returns {boolean} returns.failover - Whether failover is enabled
   * @returns {Array<Object>} returns.providers - Array of provider status objects
   *
   * @example
   * const status = router.getStatus();
   * console.log(`Strategy: ${status.strategy}`);
   * status.providers.forEach(p => {
   *   console.log(`${p.name}: ${p.healthy ? 'healthy' : 'unhealthy'}`);
   * });
   */
  getStatus() {
    const providers = this.providers.map(p => {
      const health = this.healthState.get(p.id) || {};
      let boundSessions = 0;
      for (const [, binding] of this.bindings) {
        const providerId = binding.providerId || binding; // Support legacy format
        if (providerId === p.id) boundSessions++;
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
   * Get all session-to-provider bindings
   *
   * @returns {Object.<string, string>} Map of sessionId -> providerId
   *
   * @example
   * const bindings = router.getBindings();
   * // { 'session-1': 'provider-a', 'session-2': 'provider-b' }
   */
  getBindings() {
    const result = {};
    for (const [sessionId, binding] of this.bindings) {
      // Support both new format (object) and legacy format (string)
      result[sessionId] = binding.providerId || binding;
    }
    return result;
  }

  /**
   * Reset health status for a specific provider
   * Marks provider as healthy and clears failure count
   *
   * @param {string} providerId - Provider identifier
   * @returns {boolean} True if provider was found and reset, false otherwise
   *
   * @example
   * if (router.resetProvider('provider-1')) {
   *   console.log('Provider reset successfully');
   * }
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
   * Enable a previously disabled provider
   *
   * @param {string} providerId - Provider identifier
   * @returns {boolean} True if provider was enabled, false if not found or already enabled
   *
   * @example
   * router.enableProvider('provider-1');
   */
  enableProvider(providerId) {
    const config = this._allProviders.find(p => p.id === providerId);
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
   * Disable a provider temporarily
   *
   * @param {string} providerId - Provider identifier
   * @returns {boolean} True if provider was disabled, false if not found
   *
   * @example
   * router.disableProvider('provider-1');
   */
  disableProvider(providerId) {
    const idx = this.providers.findIndex(p => p.id === providerId);
    if (idx === -1) return false;

    this.providers.splice(idx, 1);
    this._rebuildSlots();
    return true;
  }

  /**
   * Select provider by strategy (internal)
   * @private
   * @param {string|null} excludeId - Provider ID to exclude from selection
   * @returns {Object|null} Selected provider or null
   */
  _selectByStrategy(excludeId = null) {
    const candidates = this.providers.filter(p => p.id !== excludeId);
    if (candidates.length === 0) return null;

    if (this.strategy === 'weighted') {
      return this._selectWeighted(candidates);
    }
    return this._selectRoundRobin(candidates);
  }

  /**
   * Select provider using round-robin strategy
   * @private
   * @param {Array<Object>} candidates - Available providers
   * @returns {Object} Selected provider
   */
  _selectRoundRobin(candidates) {
    const idx = this._getNextIndex(candidates.length);
    return candidates[idx];
  }

  /**
   * Select provider using weighted strategy
   * @private
   * @param {Array<Object>} candidates - Available providers
   * @returns {Object} Selected provider
   */
  _selectWeighted(candidates) {
    if (!this._slots || this._slotsDirty) {
      this._rebuildSlots();
    }

    const validSlots = (this._slots || []).filter(
      id => candidates.some(c => c.id === id)
    );
    if (validSlots.length === 0) {
      return this._selectRoundRobin(candidates);
    }

    const idx = this._getNextIndex(validSlots.length);
    const selectedId = validSlots[idx];
    return candidates.find(c => c.id === selectedId);
  }

  /**
   * Rebuild weighted slots array
   * Creates an array with provider IDs repeated according to weight
   * @private
   * @returns {void}
   */
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
