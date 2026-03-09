const Validators = require('../../../utils/validators');

/**
 * 统一的请求验证和解析
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {object} config - 配置对象
 * @returns {object|null} 验证结果，失败时返回 null
 */
function validateAndParseRequest(req, res, config) {
  // 1. 验证请求体
  const validation = Validators.validateClaudeRequest(req.body);
  if (!validation.valid) {
    res.status(400).json({
      success: false,
      error: validation.error,
    });
    return null;
  }

  // 2. 验证项目路径（必须在工作空间下）
  const pathValidation = Validators.validateProjectPath(
    req.body.project_path,
    config.workspacePath
  );

  if (!pathValidation.valid) {
    res.status(400).json({
      success: false,
      error: pathValidation.error,
    });
    return null;
  }

  return {
    valid: true,
    projectPath: pathValidation.fullPath,
    prompt: req.body.prompt,
    model: req.body.model,
    sessionId: req.body.session_id,
    systemPrompt: req.body.system_prompt,
    maxBudgetUsd: req.body.max_budget_usd,
    allowedTools: req.body.allowed_tools,
    disallowedTools: req.body.disallowed_tools,
    agent: req.body.agent,
    mcpConfig: req.body.mcp_config,
    stream: req.body.stream,
    permissionMode: req.body.permission_mode,
  };
}

module.exports = {
  validateAndParseRequest,
};
