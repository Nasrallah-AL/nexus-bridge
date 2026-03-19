const SessionStore = require('../storage/sessionStore');
const ClaudeExecutor = require('./claudeExecutor');
const getLogger = require('../utils/logger');
const Validators = require('../utils/validators');

/**
 * Session management service.
 */
class SessionManager {
  constructor(config, sessionStore, claudeExecutor, messageStore = null, providerRouter = null) {
    this.config = config;
    this.sessionStore = sessionStore;
    this.claudeExecutor = claudeExecutor;
    this.messageStore = messageStore;
    this.providerRouter = providerRouter;
    this.logger = getLogger({ logFile: config.logFile, logLevel: config.logLevel });
  }

  /**
   * Create a new session.
   */
  async createSession(sessionData) {
    const session = await this.sessionStore.create(sessionData);
    this.logger.info(`Session created`, { session_id: session.id, project_path: session.project_path });
    return session;
  }

  /**
   * Get session details.
   */
  async getSession(sessionId) {
    const session = await this.sessionStore.get(sessionId);
    if (!session) {
      return null;
    }
    return session;
  }

  /**
   * Continue a session conversation.
   */
  async continueSession(sessionId, options) {
    const session = await this.sessionStore.get(sessionId);
    if (!session) {
      return {
        success: false,
        error: `Session not found: ${sessionId}`,
      };
    }

    // Check the session status.
    if (session.status !== 'active') {
      return {
        success: false,
        error: `Session is not active: ${session.status}`,
      };
    }

    // Validate and resolve the project path, including legacy sessions with bad paths.
    const pathValidation = Validators.validateProjectPath(
      session.project_path,
      this.config.workspacePath
    );

    if (!pathValidation.valid) {
      return {
        success: false,
        error: pathValidation.error,
      };
    }

    // Save the user message before execution.
    if (this.messageStore && sessionId) {
      try {
        await this.messageStore.addMessage(sessionId, {
          role: 'user',
          content: options.prompt,
          metadata: {
            prompt: options.prompt,
            project_path: session.project_path,
            model: options.model || session.model,
          },
        });
        this.logger.debug(`User message saved for session`, { session_id: sessionId });
      } catch (msgErr) {
        // Message storage failures should not interrupt the main flow.
        this.logger.warn(`Failed to save user message for session`, {
          session_id: sessionId,
          error: msgErr.message,
        });
      }
    }

    // Execute Claude using the session configuration.
    const result = await this.claudeExecutor.execute({
      prompt: options.prompt,
      projectPath: pathValidation.fullPath,  // Use the resolved full path.
      model: options.model || session.model,
      sessionId: session.id,
      systemPrompt: options.systemPrompt,
      maxBudgetUsd: options.maxBudgetUsd,
      allowedTools: options.allowedTools,
      disallowedTools: options.disallowedTools,
      permissionMode: options.permission_mode,
      stream: options.stream,
      providerRouter: this.providerRouter,
    });

    return result;
  }

  /**
   * List sessions.
   */
  async listSessions(options = {}) {
    const sessions = await this.sessionStore.list(options);
    return sessions;
  }

  /**
   * Search sessions.
   */
  async searchSessions(query, options = {}) {
    const sessions = await this.sessionStore.search(query, options);
    return sessions;
  }

  /**
   * Delete a session.
   */
  async deleteSession(sessionId) {
    const deleted = await this.sessionStore.delete(sessionId);
    if (deleted) {
      // Delete the session message file as well.
      if (this.messageStore) {
        try {
          await this.messageStore.deleteMessages(sessionId);
          this.logger.info(`Messages deleted for session`, { session_id: sessionId });
        } catch (err) {
          this.logger.warn(`Failed to delete messages for session`, {
            session_id: sessionId,
            error: err.message,
          });
        }
      }
      this.logger.info(`Session deleted`, { session_id: sessionId });
      return { success: true };
    }
    return { success: false, error: 'Session not found' };
  }

  /**
   * Update the session status.
   */
  async updateSessionStatus(sessionId, status) {
    const session = await this.sessionStore.update(sessionId, { status });
    if (session) {
      this.logger.info(`Session status updated`, { session_id: sessionId, status });
      return { success: true, session };
    }
    return { success: false, error: 'Session not found' };
  }

  /**
   * Get session statistics.
   */
  async getSessionStats(sessionId) {
    const session = await this.sessionStore.get(sessionId);
    if (!session) {
      return null;
    }

    return {
      id: session.id,
      created_at: session.created_at,
      updated_at: session.updated_at,
      messages_count: session.messages_count,
      total_cost_usd: session.total_cost_usd,
      model: session.model,
      project_path: session.project_path,
      status: session.status,
    };
  }

  /**
   * Clean up expired sessions.
   */
  async cleanupExpiredSessions() {
    const retentionDays = this.config.sessionRetentionDays || 30;
    const result = await this.sessionStore.cleanup(retentionDays);
    this.logger.info(`Expired sessions cleaned up`, { deleted_count: result.deletedCount });
    return result;
  }
}

module.exports = SessionManager;
