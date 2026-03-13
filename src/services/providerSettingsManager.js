const fs = require('fs');
const path = require('path');
const os = require('os');
const getLogger = require('../utils/logger');

/**
 * Provider Settings Manager
 *
 * Manages provider-specific Claude settings files.
 * Each provider's settings are stored as a separate JSON file in the provider directory.
 * When a session is executed, the corresponding settings file is symlinked to the project's .claude/ directory.
 *
 * Directory structure:
 * ~/.claude-code-server/provider/
 * ├── max.json          <- Provider "max" settings (Claude settings.json format)
 * ├── zwl.json          <- Provider "zwl" settings
 * └── ...
 *
 * Project directory (at runtime):
 * /path/to/project/
 * └── .claude/
 *     └── settings.json -> ~/.claude-code-server/provider/max.json
 */
class ProviderSettingsManager {
  /**
   * Create a new ProviderSettingsManager instance
   *
   * @param {Object} config - Configuration object
   */
  constructor(config) {
    this.config = config;
    this.baseDir = path.join(os.homedir(), '.claude-code-server');
    this.providerDir = path.join(this.baseDir, 'provider');
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
    return path.join(this.providerDir, `${providerId}.json`);
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
   * Creates or updates the provider's settings file
   *
   * @param {string} providerId - Provider identifier
   * @param {Object} settings - Settings object (Claude settings.json format)
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
   * Create default settings for a provider based on provider config
   * This creates a Claude settings.json compatible file
   *
   * @param {Object} providerConfig - Provider configuration from config.json
   * @returns {string} Path to created settings file
   */
  createDefaultSettings(providerConfig) {
    const { id, apiKey, baseUrl, env = {} } = providerConfig;

    // Create Claude settings.json format
    const settings = {
      env: {
        ANTHROPIC_API_KEY: apiKey,
        ...(baseUrl ? { ANTHROPIC_BASE_URL: baseUrl } : {}),
        ...env,
      },
    };

    return this.saveSettings(id, settings);
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
      // Note: lstatSync throws if file doesn't exist, so only call it if existsSync is true
      if (fs.existsSync(settingsLinkPath)) {
        fs.unlinkSync(settingsLinkPath);
      }

      // Create symlink
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
      if (fs.existsSync(settingsLinkPath)) {
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
    const suffix = '.json';

    for (const file of files) {
      if (file.endsWith(suffix)) {
        const providerId = file.substring(0, file.length - suffix.length);
        results.push({
          providerId,
          path: path.join(this.providerDir, file),
        });
      }
    }

    return results;
  }

  /**
   * Initialize settings for all providers from config.json
   * Creates default settings files for providers that don't have one
   *
   * @param {Array<Object>} providers - Array of provider configurations
   */
  initializeFromConfig(providers = []) {
    for (const provider of providers) {
      if (!this.hasSettings(provider.id)) {
        try {
          this.createDefaultSettings(provider);
          this.logger.info('Created default settings for provider', {
            provider_id: provider.id,
          });
        } catch (err) {
          this.logger.warn('Failed to create default settings for provider', {
            provider_id: provider.id,
            error: err.message,
          });
        }
      }
    }
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
