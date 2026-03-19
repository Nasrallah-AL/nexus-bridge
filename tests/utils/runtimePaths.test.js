const os = require('os');
const path = require('path');
const {
  augmentPath,
  buildCommandEnv,
  getEffectiveNodeBinDir,
  syncNodeBinConfig,
} = require('../../src/utils/runtimePaths');

describe('runtimePaths', () => {
  test('getEffectiveNodeBinDir prefers nodeBinDir and falls back to nvmBin', () => {
	expect(getEffectiveNodeBinDir({ nodeBinDir: '/node/bin', nvmBin: '/nvm/bin' })).toBe('/node/bin');
	expect(getEffectiveNodeBinDir({ nvmBin: '/nvm/bin' })).toBe('/nvm/bin');
	expect(getEffectiveNodeBinDir({})).toBeNull();
  });

  test('augmentPath prepends new entries without duplicates', () => {
	const result = augmentPath('/usr/bin:/bin', ['/custom/bin', '/usr/bin']);
	expect(result.split(path.delimiter)).toEqual(['/custom/bin', '/usr/bin', '/bin']);
  });

  test('buildCommandEnv prepends effective node bin and common user bin directories', () => {
	const env = buildCommandEnv(
	  { nvmBin: '/Users/test/.nvm/versions/node/v24/bin' },
	  { PATH: '/usr/bin:/bin' }
	);

	const entries = env.PATH.split(path.delimiter);
	expect(entries[0]).toBe('/Users/test/.nvm/versions/node/v24/bin');
	expect(entries).toContain(path.join(os.homedir(), '.local', 'bin'));
	expect(entries).toContain('/usr/bin');
	expect(entries).toContain('/bin');
  });

  test('syncNodeBinConfig keeps nodeBinDir and legacy nvmBin aligned', () => {
	const configFromLegacy = { nvmBin: '/legacy/bin' };
	const legacyResult = syncNodeBinConfig(configFromLegacy);
	expect(legacyResult.changed).toBe(true);
	expect(configFromLegacy.nodeBinDir).toBe('/legacy/bin');
	expect(configFromLegacy.nvmBin).toBe('/legacy/bin');

	const configFromModern = { nodeBinDir: '/modern/bin' };
	const modernResult = syncNodeBinConfig(configFromModern);
	expect(modernResult.changed).toBe(true);
	expect(configFromModern.nodeBinDir).toBe('/modern/bin');
	expect(configFromModern.nvmBin).toBe('/modern/bin');
  });
});

