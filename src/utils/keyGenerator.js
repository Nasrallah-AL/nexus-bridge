const crypto = require('crypto');

/**
 * Generate a new SECRET_KEY for storage in config
 * Format: nb_sk_<32 bytes base64url>
 * @returns {string} The secret key
 */
function generateSecretKey() {
  const bytes = crypto.randomBytes(32);
  return `nb_sk_${bytes.toString('base64url')}`;
}

/**
 * Derive API Key from SECRET_KEY using HMAC-SHA256
 * Format: nb_ak_<hmac digest>
 * @param {string} secretKey - The SECRET_KEY from config
 * @returns {string} The derived API key
 */
function deriveApiKey(secretKey) {
  const derived = crypto.createHmac('sha256', secretKey)
    .update('nexus-bridge-api-key')
    .digest('base64url');
  return `nb_ak_${derived}`;
}

/**
 * Validate an API key against the expected derived key
 * @param {string} clientApiKey - The API key from client request
 * @param {string} secretKey - The SECRET_KEY from config
 * @returns {boolean} True if valid
 */
function verifyApiKey(clientApiKey, secretKey) {
  const expectedApiKey = deriveApiKey(secretKey);
  return clientApiKey === expectedApiKey;
}

module.exports = {
  generateSecretKey,
  deriveApiKey,
  verifyApiKey
};
