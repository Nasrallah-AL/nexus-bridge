const os = require('os');
const path = require('path');
const PathResolver = require('../../src/utils/pathResolver');

describe('PathResolver', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('detectClaudePath checks common user bin directories such as ~/.local/bin', async () => {
    const resolver = new PathResolver();
    const localClaudePath = path.join(os.homedir(), '.local', 'bin', 'claude');

    jest.spyOn(resolver, 'which').mockResolvedValue(null);
    jest.spyOn(resolver, 'findInNvm').mockResolvedValue(null);
    jest.spyOn(resolver, 'findInPathEnv').mockResolvedValue(null);
    jest.spyOn(resolver, 'isExecutable').mockImplementation(async (candidatePath) => candidatePath === localClaudePath);

    const result = await resolver.detectClaudePath('claude');

    expect(result.found).toBe(true);
    expect(result.path).toBe(localClaudePath);
  });

  test('applyDetectionResults synchronizes both nodeBinDir and nvmBin', () => {
    const resolver = new PathResolver();
    const config = {
      claudePath: 'claude',
      nodeBinDir: null,
      nvmBin: null,
    };

    const results = {
      claudePath: { found: true, path: '/Users/test/.local/bin/claude' },
      nvmBin: { found: true, path: '/Users/test/.nvm/versions/node/v24/bin' },
      defaultProjectPath: { found: true, path: '/Users/test/workspace' },
    };

    const { updates, warnings } = resolver.applyDetectionResults(config, results);

    expect(warnings).toEqual([]);
    expect(config.claudePath).toBe('/Users/test/.local/bin/claude');
    expect(config.nodeBinDir).toBe('/Users/test/.nvm/versions/node/v24/bin');
    expect(config.nvmBin).toBe('/Users/test/.nvm/versions/node/v24/bin');
    expect(updates).toContain('nodeBinDir: null → /Users/test/.nvm/versions/node/v24/bin');
    expect(updates).toContain('nvmBin: null → /Users/test/.nvm/versions/node/v24/bin');
  });
});

