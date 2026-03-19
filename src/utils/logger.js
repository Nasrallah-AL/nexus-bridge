const winston = require('winston');
const path = require('path');
const fs = require('fs');

/**
 * Logging utility.
 */
class Logger {
  constructor(config = {}) {
    this.logFile = config.logFile || path.join(process.env.HOME || require('os').homedir(), '.nexus-bridge', 'logs', 'server.log');
    this.logLevel = config.logLevel || 'info';
    this.logger = null;
  }

  /**
   * Initialize logging.
   */
  init() {
    // Do not recreate the logger if it already exists.
    if (this.logger) {
      return;
    }

    // Ensure the log directory exists.
    const logDir = path.dirname(this.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Use only file transports and avoid console output entirely.
    const transports = [
      new winston.transports.File({
        filename: this.logFile,
        maxsize: 10 * 1024 * 1024, // 10MB
        maxFiles: 5,
      }),
    ];

    // Create the logger instance.
    this.logger = winston.createLogger({
      level: this.logLevel,
      format: winston.format.combine(
        winston.format.timestamp({
          format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports,
    });
  }

  info(message, meta = {}) {
    if (this.logger) {
      this.logger.info(message, meta);
    }
  }

  error(message, meta = {}) {
    if (this.logger) {
      this.logger.error(message, meta);
    }
  }

  warn(message, meta = {}) {
    if (this.logger) {
      this.logger.warn(message, meta);
    }
  }

  debug(message, meta = {}) {
    if (this.logger) {
      this.logger.debug(message, meta);
    }
  }
}

// Singleton instance to avoid duplicate logger creation.
let loggerInstance = null;

function getLogger(config) {
  // Create the instance on first use.
  if (!loggerInstance) {
    loggerInstance = new Logger(config);
    loggerInstance.init();
  }

  return loggerInstance;
}

module.exports = getLogger;
