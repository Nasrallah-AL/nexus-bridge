const os = require('os');
const path = require('path');

/**
 * Return the effective Node.js bin directory while supporting both
 * `nodeBinDir` and the legacy `nvmBin` configuration key.
 */
function getEffectiveNodeBinDir(config = {}) {
  return config.nodeBinDir || config.nvmBin || null;
}

/**
 * Common user-level bin directories where Claude CLI is often installed.
 */
function getCommonBinDirectories() {
  const homeDir = os.homedir();

  return [
    path.join(homeDir, '.local', 'bin'),
    path.join(homeDir, 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
}

function dedupeEntries(entries) {
  return entries.filter((entry, index) => entry && entries.indexOf(entry) === index);
}

/**
 * Prepend helpful executable directories to PATH while preserving order.
 */
function augmentPath(existingPath = '', extraEntries = []) {
  const currentEntries = existingPath ? existingPath.split(path.delimiter).filter(Boolean) : [];
  return dedupeEntries([...extraEntries, ...currentEntries]).join(path.delimiter);
}

/**
 * Build the command environment used to spawn Claude CLI.
 */
function buildCommandEnv(config = {}, baseEnv = process.env) {
  const env = { ...baseEnv };
  const extraEntries = dedupeEntries([
    getEffectiveNodeBinDir(config),
    ...getCommonBinDirectories(),
  ]);

  env.PATH = augmentPath(env.PATH, extraEntries);
  return env;
}

/**
 * Keep `nodeBinDir` and legacy `nvmBin` aligned for backward compatibility.
 */
function syncNodeBinConfig(config = {}) {
  const effectiveNodeBinDir = getEffectiveNodeBinDir(config);
  let changed = false;

  if (effectiveNodeBinDir && config.nodeBinDir !== effectiveNodeBinDir) {
    config.nodeBinDir = effectiveNodeBinDir;
    changed = true;
  }

  if (effectiveNodeBinDir && config.nvmBin !== effectiveNodeBinDir) {
    config.nvmBin = effectiveNodeBinDir;
    changed = true;
  }

  return { config, changed, effectiveNodeBinDir };
}

module.exports = {
  augmentPath,
  buildCommandEnv,
  getCommonBinDirectories,
  getEffectiveNodeBinDir,
  syncNodeBinConfig,
};

