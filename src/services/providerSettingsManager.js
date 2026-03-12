const fs = require('fs');
const path = require('path');
const os = require('os');
const getLogger = require('../utils/logger');

/**
 * Provider Settings Manager
 *
 * Manages provider-specific Claude settings files.
 * When a session is created, it creates a symlink in the project's .claude/ directory
 * pointing to the provider's settings.json file.
 *
 * Directory structure:
 * ~/.claude-code-server/provider/
 * ├── config-settings-provider-1.json
 * ├── config-settings-provider-2.json
 * └── ...
 *
 * Project directory (at runtime):
 * /path/to/project/
 * └── .claude/
 *     └── settings.json -> ~/.claude-code-server/provider/config-settings-provider-1.json
 */
class ProviderSettingsManager {
  /**
   * Create a new ProviderSettingsManager instance
   *
   * @param {Object} config - Configuration object
   * @param {string} config.dataDir - Base data directory
   */
  constructor(config) {
    this.config = config;
    this.dataDir = config.dataDir || path.join(os.homedir(), '.claude-code-server', 'data');
    this.providerDir = path.join(path.dirname(this.dataDir), 'provider');
    this.logger = getLogger({ logFile: config.logFile, logLevel: config.logLevel });

    // Ensure provider directory exists
    this._ensureDir(this.providerDir);
  }

  /**
   * Get the settings file path for a provider
   *
   * @param {string} providerId - Provider identifier
   * @returns {string} Path to provider's settings file
   */
  getSettingsPath(providerId) {
    return path.join(this.providerDir, `config-settings-${providerId}.json`);
  }

  /**
   * Check if a provider has a settings file
   *
   * @param {string} providerId - Provider identifier
   * @returns {boolean} True if settings file exists
   */
  hasSettings(providerId) {
    const settingsPath = this.getSettingsPath(providerId);
    return fs.existsSync(settingsPath);
  }

  /**
   * Save settings for a provider
   *
   * @param {string} providerId - Provider identifier
   * @param {Object} settings - Settings object to save
   * @returns {string} Path to saved settings file
   */
  saveSettings(providerId, settings) {
    const settingsPath = this.getSettingsPath(providerId);

    try {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      this.logger.info('Provider settings saved', {
        provider_id: providerId,
        path: settingsPath,
      });
      return settingsPath;
    } catch (err) {
      this.logger.error('Failed to save provider settings', {
        provider_id: providerId,
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Load settings for a provider
   *
   * @param {string} providerId - Provider identifier
   * @returns {Object|null} Settings object, or null if not found
   */
  loadSettings(providerId) {
    const settingsPath = this.getSettingsPath(providerId);

    if (!fs.existsSync(settingsPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(settingsPath, 'utf8');
      return JSON.parse(content);
    } catch (err) {
      this.logger.error('Failed to load provider settings', {
        provider_id: providerId,
        error: err.message,
      });
      return null;
    }
  }

  /**
   * Delete settings for a provider
   *
   * @param {string} providerId - Provider identifier
   * @returns {boolean} True if deleted, false if not found
   */
  deleteSettings(providerId) {
    const settingsPath = this.getSettingsPath(providerId);

    if (!fs.existsSync(settingsPath)) {
      return false;
    }

    try {
      fs.unlinkSync(settingsPath);
      this.logger.info('Provider settings deleted', {
        provider_id: providerId,
        path: settingsPath,
      });
      return true;
    } catch (err) {
      this.logger.error('Failed to delete provider settings', {
        provider_id: providerId,
        error: err.message,
      });
      return false;
    }
  }

  /**
   * Setup symlink in project directory for a provider
   * Creates .claude/settings.json symlink pointing to provider's settings file
   *
   * @param {string} projectPath - Project directory path
   * @param {string} providerId - Provider identifier
   * @returns {boolean} True if setup successful
   */
  setupProjectSymlink(projectPath, providerId) {
    if (!providerId) {
      // No provider, remove any existing symlink to use default settings
      return this.removeProjectSymlink(projectPath);
    }

    const providerSettingsPath = this.getSettingsPath(providerId);

    // Check if provider has settings file
    if (!fs.existsSync(providerSettingsPath)) {
      this.logger.debug('No provider settings file found, skipping symlink', {
        provider_id: providerId,
        path: providerSettingsPath,
      });
      return false;
    }

    // Ensure .claude directory exists
    const claudeDir = path.join(projectPath, '.claude');
    this._ensureDir(claudeDir);

    const settingsLinkPath = path.join(claudeDir, 'settings.json');

    try {
      // Remove existing symlink or file if it exists
      if (fs.existsSync(settingsLinkPath) || fs.lstatSync(settingsLinkPath).isSymbolicLink()) {
        fs.unlinkSync(settingsLinkPath);
      }

      // Create symlink (relative path for portability)
      fs.symlinkSync(providerSettingsPath, settingsLinkPath, 'file');

      this.logger.info('Created provider settings symlink', {
        project_path: projectPath,
        provider_id: providerId,
        link_path: settingsLinkPath,
        target_path: providerSettingsPath,
      });

      return true;
    } catch (err) {
      this.logger.error('Failed to create provider settings symlink', {
        project_path: projectPath,
        provider_id: providerId,
        error: err.message,
      });
      return false;
    }
  }

  /**
   * Remove symlink from project directory
   *
   * @param {string} projectPath - Project directory path
   * @returns {boolean} True if removed or didn't exist
   */
  removeProjectSymlink(projectPath) {
    const claudeDir = path.join(projectPath, '.claude');
    const settingsLinkPath = path.join(claudeDir, 'settings.json');

    try {
      if (fs.existsSync(settingsLinkPath) || fs.lstatSync(settingsLinkPath).isSymbolicLink()) {
        fs.unlinkSync(settingsLinkPath);
        this.logger.debug('Removed provider settings symlink', {
          project_path: projectPath,
          link_path: settingsLinkPath,
        });
      }
      return true;
    } catch (err) {
      this.logger.error('Failed to remove provider settings symlink', {
        project_path: projectPath,
        error: err.message,
      });
      return false;
    }
  }

  /**
   * List all provider settings files
   *
   * @returns {Array<{providerId: string, path: string}>} List of provider settings
   */
  listSettings() {
    const results = [];

    if (!fs.existsSync(this.providerDir)) {
      return results;
    }

    const files = fs.readdirSync(this.providerDir);
    const prefix = 'config-settings-';
    const suffix = '.json';

    for (const file of files) {
      if (file.startsWith(prefix) && file.endsWith(suffix)) {
        const providerId = file.substring(prefix.length, file.length - suffix.length);
        results.push({
          providerId,
          path: path.join(this.providerDir, file),
        });
      }
    }

    return results;
  }

  /**
   * Ensure directory exists
   *
   * @private
   * @param {string} dirPath - Directory path
   */
  _ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
}

module.exports = ProviderSettingsManager;
