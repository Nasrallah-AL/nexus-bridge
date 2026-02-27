/**
 * Audit Logger Service
 *
 * Tracks authentication failures and API usage for security monitoring.
 * All events are stored in the statistics database for later analysis.
 */

class AuditLogger {
  /**
   * @param {Object} config - Server configuration
   * @param {Object} statsStore - Statistics store instance
   */
  constructor(config, statsStore) {
    this.config = config;
    this.statsStore = statsStore;
    this.enabled = config.security?.audit?.enabled !== false;
  }

  /**
   * Log authentication failure
   * @param {Object} req - Express request object
   * @param {string} reason - Reason for authentication failure
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

    // Fire and forget - don't await
    this._recordEvent(event).catch(err => {
      console.error('Audit logging failed:', err.message);
    });
  }

  /**
   * Log successful API usage
   * @param {Object} req - Express request object
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

    // Fire and forget - don't await
    this._recordEvent(event).catch(err => {
      console.error('Audit logging failed:', err.message);
    });
  }

  /**
   * Record event to statistics database
   * @private
   * @param {Object} event - Event object to record
   */
  async _recordEvent(event) {
    try {
      const date = new Date().toISOString().split('T')[0];
      await this.statsStore.withLock(async () => {
        this.statsStore.db.data.audit_logs.push({ ...event, date });
      });
    } catch (error) {
      console.error('Audit logging failed:', error.message);
    }
  }

  /**
   * Get recent audit logs
   * @param {number} limit - Maximum number of logs to return
   * @returns {Array} Array of audit log entries
   */
  async getRecentLogs(limit = 100) {
    try {
      await this.statsStore.db.read();
      const logs = this.statsStore.db.data.audit_logs || [];
      return logs
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, limit);
    } catch (error) {
      return [];
    }
  }

  /**
   * Get audit logs by date range
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {Array} Array of audit log entries
   */
  async getLogsByDateRange(startDate, endDate) {
    try {
      await this.statsStore.db.read();
      const logs = this.statsStore.db.data.audit_logs || [];
      return logs
        .filter(log => {
          const logDate = log.date;
          return logDate >= startDate && logDate <= endDate;
        })
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (error) {
      return [];
    }
  }

  /**
   * Get audit logs by type
   * @param {string} type - Event type (e.g., 'auth_failure', 'api_call')
   * @param {number} limit - Maximum number of logs to return
   * @returns {Array} Array of audit log entries
   */
  async getLogsByType(type, limit = 100) {
    try {
      await this.statsStore.db.read();
      const logs = this.statsStore.db.data.audit_logs || [];
      return logs
        .filter(log => log.type === type)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, limit);
    } catch (error) {
      return [];
    }
  }

  /**
   * Get audit logs by IP address
   * @param {string} ip - IP address to filter by
   * @param {number} limit - Maximum number of logs to return
   * @returns {Array} Array of audit log entries
   */
  async getLogsByIp(ip, limit = 100) {
    try {
      await this.statsStore.db.read();
      const logs = this.statsStore.db.data.audit_logs || [];
      return logs
        .filter(log => log.ip === ip)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, limit);
    } catch (error) {
      return [];
    }
  }
}

module.exports = AuditLogger;
