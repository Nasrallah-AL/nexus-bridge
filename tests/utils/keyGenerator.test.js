const { generateSecretKey, deriveApiKey } = require('../../src/utils/keyGenerator');

describe('KeyGenerator', () => {
  describe('generateSecretKey', () => {
    test('should generate a secret key with correct prefix', () => {
      const secretKey = generateSecretKey();
      expect(secretKey).toMatch(/^ccs_sk_[a-f0-9]{64}$/);
    });

    test('should generate unique secret keys', () => {
      const key1 = generateSecretKey();
      const key2 = generateSecretKey();
      expect(key1).not.toBe(key2);
    });

    test('should generate 32-byte hex string', () => {
      const secretKey = generateSecretKey();
      const hexPart = secretKey.replace('ccs_sk_', '');
      expect(hexPart.length).toBe(64); // 32 bytes = 64 hex characters
    });
  });

  describe('deriveApiKey', () => {
    test('should derive API key from secret key', () => {
      const secretKey = generateSecretKey();
      const apiKey = deriveApiKey(secretKey);
      expect(apiKey).toMatch(/^ccs_ak_[a-f0-9]{64}$/);
    });

    test('should generate same API key for same secret key', () => {
      const secretKey = generateSecretKey();
      const apiKey1 = deriveApiKey(secretKey);
      const apiKey2 = deriveApiKey(secretKey);
      expect(apiKey1).toBe(apiKey2);
    });

    test('should generate different API keys for different secret keys', () => {
      const secretKey1 = generateSecretKey();
      const secretKey2 = generateSecretKey();
      const apiKey1 = deriveApiKey(secretKey1);
      const apiKey2 = deriveApiKey(secretKey2);
      expect(apiKey1).not.toBe(apiKey2);
    });

    test('should be deterministic', () => {
      const knownSecretKey = 'ccs_sk_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const apiKey1 = deriveApiKey(knownSecretKey);
      const apiKey2 = deriveApiKey(knownSecretKey);
      expect(apiKey1).toBe(apiKey2);
    });
  });
});
