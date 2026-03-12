const Joi = require('joi');
const path = require('path');
const fs = require('fs');

/**
 * 验证工具
 */
class Validators {
  /**
   * 验证并解析项目路径
   * - 以 / 开头：使用绝对路径
   * - 不以 / 开头：相对于工作空间解析
   * @param {string} projectPath - 用户提供的项目路径
   * @param {string} workspacePath - 工作空间根目录
   * @returns {Object} { valid: boolean, fullPath?: string, error?: string }
   */
  static validateProjectPath(projectPath, workspacePath) {
    if (!projectPath) {
      // 没有提供项目路径，使用工作空间根目录
      return {
        valid: true,
        fullPath: workspacePath
      };
    }

    let fullPath;

    // 展开路径中的 ~ 符号
    if (projectPath.startsWith('~')) {
      fullPath = path.join(process.env.HOME || require('os').homedir(), projectPath.substring(2));
    } else if (projectPath.startsWith('/')) {
      // 以 / 开头，使用绝对路径
      fullPath = path.resolve(projectPath);
    } else {
      // 不以 / 开头，相对于工作空间解析
      fullPath = path.resolve(workspacePath, projectPath);
    }

    // 确保目录存在
    if (!fs.existsSync(fullPath)) {
      try {
        fs.mkdirSync(fullPath, { recursive: true });
      } catch (err) {
        return {
          valid: false,
          error: `无法创建项目目录: ${err.message}`
        };
      }
    }

    return {
      valid: true,
      fullPath: path.resolve(fullPath)
    };
  }

  /**
   * 验证 Claude API 请求
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
   * 验证会话创建请求
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
   * 验证会话继续请求
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
      provider_id: Joi.string().allow('', null).optional(),  // Optional: force specific provider
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
   * 验证异步任务创建请求
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
   * 验证批量处理请求
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
   * 验证搜索查询
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
