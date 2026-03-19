const Validators = require('../../../utils/validators');

/**
 * Shared request validation and parsing.
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {object} config - Configuration object
 * @returns {object|null} Validation result, or null when validation fails
 */
function validateAndParseRequest(req, res, config) {
  // 1. Validate the request body
  const validation = Validators.validateClaudeRequest(req.body);
  if (!validation.valid) {
    res.status(400).json({
      success: false,
      error: validation.error,
    });
    return null;
  }

  // 2. Validate the project path (must be inside the workspace)
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
