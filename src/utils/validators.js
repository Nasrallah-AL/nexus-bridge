const Joi = require('joi');
const path = require('path');
const fs = require('fs');

/**
 * Validation utilities.
 */
class Validators {
  /**
   * Validate and resolve a project path.
   * - Paths starting with `/` are treated as absolute.
   * - Other paths are resolved relative to the workspace.
   * @param {string} projectPath - Project path provided by the user
   * @param {string} workspacePath - Workspace root directory
   * @returns {Object} { valid: boolean, fullPath?: string, error?: string }
   */
  static validateProjectPath(projectPath, workspacePath) {
    if (!projectPath) {
      // No project path was provided, so use the workspace root.
      return {
        valid: true,
        fullPath: workspacePath
      };
    }

    let fullPath;

    // Expand `~` in the path.
    if (projectPath.startsWith('~')) {
      fullPath = path.join(process.env.HOME || require('os').homedir(), projectPath.substring(2));
    } else if (projectPath.startsWith('/')) {
      // Paths starting with `/` are absolute.
      fullPath = path.resolve(projectPath);
    } else {
      // Other paths are resolved relative to the workspace.
      fullPath = path.resolve(workspacePath, projectPath);
    }

    // Ensure the directory exists.
    if (!fs.existsSync(fullPath)) {
      try {
        fs.mkdirSync(fullPath, { recursive: true });
      } catch (err) {
        return {
          valid: false,
          error: `Failed to create project directory: ${err.message}`
        };
      }
    }

    return {
      valid: true,
      fullPath: path.resolve(fullPath)
    };
  }

  /**
   * Validate a Claude API request.
   */
  static validateClaudeRequest(data) {
    const schema = Joi.object({
      prompt: Joi.string().required().min(1),
      project_path: Joi.string().allow('', null),
      model: Joi.string().allow('', null),
      session_id: Joi.string().allow('', null),
      system_prompt: Joi.string().allow('', null),
      max_budget_usd: Joi.number().min(0).optional(),
      allowed_tools: Joi.array().items(Joi.string()).optional(),
      disallowed_tools: Joi.array().items(Joi.string()).optional(),
      agent: Joi.string().allow('', null),
      mcp_config: Joi.string().allow('', null).optional(),
      stream: Joi.boolean().optional(),
      async: Joi.boolean().optional(),
      webhook_url: Joi.string().uri().optional(),
      priority: Joi.number().min(1).max(10).optional(),
      permission_mode: Joi.string().valid('default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions').optional(),
    });

    const { error, value } = schema.validate(data);
    if (error) {
      return {
        valid: false,
        error: error.details[0].message,
      };
    }
    return { valid: true, value };
  }

  /**
   * Validate a session-creation request.
   */
  static validateSessionCreate(data) {
    const schema = Joi.object({
      project_path: Joi.string().required(),
      model: Joi.string().optional(),
      metadata: Joi.object().optional(),
    });

    const { error, value } = schema.validate(data);
    if (error) {
      return {
        valid: false,
        error: error.details[0].message,
      };
    }
    return { valid: true, value };
  }

  /**
   * Validate a session-continue request.
   */
  static validateSessionContinue(data) {
    const schema = Joi.object({
      prompt: Joi.string().required().min(1),
      system_prompt: Joi.string().allow('', null).optional(),
      max_budget_usd: Joi.number().min(0).optional(),
      allowed_tools: Joi.array().items(Joi.string()).optional(),
      disallowed_tools: Joi.array().items(Joi.string()).optional(),
      stream: Joi.boolean().optional(),
      permission_mode: Joi.string().valid('default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions').optional(),
      provider_id: Joi.string().allow('', null).optional(),  // Optional: force a specific provider
    });

    const { error, value } = schema.validate(data);
    if (error) {
      return {
        valid: false,
        error: error.details[0].message,
      };
    }
    return { valid: true, value };
  }

  /**
   * Validate an async task creation request.
   */
  static validateTaskCreate(data) {
    const schema = Joi.object({
      prompt: Joi.string().required().min(1),
      project_path: Joi.string().allow('', null),
      model: Joi.string().optional(),
      priority: Joi.number().min(1).max(10).optional(),
      metadata: Joi.object().optional(),
    });

    const { error, value } = schema.validate(data);
    if (error) {
      return {
        valid: false,
        error: error.details[0].message,
      };
    }
    return { valid: true, value };
  }

  /**
   * Validate a batch request.
   */
  static validateBatchRequest(data) {
    const schema = Joi.object({
      prompts: Joi.array().items(Joi.string().min(1)).min(1).max(10).required(),
      project_path: Joi.string().allow('', null),
      model: Joi.string().optional(),
    });

    const { error, value } = schema.validate(data);
    if (error) {
      return {
        valid: false,
        error: error.details[0].message,
      };
    }
    return { valid: true, value };
  }

  /**
   * Validate a search query.
   */
  static validateSearchQuery(query) {
    const schema = Joi.object({
      q: Joi.string().required().min(1),
      limit: Joi.number().min(1).max(100).optional(),
    });

    const { error, value } = schema.validate(query);
    if (error) {
      return {
        valid: false,
        error: error.details[0].message,
      };
    }
    return { valid: true, value };
  }
}

module.exports = Validators;
