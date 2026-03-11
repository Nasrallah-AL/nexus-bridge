class ProviderRouter {
  constructor(config) {
    this._allProviders = config.providers || [];
    this.providers = this._allProviders.filter(p => p.enabled !== false);
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
        if (!this.loadBalance.failover) {
          return provider;
        }
        const newProvider = this._selectByStrategy(boundId);
        if (newProvider) {
          this.bindings.set(sessionId, newProvider.id);
          return newProvider;
        }
        return provider;
      }
    }

    const provider = this._selectByStrategy();
    if (provider) {
      this.bindings.set(sessionId, provider.id);
    }
    return provider;
  }

  recordSuccess(providerId) {
    const health = this.healthState.get(providerId);
    if (!health) return;

    health.consecutiveFailures = 0;
    health.healthy = true;
    health.totalRequests++;
  }

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

  getStatus() {
    const providers = this.providers.map(p => {
      const health = this.healthState.get(p.id) || {};
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

  getBindings() {
    const result = {};
    for (const [sessionId, providerId] of this.bindings) {
      result[sessionId] = providerId;
    }
    return result;
  }

  resetProvider(providerId) {
    const health = this.healthState.get(providerId);
    if (!health) return false;

    health.healthy = true;
    health.consecutiveFailures = 0;
    health.lastFailAt = null;
    return true;
  }

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

  disableProvider(providerId) {
    const idx = this.providers.findIndex(p => p.id === providerId);
    if (idx === -1) return false;

    this.providers.splice(idx, 1);
    this._rebuildSlots();
    return true;
  }

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
    if (!this._slots || this._slotsDirty) {
      this._rebuildSlots();
    }

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
