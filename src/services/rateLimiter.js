const rateLimit = require('express-rate-limit');
const getLogger = require('../utils/logger');

/**
 * Rate limiter service.
 */
class RateLimiter {
  constructor(config) {
    this.config = config;
    this.logger = getLogger({ logFile: config.logFile, logLevel: config.logLevel });
    this.limiter = null;
  }

  /**
   * Create rate-limiting middleware.
   */
  createLimiter(options = {}) {
    const config = this.config.rateLimit || {};

    if (!config.enabled || !this.config.rateLimit?.enabled) {
      // Rate limiting is disabled, so return a pass-through middleware.
      return (req, res, next) => next();
    }

    const windowMs = options.windowMs || config.windowMs || 60000;
    const maxRequests = options.max || config.maxRequests || 100;

    this.limiter = rateLimit({
      windowMs,
      max: maxRequests,
      message: {
        success: false,
        error: 'Too many requests, please try again later.',
      },
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => {
        this.logger.warn('Rate limit exceeded', {
          ip: req.ip,
          path: req.path,
        });
        res.status(429).json({
          success: false,
          error: 'Too many requests, please try again later.',
          retryAfter: Math.ceil(windowMs / 1000),
        });
      },
      skip: (req) => {
        // Add custom skip logic here if needed.
        // For example: skip specific IPs or paths.
        return false;
      },
    });

    this.logger.info('Rate limiter initialized', {
      windowMs,
      maxRequests,
    });

    return this.limiter;
  }

  /**
   * Get the rate-limiting middleware.
   */
  getMiddleware() {
    if (!this.limiter) {
      return this.createLimiter();
    }
    return this.limiter;
  }

  /**
   * Create a custom limiter for a specific route.
   */
  createCustomLimiter(options) {
    return rateLimit({
      windowMs: options.windowMs || 60000,
      max: options.max || 100,
      message: options.message || {
        success: false,
        error: 'Too many requests, please try again later.',
      },
      standardHeaders: true,
      legacyHeaders: false,
    });
  }
}

module.exports = RateLimiter;
