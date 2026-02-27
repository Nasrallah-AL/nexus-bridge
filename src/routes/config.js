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
