const fs = require('fs');
const path = require('path');
const os = require('os');
const getLogger = require('../utils/logger');

/**
 * Provider Home Manager
 *
 * Manages isolated HOME directories for each provider.
 * This allows each provider to have its own environment while
 * sharing common configuration files via symlinks.
 *
 * Directory structure:
 * ~/.claude-code-server/data/providers/
 * ├── provider-openai/
 * │   ├── .claude/          <- Claude config (symlinked except settings.json)
 * │   ├── .gitconfig        <- Custom symlinks from config
 * │   └── ...
 * └── provider-anthropic/
 *     └── ...
 */
class ProviderHomeManager {
  /**
   * Create a new ProviderHomeManager instance
   *
   * @param {Object} config - Configuration object
   * @param {string} config.dataDir - Base data directory
   * @param {string[]} [config.sessionHomeSymlinks=[]] - Files/dirs to symlink from real HOME
   */
  constructor(config) {
    this.config = config;
    this.dataDir = config.dataDir || path.join(os.homedir(), '.claude-code-server', 'data');
    this.providersDir = path.join(this.dataDir, 'providers');
    this.realHome = os.homedir();
    this.symlinks = config.sessionHomeSymlinks || [];
    this.logger = getLogger({ logFile: config.logFile, logLevel: config.logLevel });

    // Cache for provider HOME paths
    this._homeCache = new Map();

    // Ensure providers directory exists
    this._ensureDir(this.providersDir);
  }

  /**
   * Initialize HOME directory for a provider
   *
   * @param {string} providerId - Provider identifier
   * @returns {string} Path to provider's HOME directory
   */
  initProviderHome(providerId) {
    // Return cached path if available
    if (this._homeCache.has(providerId)) {
      return this._homeCache.get(providerId);
    }

    const providerHome = path.join(this.providersDir, providerId);

    // Create provider directory if not exists
    this._ensureDir(providerHome);

    // Setup symlinks
    this._setupSymlinks(providerHome);

    // Setup .claude directory (special handling)
    this._setupClaudeDir(providerHome);

    // Cache the path
    this._homeCache.set(providerId, providerHome);

    this.logger.info('Provider HOME initialized', {
      provider_id: providerId,
      home_path: providerHome,
      symlinks_count: this.symlinks.length,
    });

    return providerHome;
  }

  /**
   * Get HOME path for a provider
   *
   * @param {string|null} providerId - Provider identifier (null for system HOME)
   * @returns {string|null} Path to HOME directory, or null for system HOME
   */
  getHomePath(providerId) {
    if (!providerId) {
      // No provider, use system HOME
      return null;
    }

    // Check cache first
    if (this._homeCache.has(providerId)) {
      return this._homeCache.get(providerId);
    }

    // Initialize if not cached
    return this.initProviderHome(providerId);
  }

  /**
   * Setup symlinks from real HOME to provider HOME
   *
   * @private
   * @param {string} providerHome - Provider's HOME directory path
   */
  _setupSymlinks(providerHome) {
    for (const item of this.symlinks) {
      const sourcePath = path.join(this.realHome, item);
      const targetPath = path.join(providerHome, item);

      // Skip if source doesn't exist
      if (!fs.existsSync(sourcePath)) {
        this.logger.debug('Symlink source not found, skipping', { source: sourcePath });
        continue;
      }

      // Skip if target already exists
      if (fs.existsSync(targetPath)) {
        this.logger.debug('Symlink target already exists, skipping', { target: targetPath });
        continue;
      }

      // Ensure parent directory exists
      const targetDir = path.dirname(targetPath);
      this._ensureDir(targetDir);

      // Create symlink
      try {
        const stat = fs.lstatSync(sourcePath);
        const linkType = stat.isDirectory() ? 'junction' : 'file';
        fs.symlinkSync(sourcePath, targetPath, linkType);
        this.logger.debug('Created symlink', { source: sourcePath, target: targetPath });
      } catch (err) {
        this.logger.warn('Failed to create symlink', {
          source: sourcePath,
          target: targetPath,
          error: err.message,
        });
      }
    }
  }

  /**
   * Setup .claude directory with symlinks (except settings files)
   *
   * @private
   * @param {string} providerHome - Provider's HOME directory path
   */
  _setupClaudeDir(providerHome) {
    const globalClaudeDir = path.join(this.realHome, '.claude');
    const sessionClaudeDir = path.join(providerHome, '.claude');

    // Skip if global .claude doesn't exist
    if (!fs.existsSync(globalClaudeDir)) {
      return;
    }

    // Ensure session .claude directory exists
    this._ensureDir(sessionClaudeDir);

    // Files to exclude from symlink (provider-specific settings)
    const excludeFromSymlink = ['settings.json', 'settings.local.json'];

    // Symlink all contents from global ~/.claude/ except excluded files
    const claudeDirContents = fs.readdirSync(globalClaudeDir);
    for (const item of claudeDirContents) {
      if (excludeFromSymlink.includes(item)) {
        continue;
      }

      const globalItemPath = path.join(globalClaudeDir, item);
      const sessionItemPath = path.join(sessionClaudeDir, item);

      // Only create symlink if target doesn't exist
      if (fs.existsSync(sessionItemPath)) {
        continue;
      }

      try {
        const stat = fs.lstatSync(globalItemPath);
        const linkType = stat.isDirectory() ? 'junction' : 'file';
        fs.symlinkSync(globalItemPath, sessionItemPath, linkType);
        this.logger.debug('Created .claude symlink', { item, target: sessionItemPath });
      } catch (err) {
        this.logger.warn('Failed to create .claude symlink', { item, error: err.message });
      }
    }

    // Symlink ~/.claude.json if exists
    const globalClaudeJson = path.join(this.realHome, '.claude.json');
    const sessionClaudeJson = path.join(providerHome, '.claude.json');
    if (fs.existsSync(globalClaudeJson) && !fs.existsSync(sessionClaudeJson)) {
      try {
        fs.symlinkSync(globalClaudeJson, sessionClaudeJson, 'file');
        this.logger.debug('Created .claude.json symlink');
      } catch (err) {
        this.logger.warn('Failed to create .claude.json symlink', { error: err.message });
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

  /**
   * Clear cache (useful for hot reload)
   */
  clearCache() {
    this._homeCache.clear();
  }

  /**
   * Update symlinks configuration and clear cache
   *
   * @param {string[]} symlinks - New symlinks configuration
   */
  updateSymlinks(symlinks) {
    this.symlinks = symlinks || [];
    this.clearCache();
  }
}

module.exports = ProviderHomeManager;
