const Validators = require('../utils/validators');

/**
 * 创建会话路由
 * @param {Object} sessionManager - Session manager service
 * @param {Object} messageStore - Message store service (optional)
 * @param {Object} streamManager - Stream manager service (optional)
 * @param {Object} providerRouter - Provider router for load balancing (optional)
 */
function createSessionRoutes(sessionManager, messageStore = null, streamManager = null, providerRouter = null) {
  const router = require('express').Router();

  /**
   * @swagger
   * /api/sessions:
   *   post:
   *     summary: Create a new session
   *     description: |
   *       Create a new conversation session for multi-turn dialogues.
   *       Sessions automatically track message count, total cost, and conversation history.
   *       Useful for maintaining context across multiple Claude requests.
   *     tags: [Sessions]
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateSessionRequest'
   *           examples:
   *             minimal:
   *               summary: Minimal session (uses defaults)
   *               value: {}
   *             withProject:
   *               summary: Session with project path
   *               value:
   *                 project_path: "/path/to/project"
   *             fullOptions:
   *               summary: Session with all options
   *               value:
   *                 project_path: "/path/to/project"
   *                 model: "claude-sonnet-4-5"
   *                 metadata:
   *                   auto_created: false
   *                   user_id: "user-123"
   *     responses:
   *       '201':
   *         description: Session created successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 session:
   *                   $ref: '#/components/schemas/Session'
   *             example:
   *               success: true
   *               session:
   *                 id: "550e8400-e29b-41d4-a716-446655440000"
   *                 project_path: "/path/to/project"
   *                 model: "claude-sonnet-4-5"
   *                 messages_count: 0
   *                 total_cost_usd: 0
   *                 status: "active"
   *                 metadata: {}
   *                 created_at: "2025-02-26T10:30:00.000Z"
   *                 updated_at: "2025-02-26T10:30:00.000Z"
   *       '400':
   *         description: Invalid request
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               success: false
   *               error: "Invalid project path"
   *       '500':
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               success: false
   *               error: "Failed to create session"
   */
  // POST /api/sessions - 创建会话
  router.post('/', async (req, res) => {
    const validation = Validators.validateSessionCreate(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error,
      });
    }

    // 验证并解析项目路径（必须在工作空间下）
    const pathValidation = Validators.validateProjectPath(
      validation.value.project_path,
      sessionManager.config.workspacePath
    );

    if (!pathValidation.valid) {
      return res.status(400).json({
        success: false,
        error: pathValidation.error,
      });
    }

    try {
      const session = await sessionManager.createSession({
        ...validation.value,
        project_path: pathValidation.fullPath,  // 使用解析后的完整路径
      });
      res.status(201).json({
        success: true,
        session,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * @swagger
   * /api/sessions:
   *   get:
   *     summary: List all sessions
   *     description: |
   *       Retrieve a list of all sessions with optional filtering.
   *       Supports filtering by status, project path, and limiting results.
   *       Returns sessions sorted by creation time (newest first).
   *     tags: [Sessions]
   *     parameters:
   *       - name: status
   *         in: query
   *         description: Filter by session status
   *         required: false
   *         schema:
   *           type: string
   *           enum: [active, archived, closed]
   *         example: "active"
   *       - name: project_path
   *         in: query
   *         description: Filter by project path
   *         required: false
   *         schema:
   *           type: string
   *         example: "/path/to/project"
   *       - name: limit
   *         in: query
   *         description: Maximum number of sessions to return
   *         required: false
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 1000
   *           default: 100
   *         example: 50
   *     responses:
   *       '200':
   *         description: List of sessions retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 sessions:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Session'
   *                 count:
   *                   type: integer
   *                   description: Number of sessions returned
   *                   example: 10
   *             example:
   *               success: true
   *               sessions:
   *                 - id: "550e8400-e29b-41d4-a716-446655440000"
   *                   project_path: "/path/to/project"
   *                   model: "claude-sonnet-4-5"
   *                   messages_count: 5
   *                   total_cost_usd: 0.4875
   *                   status: "active"
   *                   metadata: {}
   *                   created_at: "2025-02-26T10:30:00.000Z"
   *                   updated_at: "2025-02-26T10:35:00.000Z"
   *               count: 1
   *       '500':
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               success: false
   *               error: "Failed to retrieve sessions"
   */
  // GET /api/sessions - 列出会话
  router.get('/', async (req, res) => {
    try {
      const options = {
        status: req.query.status,
        project_path: req.query.project_path,
        limit: req.query.limit ? parseInt(req.query.limit) : undefined,
      };

      const sessions = await sessionManager.listSessions(options);
      res.json({
        success: true,
        sessions,
        count: sessions.length,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // GET /api/sessions/search - 搜索会话
  router.get('/search', async (req, res) => {
    const validation = Validators.validateSearchQuery(req.query);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error,
      });
    }

    try {
      const options = {
        limit: req.query.limit ? parseInt(req.query.limit) : undefined,
      };

      const sessions = await sessionManager.searchSessions(validation.value.q, options);
      res.json({
        success: true,
        sessions,
        count: sessions.length,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * @swagger
   * /api/sessions/{id}:
   *   get:
   *     summary: Get session details
   *     description: |
   *       Retrieve detailed information about a specific session by its ID.
   *       Includes all session metadata, message counts, and cost tracking.
   *     tags: [Sessions]
   *     parameters:
   *       - name: id
   *         in: path
   *         description: Session UUID
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *         example: "550e8400-e29b-41d4-a716-446655440000"
   *     responses:
   *       '200':
   *         description: Session details retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 session:
   *                   $ref: '#/components/schemas/Session'
   *             example:
   *               success: true
   *               session:
   *                 id: "550e8400-e29b-41d4-a716-446655440000"
   *                 project_path: "/path/to/project"
   *                 model: "claude-sonnet-4-5"
   *                 messages_count: 5
   *                 total_cost_usd: 0.4875
   *                 status: "active"
   *                 metadata: {}
   *                 created_at: "2025-02-26T10:30:00.000Z"
   *                 updated_at: "2025-02-26T10:35:00.000Z"
   *       '404':
   *         description: Session not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               success: false
   *               error: "Session not found"
   *       '500':
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               success: false
   *               error: "Failed to retrieve session"
   */
  // GET /api/sessions/:id - 获取会话详情
  router.get('/:id', async (req, res) => {
    try {
      const session = await sessionManager.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({
          success: false,
          error: 'Session not found',
        });
      }

      res.json({
        success: true,
        session,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * @swagger
   * /api/sessions/{id}/continue:
   *   post:
   *     summary: Continue conversation in session
   *     description: |
   *       Send a follow-up prompt to continue a conversation in an existing session.
   *       The session maintains context from previous messages.
   *       Automatically updates message count and cost tracking.
   *     tags: [Sessions]
   *     parameters:
   *       - name: id
   *         in: path
   *         description: Session UUID
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *         example: "550e8400-e29b-41d4-a716-446655440000"
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - prompt
   *             properties:
   *               prompt:
   *                 type: string
   *                 description: The follow-up prompt to send
   *                 example: "Can you explain that in more detail?"
   *               system_prompt:
   *                 type: string
   *                 description: Optional system prompt override
   *                 example: "You are a helpful assistant."
   *               max_budget_usd:
   *                 type: number
   *                 format: float
   *                 description: Maximum budget for this request
   *                 example: 1.0
   *               allowed_tools:
   *                 type: array
   *                 items:
   *                   type: string
   *                 description: List of allowed tools
   *                 example: ["bash", "editor"]
   *               disallowed_tools:
   *                 type: array
   *                 items:
   *                   type: string
   *                 description: List of disallowed tools
   *                 example: ["web-search"]
   *           examples:
   *             simple:
   *               summary: Simple continuation
   *               value:
   *                 prompt: "Can you explain that in more detail?"
   *             withTools:
   *               summary: With tool restrictions
   *               value:
   *                 prompt: "Review this code"
   *                 allowed_tools: ["bash", "editor"]
   *                 max_budget_usd: 2.0
   *     responses:
   *       '200':
   *         description: Conversation continued successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 result:
   *                   type: string
   *                   description: Claude's response
   *                 session_id:
   *                   type: string
   *                   format: uuid
   *                   description: Session ID
   *                 duration_ms:
   *                   type: integer
   *                   description: Request duration in milliseconds
   *                 cost_usd:
   *                   type: number
   *                   format: float
   *                   description: Cost of this request in USD
   *             example:
   *               success: true
   *               result: "Certainly! Let me explain in more detail..."
   *               session_id: "550e8400-e29b-41d4-a716-446655440000"
   *               duration_ms: 2150
   *               cost_usd: 0.1075
   *       '400':
   *         description: Invalid request
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               success: false
   *               error: "prompt is required"
   *       '404':
   *         description: Session not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               success: false
   *               error: "Session not found"
   *       '500':
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               success: false
   *               error: "Failed to continue session"
   */
  // POST /api/sessions/:id/continue - 继续会话
  router.post('/:id/continue', async (req, res) => {
    const validation = Validators.validateSessionContinue(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error,
      });
    }

    try {
      const result = await sessionManager.continueSession(req.params.id, validation.value);

      if (result.success) {
        res.json(result);
      } else {
        res.status(500).json(result);
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * @swagger
   * /api/sessions/{id}/continue/stream:
   *   post:
   *     summary: Continue conversation with streaming output
   *     description: |
   *       Send a follow-up prompt and receive real-time SSE events as Claude processes the request.
   *       Returns Server-Sent Events (SSE) with JSON payloads.
   *     tags: [Sessions]
   *     parameters:
   *       - name: id
   *         in: path
   *         description: Session UUID
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [prompt]
   *             properties:
   *               prompt:
   *                 type: string
   *               system_prompt:
   *                 type: string
   *               max_budget_usd:
   *                 type: number
   *               allowed_tools:
   *                 type: array
   *                 items:
   *                   type: string
   *               disallowed_tools:
   *                 type: array
   *                 items:
   *                   type: string
   *     responses:
   *       '200':
   *         description: SSE stream
   *         content:
   *           text/event-stream:
   *             schema:
   *               type: string
   */
  // POST /api/sessions/:id/continue/stream - 流式继续会话
  router.post('/:id/continue/stream', async (req, res) => {
    const validation = Validators.validateSessionContinue(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error,
      });
    }

    try {
      // 检查会话是否存在
      const session = await sessionManager.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({
          success: false,
          error: 'Session not found',
        });
      }

      // 检查会话状态
      if (session.status !== 'active') {
        return res.status(400).json({
          success: false,
          error: `Session is not active: ${session.status}`,
        });
      }

      // 使用流式执行器
      const ClaudeStreamExecutor = require('../services/claudeStreamExecutor');
      const streamExecutor = new ClaudeStreamExecutor(
        sessionManager.config,
        sessionManager.sessionStore,
        sessionManager.statsStore,
        messageStore,  // 传递 messageStore
        streamManager,  // 传递 streamManager
        providerRouter   // 传递 providerRouter for load balancing
      );

      await streamExecutor.executeStream({
        prompt: validation.value.prompt,
        projectPath: session.project_path,
        sessionId: req.params.id,
        systemPrompt: validation.value.system_prompt,
        maxBudgetUsd: validation.value.max_budget_usd,
        allowedTools: validation.value.allowed_tools,
        disallowedTools: validation.value.disallowed_tools,
        permissionMode: validation.value.permission_mode,
        providerId: validation.value.provider_id,  // 传递 provider_id for forced provider selection
      }, res);

    } catch (error) {
      // 如果还没有发送headers，发送JSON错误
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      } else {
        // 已经开始流式输出，发送SSE错误
        res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      }
    }
  });

  /**
   * @swagger
   * /api/sessions/{id}/messages:
   *   get:
   *     summary: Get session message history
   *     description: |
   *       Retrieve message history for a specific session with cursor-based pagination.
   *       Supports both forward and backward pagination using before_id/after_id cursors.
   *     tags: [Sessions]
   *     parameters:
   *       - name: id
   *         in: path
   *         description: Session UUID
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *         example: "550e8400-e29b-41d4-a716-446655440000"
   *       - name: limit
   *         in: query
   *         description: Number of messages per page (max 100)
   *         required: false
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 100
   *           default: 20
   *         example: 20
   *       - name: before_id
   *         in: query
   *         description: Get messages before this message ID (for backward pagination)
   *         required: false
   *         schema:
   *           type: string
   *         example: "msg_abc123"
   *       - name: after_id
   *         in: query
   *         description: Get messages after this message ID (for forward pagination)
   *         required: false
   *         schema:
   *           type: string
   *         example: "msg_def456"
   *       - name: order
   *         in: query
   *         description: Sort order by time
   *         required: false
   *         schema:
   *           type: string
   *           enum: [asc, desc]
   *           default: desc
   *         example: "desc"
   *     responses:
   *       '200':
   *         description: Messages retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 session_id:
   *                   type: string
   *                   format: uuid
   *                 messages:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: string
   *                         example: "msg_abc123"
   *                       role:
   *                         type: string
   *                         enum: [user, assistant]
   *                       content:
   *                         type: string
   *                       created_at:
   *                         type: string
   *                         format: date-time
   *                       metadata:
   *                         type: object
   *                 pagination:
   *                   type: object
   *                   properties:
   *                     has_more:
   *                       type: boolean
   *                     first_id:
   *                       type: string
   *                     last_id:
   *                       type: string
   *                 count:
   *                   type: integer
   *       '404':
   *         description: Session not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       '500':
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  // GET /api/sessions/:id/messages - 获取会话消息历史
  router.get('/:id/messages', async (req, res) => {
    // 检查 messageStore 是否可用
    if (!messageStore) {
      return res.status(501).json({
        success: false,
        error: 'Message history feature is not available',
      });
    }

    try {
      // 检查 session 是否存在
      const session = await sessionManager.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({
          success: false,
          error: 'Session not found',
        });
      }

      // 解析分页参数
      const options = {
        limit: req.query.limit ? parseInt(req.query.limit) : 20,
        before_id: req.query.before_id,
        after_id: req.query.after_id,
        order: req.query.order || 'desc',
      };

      // 验证参数
      if (options.limit < 1 || options.limit > 100) {
        return res.status(400).json({
          success: false,
          error: 'limit must be between 1 and 100',
        });
      }

      if (!['asc', 'desc'].includes(options.order)) {
        return res.status(400).json({
          success: false,
          error: 'order must be asc or desc',
        });
      }

      const result = await messageStore.getMessages(req.params.id, options);

      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // GET /api/sessions/:id/stats - 获取会话统计
  router.get('/:id/stats', async (req, res) => {
    try {
      const stats = await sessionManager.getSessionStats(req.params.id);
      if (!stats) {
        return res.status(404).json({
          success: false,
          error: 'Session not found',
        });
      }

      res.json({
        success: true,
        stats,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * @swagger
   * /api/sessions/{id}/stream/status:
   *   get:
   *     summary: Check active stream status for session
   *     description: |
   *       Check if there's an active streaming task for this session.
   *       Returns stream details if an active stream exists.
   *     tags: [Sessions]
   *     parameters:
   *       - name: id
   *         in: path
   *         description: Session UUID
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       '200':
   *         description: Stream status retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 has_active_stream:
   *                   type: boolean
   *                 stream:
   *                   type: object
   *                   properties:
   *                     stream_id:
   *                       type: string
   *                     status:
   *                       type: string
   *                     content_length:
   *                       type: integer
   *                     started_at:
   *                       type: integer
   *       '404':
   *         description: Session not found
   *       '501':
   *         description: Stream resume feature not available
   */
  // GET /api/sessions/:id/stream/status - 检查会话的活跃流状态
  router.get('/:id/stream/status', async (req, res) => {
    // 检查 streamManager 是否可用
    if (!streamManager) {
      return res.status(501).json({
        success: false,
        error: 'Stream resume feature is not available',
      });
    }

    try {
      // 检查会话是否存在
      const session = await sessionManager.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({
          success: false,
          error: 'Session not found',
        });
      }

      // 获取该会话的活跃流
      const activeStream = streamManager.getStreamBySession(req.params.id);

      if (!activeStream) {
        return res.json({
          success: true,
          has_active_stream: false,
        });
      }

      // 返回活跃流信息
      res.json({
        success: true,
        has_active_stream: true,
        stream: {
          stream_id: activeStream.stream_id,
          status: activeStream.status,
          content_length: activeStream.content.length,
          started_at: activeStream.started_at,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * @swagger
   * /api/sessions/{id}/stream/resume:
   *   get:
   *     summary: Resume or reconnect to a stream
   *     description: |
   *       Reconnect to an active or completed stream.
   *       For completed streams, returns full content as JSON.
   *       For ongoing streams, returns SSE stream with resumed content.
   *     tags: [Sessions]
   *     parameters:
   *       - name: id
   *         in: path
   *         description: Session UUID
   *         required: true
   *         schema:
   *           type: string
   *       - name: stream_id
   *         in: query
   *         description: The stream ID to resume
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       '200':
   *         description: Stream resumed successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 status:
   *                   type: string
   *                 stream_id:
   *                   type: string
   *                 content:
   *                   type: string
   *                 metadata:
   *                   type: object
   *           text/event-stream:
   *             schema:
   *               type: string
   *               description: SSE stream for ongoing streams
   *       '400':
   *         description: Invalid request (missing stream_id or stream belongs to different session)
   *       '404':
   *         description: Session or stream not found
   *       '501':
   *         description: Stream resume feature not available
   */
  // GET /api/sessions/:id/stream/resume - 恢复或重连流
  router.get('/:id/stream/resume', async (req, res) => {
    // 检查 streamManager 是否可用
    if (!streamManager) {
      return res.status(501).json({
        success: false,
        error: 'Stream resume feature is not available',
      });
    }

    const { stream_id: streamId } = req.query;

    // 验证 stream_id 参数
    if (!streamId) {
      return res.status(400).json({
        success: false,
        error: 'stream_id is required',
      });
    }

    try {
      // 检查会话是否存在
      const session = await sessionManager.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({
          success: false,
          error: 'Session not found',
        });
      }

      // 获取流
      const stream = streamManager.getStream(streamId);
      if (!stream) {
        return res.status(404).json({
          success: false,
          error: 'Stream not found',
        });
      }

      // 验证流属于该会话
      if (stream.session_id !== req.params.id) {
        return res.status(400).json({
          success: false,
          error: 'Stream does not belong to this session',
        });
      }

      // 如果流已完成，返回完整内容
      if (stream.status === 'completed') {
        return res.json({
          success: true,
          status: 'completed',
          stream_id: streamId,
          content: stream.content,
          metadata: stream.metadata,
        });
      }

      // 对于正在进行的流，返回 SSE 流
      // 设置 SSE 响应头
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Session-Id', req.params.id);
      res.setHeader('X-Stream-Id', streamId);
      res.flushHeaders();

      // 发送已累积的内容
      const resumedEvent = {
        type: 'resumed',
        content: stream.content,
      };
      res.write(`event: message\ndata: ${JSON.stringify(resumedEvent)}\n\n`);

      // 添加客户端到流
      streamManager.addClient(streamId, res);

      // 处理客户端断开连接
      res.on('close', () => {
        streamManager.removeClient(streamId, res);
      });
    } catch (error) {
      // 如果还没有发送headers，发送JSON错误
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      } else {
        // 已经开始流式输出，发送SSE错误
        res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      }
    }
  });

  /**
   * @swagger
   * /api/sessions/{id}:
   *   delete:
   *     summary: Delete a session
   *     description: |
   *       Permanently delete a session and all its associated data.
   *       This action cannot be undone. Use with caution.
   *       All conversation history and metadata will be removed.
   *     tags: [Sessions]
   *     parameters:
   *       - name: id
   *         in: path
   *         description: Session UUID
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *         example: "550e8400-e29b-41d4-a716-446655440000"
   *     responses:
   *       '200':
   *         description: Session deleted successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 message:
   *                   type: string
   *                   example: "Session deleted successfully"
   *             example:
   *               success: true
   *               message: "Session deleted successfully"
   *       '404':
   *         description: Session not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               success: false
   *               error: "Session not found"
   *       '500':
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               success: false
   *               error: "Failed to delete session"
   */
  // DELETE /api/sessions/:id - 删除会话
  router.delete('/:id', async (req, res) => {
    try {
      const result = await sessionManager.deleteSession(req.params.id);
      if (result.success) {
        res.json(result);
      } else {
        res.status(404).json(result);
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // PATCH /api/sessions/:id/status - 更新会话状态
  router.patch('/:id/status', async (req, res) => {
    const { status } = req.body;

    if (!status || !['active', 'archived', 'closed'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Must be: active, archived, or closed',
      });
    }

    try {
      const result = await sessionManager.updateSessionStatus(req.params.id, status);
      if (result.success) {
        res.json(result);
      } else {
        res.status(404).json(result);
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  return router;
}

module.exports = createSessionRoutes;
