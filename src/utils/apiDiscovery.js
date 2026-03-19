const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { buildCommandEnv, getEffectiveNodeBinDir } = require('./runtimePaths');

const MODEL_ENV_MAP = {
  ANTHROPIC_MODEL: 'default_override',
  ANTHROPIC_DEFAULT_SONNET_MODEL: 'sonnet',
  ANTHROPIC_DEFAULT_HAIKU_MODEL: 'haiku',
  ANTHROPIC_DEFAULT_OPUS_MODEL: 'opus',
  ANTHROPIC_REASONING_MODEL: 'reasoning',
};

function isSensitiveKey(key = '') {
  return /(secret|token|password|api[-_]?key|authorization)/i.test(key);
}

function redactSensitiveData(value, currentKey = '') {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => {
        if (isSensitiveKey(key)) {
          return [key, '*** HIDDEN ***'];
        }
        return [key, redactSensitiveData(entryValue, key)];
      })
    );
  }

  if (isSensitiveKey(currentKey) && value != null) {
    return '*** HIDDEN ***';
  }

  return value;
}

function getSafeConfig(config = {}) {
  const cloned = JSON.parse(JSON.stringify(config));
  delete cloned._pathDetection;
  return redactSensitiveData(cloned);
}

function normalizeModelEntry(model, extra = {}) {
  return {
    name: model,
    ...extra,
  };
}

function getConfiguredModels(config = {}) {
  const configuredModels = [];

  if (config.defaultModel) {
    configuredModels.push(normalizeModelEntry(config.defaultModel, {
      source: 'config.defaultModel',
      scope: 'global',
      capability: 'default',
    }));
  }

  for (const provider of config.providers || []) {
    const providerEnv = provider.env || {};
    for (const [envKey, capability] of Object.entries(MODEL_ENV_MAP)) {
      const modelName = providerEnv[envKey];
      if (!modelName) {
        continue;
      }

      configuredModels.push(normalizeModelEntry(modelName, {
        source: `providers.${provider.id}.env.${envKey}`,
        scope: 'provider',
        capability,
        provider_id: provider.id,
        provider_name: provider.name,
      }));
    }
  }

  return configuredModels.filter((entry, index, entries) => {
    return entries.findIndex((candidate) => (
      candidate.name === entry.name &&
      candidate.source === entry.source &&
      candidate.provider_id === entry.provider_id
    )) === index;
  });
}

function getObservedModels(models = []) {
  return models.map((model) => ({
    name: model.name,
    count: model.count || 0,
    cost_usd: model.cost_usd || 0,
  }));
}

function getFeatureSummary(config = {}, providerRouter = null) {
  return {
    authentication: {
      enabled: !!config.security?.auth?.enabled,
      bypassHealthCheck: config.security?.auth?.bypassHealthCheck !== false,
    },
    swaggerDocs: {
      enabled: config.security?.swaggerDocs?.enabled !== false,
    },
    rateLimit: {
      enabled: !!config.rateLimit?.enabled,
      windowMs: config.rateLimit?.windowMs || null,
      maxRequests: config.rateLimit?.maxRequests || null,
    },
    webhook: {
      enabled: !!config.webhook?.enabled,
    },
    statistics: {
      enabled: !!config.statistics?.enabled,
    },
    mcp: {
      enabled: !!config.mcp?.enabled,
      configPath: config.mcp?.configPath || null,
    },
    loadBalance: {
      enabled: (config.providers || []).length > 0,
      strategy: providerRouter?.strategy || config.loadBalance?.strategy || null,
      providerCount: (config.providers || []).length,
      activeProviderCount: providerRouter?.providers?.length ?? (config.providers || []).filter((provider) => provider.enabled !== false).length,
    },
    runtime: {
      claudePath: config.claudePath || 'claude',
      nodeBinDir: getEffectiveNodeBinDir(config),
      workspacePath: config.workspacePath || null,
    },
  };
}

function getProviderSummaries(config = {}, providerRouter = null) {
  const statusById = new Map((providerRouter?.getStatus?.().providers || []).map((provider) => [provider.id, provider]));
  const settingsManager = providerRouter?.getSettingsManager?.();

  return (config.providers || []).map((provider) => {
    const runtimeStatus = statusById.get(provider.id);
    return {
      id: provider.id,
      name: provider.name,
      enabled: provider.enabled !== false,
      weight: provider.weight || 1,
      baseUrl: provider.baseUrl || null,
      hasApiKey: !!provider.apiKey,
      hasSettings: settingsManager ? settingsManager.hasSettings(provider.id) : false,
      envKeys: Object.keys(provider.env || {}).sort(),
      configuredModels: getConfiguredModels({ providers: [provider] }).map((model) => ({
        name: model.name,
        capability: model.capability,
      })),
      health: runtimeStatus ? {
        healthy: runtimeStatus.healthy,
        consecutiveFailures: runtimeStatus.consecutiveFailures,
        totalRequests: runtimeStatus.totalRequests,
        boundSessions: runtimeStatus.boundSessions,
      } : null,
    };
  });
}

function expandHome(filePath) {
  if (!filePath) {
    return null;
  }

  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }

  return filePath;
}

function resolveMcpConfigPath(config = {}) {
  const configPath = config.mcp?.configPath;
  if (!configPath) {
    return null;
  }

  const expanded = expandHome(configPath);
  return path.isAbsolute(expanded) ? expanded : path.resolve(expanded);
}

function summarizeMcpServers(parsedConfig) {
  const servers = parsedConfig?.mcpServers || parsedConfig?.servers || {};
  if (!servers || typeof servers !== 'object') {
    return [];
  }

  return Object.entries(servers).map(([name, serverConfig]) => ({
    name,
    transport: serverConfig.transport || (serverConfig.url ? 'http' : 'stdio'),
    command: serverConfig.command || null,
    args: Array.isArray(serverConfig.args) ? serverConfig.args : [],
    url: serverConfig.url || null,
    envKeys: Object.keys(serverConfig.env || {}).sort(),
  }));
}

function getMcpSummary(config = {}) {
  const resolvedConfigPath = resolveMcpConfigPath(config);
  const summary = {
    enabled: !!config.mcp?.enabled,
    configPath: config.mcp?.configPath || null,
    resolvedConfigPath,
    exists: false,
    valid: false,
    serverCount: 0,
    servers: [],
    error: null,
  };

  if (!resolvedConfigPath) {
    return summary;
  }

  if (!fs.existsSync(resolvedConfigPath)) {
    summary.error = 'MCP config file does not exist';
    return summary;
  }

  summary.exists = true;

  try {
    const parsed = JSON.parse(fs.readFileSync(resolvedConfigPath, 'utf8'));
    summary.valid = true;
    summary.servers = summarizeMcpServers(parsed);
    summary.serverCount = summary.servers.length;
    return summary;
  } catch (error) {
    summary.error = error.message;
    return summary;
  }
}

function normalizeMcpStatus(statusText = '') {
  const normalized = statusText.trim().toLowerCase();

  if (normalized === 'connected') {
    return 'connected';
  }

  if (normalized === 'needs authentication') {
    return 'needs_authentication';
  }

  if (normalized === 'failed to connect') {
    return 'failed';
  }

  return normalized.replace(/\s+/g, '_') || 'unknown';
}

function normalizeMcpRuntimeName(name = '') {
  return name
    .trim()
    .replace(/^claude\.ai\s+/i, '')
    .replace(/\s+/g, '');
}

function parseMcpListLine(line = '') {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const separatorIndex = trimmed.lastIndexOf(' - ');
  if (separatorIndex === -1) {
    return null;
  }

  const leftSide = trimmed.slice(0, separatorIndex).trim();
  const rightSide = trimmed.slice(separatorIndex + 3).trim();
  const statusMatch = rightSide.match(/^(?<symbol>[✓✗!])\s*(?<status>.+)$/u);

  const descriptorMatch = leftSide.match(/^(?<name>.+?)(?::\s(?<url>https?:\/\/\S+))?$/u);
  const name = normalizeMcpRuntimeName(descriptorMatch?.groups?.name?.trim() || leftSide);
  const url = descriptorMatch?.groups?.url || null;
  const status = statusMatch?.groups?.status?.trim() || rightSide;
  const statusSymbol = statusMatch?.groups?.symbol || null;

  return {
    raw: trimmed,
    name,
    url,
    status,
    statusSymbol,
    state: normalizeMcpStatus(status),
  };
}

function parseMcpListOutput(output = '') {
  return output
    .split(/\r?\n/)
    .map(parseMcpListLine)
    .filter(Boolean);
}

async function getMcpRuntimeServers(config = {}) {
  const claudePath = config.claudePath || 'claude';
  const cwd = config.workspacePath || process.cwd();

  return new Promise((resolve) => {
    execFile(
      claudePath,
      ['mcp', 'list'],
      {
        cwd,
        env: buildCommandEnv(config),
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout = '', stderr = '') => {
        const servers = parseMcpListOutput(stdout);

        if (error) {
          return resolve({
            available: false,
            command: `${claudePath} mcp list`,
            serverCount: servers.length,
            servers,
            error: stderr.trim() || error.message,
          });
        }

        return resolve({
          available: true,
          command: `${claudePath} mcp list`,
          serverCount: servers.length,
          servers,
          error: null,
        });
      }
    );
  });
}

async function getMcpSummaryWithRuntime(config = {}) {
  const summary = getMcpSummary(config);
  summary.runtime = await getMcpRuntimeServers(config);
  return summary;
}

function getMcpConfig(config = {}) {
  const resolvedConfigPath = resolveMcpConfigPath(config);
  if (!resolvedConfigPath) {
    return { found: false, error: 'MCP config path is not configured' };
  }

  if (!fs.existsSync(resolvedConfigPath)) {
    return { found: false, error: 'MCP config file does not exist', resolvedConfigPath };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(resolvedConfigPath, 'utf8'));
    return {
      found: true,
      resolvedConfigPath,
      config: redactSensitiveData(parsed),
      servers: summarizeMcpServers(parsed),
    };
  } catch (error) {
    return {
      found: false,
      error: error.message,
      resolvedConfigPath,
    };
  }
}

module.exports = {
  getConfiguredModels,
  getFeatureSummary,
  getMcpConfig,
  getMcpSummary,
  getMcpSummaryWithRuntime,
  getMcpRuntimeServers,
  getObservedModels,
  getProviderSummaries,
  parseMcpListLine,
  parseMcpListOutput,
  getSafeConfig,
  redactSensitiveData,
};

