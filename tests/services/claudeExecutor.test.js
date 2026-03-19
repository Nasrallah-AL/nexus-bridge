const os = require('os');
const path = require('path');
const EventEmitter = require('events');
const ClaudeExecutor = require('../../src/services/claudeExecutor');

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

jest.mock('../../src/utils/logger', () => () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/utils/providerEnv', () => ({
  injectProviderEnv: jest.fn(),
  getSafeProviderInfo: jest.fn(() => ({})),
  getEnvStatus: jest.fn(() => ({})),
}));

describe('ClaudeExecutor', () => {
  let executor;
  let mockSpawn;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSpawn = require('child_process').spawn;
    executor = new ClaudeExecutor({
      logFile: '/tmp/test.log',
      logLevel: 'debug',
      claudePath: 'claude',
      nvmBin: '/Users/test/.nvm/versions/node/v24/bin',
      defaultModel: 'claude-sonnet-4-5',
      maxBudgetUsd: 10,
    });
  });

  test('spawnCommand uses legacy nvmBin as the effective Node.js bin directory', async () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();

    mockSpawn.mockImplementation(() => {
      setImmediate(() => {
        const error = new Error('spawn claude ENOENT');
        error.code = 'ENOENT';
        child.emit('error', error);
      });
      return child;
    });

    await expect(executor.spawnCommand(os.tmpdir(), ['-p', 'Say hello'])).rejects.toMatchObject({
      details: expect.objectContaining({
        nodeBinDir: '/Users/test/.nvm/versions/node/v24/bin',
        nvmBin: '/Users/test/.nvm/versions/node/v24/bin',
      }),
    });

    const [command, args, options] = mockSpawn.mock.calls[0];
    expect(command).toBe('claude');
    expect(args).toEqual(['-p', 'Say hello']);
    expect(options.env.PATH.split(path.delimiter)).toEqual(
      expect.arrayContaining([
        '/Users/test/.nvm/versions/node/v24/bin',
        path.join(os.homedir(), '.local', 'bin'),
      ])
    );
  });
});

