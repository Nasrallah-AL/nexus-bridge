const Joi = require('joi');
const path = require('path');

/**
 * 验证工具
 */
class Validators {
  /**
   * 验证并解析项目路径
   * 确保项目路径在工作空间目录下
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

    // 处理输入路径
    let processedPath = projectPath;

    // 如果是绝对路径（以 / 开头），去掉开头的 /，当作相对路径处理
    if (processedPath.startsWith('/')) {
      processedPath = processedPath.substring(1);
    }

    // 展开路径中的 ~ 符号
    if (processedPath.startsWith('~')) {
      processedPath = path.join(process.env.HOME || require('os').homedir(), processedPath.substring(2));
    }

    // 相对于工作空间解析
    let fullPath = path.resolve(workspacePath, processedPath);

    // 安全检查：确保解析后的路径在工作空间下
    const normalizedWorkspace = path.resolve(workspacePath);
    const normalizedFull = path.resolve(fullPath);

    if (!normalizedFull.startsWith(normalizedWorkspace)) {
      return {
        valid: false,
        error: `项目路径必须在工作空间目录下。工作空间: ${normalizedWorkspace}, 解析后路径: ${normalizedFull}`
      };
    }

    return {
      valid: true,
      fullPath: normalizedFull
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
      stream: Joi.boolean().optional(),
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
