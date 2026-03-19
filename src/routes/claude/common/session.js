/**
 * Ensure a session exists, creating one automatically if necessary.
 * @param {object} sessionManager - Session manager
 * @param {string} sessionId - Existing session ID
 * @param {string} projectPath - Project path
 * @param {string} model - Model name
 * @param {object} config - Configuration object
 * @returns {Promise<string>} Session ID
 */
async function ensureSession(sessionManager, sessionId, projectPath, model, config) {
  // Return immediately when a session ID is already provided.
  if (sessionId) {
    return sessionId;
  }

  // Return null when no session manager is available.
  if (!sessionManager) {
    return null;
  }

  try {
    // Auto-create the session.
    const session = await sessionManager.createSession({
      project_path: projectPath,
      model: model || config.defaultModel,
      metadata: {
        auto_created: true,
      },
    });
    return session.id;
  } catch (error) {
    // If session creation fails, log the error and continue.
    console.error('Failed to auto-create session:', error.message);
    return null;
  }
}

module.exports = {
  ensureSession,
};
