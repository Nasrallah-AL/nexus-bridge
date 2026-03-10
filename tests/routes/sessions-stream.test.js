const express = require('express');
const request = require('supertest');
const createSessionRoutes = require('../../src/routes/sessions');
const StreamManager = require('../../src/services/streamManager');

describe('Sessions Stream Routes', () => {
  let app;
  let mockSessionManager;
  let mockMessageStore;
  let streamManager;

  beforeEach(() => {
    streamManager = new StreamManager();

    mockSessionManager = {
      config: {
        workspacePath: '/workspace',
      },
      getSession: jest.fn(),
      createSession: jest.fn(),
      listSessions: jest.fn(),
      continueSession: jest.fn(),
      deleteSession: jest.fn(),
      updateSessionStatus: jest.fn(),
      getSessionStats: jest.fn(),
      searchSessions: jest.fn(),
      sessionStore: {
        get: jest.fn(),
      },
      statsStore: {
        recordRequest: jest.fn(),
      },
    };

    mockMessageStore = {
      getMessages: jest.fn(),
      addMessage: jest.fn(),
      getStreamingMessage: jest.fn(),
    };

    app = express();
    app.use(express.json());
    app.use('/api/sessions', createSessionRoutes(mockSessionManager, mockMessageStore, streamManager));
  });

  describe('GET /api/sessions/:id/stream/status', () => {
    const sessionId = 'test-session-123';

    test('should return has_active_stream: false when no stream exists', async () => {
      mockSessionManager.getSession.mockResolvedValue({
        id: sessionId,
        status: 'active',
      });

      const response = await request(app)
        .get(`/api/sessions/${sessionId}/stream/status`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.has_active_stream).toBe(false);
    });

    test('should return has_active_stream: true when stream exists', async () => {
      mockSessionManager.getSession.mockResolvedValue({
        id: sessionId,
        status: 'active',
      });

      // Register an active stream
      const mockProcess = { pid: 12345, kill: jest.fn() };
      const streamId = streamManager.registerStream(sessionId, mockProcess);

      const response = await request(app)
        .get(`/api/sessions/${sessionId}/stream/status`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.has_active_stream).toBe(true);
      expect(response.body.stream).toBeDefined();
      expect(response.body.stream.stream_id).toBe(streamId);
      expect(response.body.stream.status).toBe('streaming');
      expect(response.body.stream.started_at).toBeDefined();
    });

    test('should return stream content_length', async () => {
      mockSessionManager.getSession.mockResolvedValue({
        id: sessionId,
        status: 'active',
      });

      // Register an active stream and add content
      const mockProcess = { pid: 12345, kill: jest.fn() };
      const streamId = streamManager.registerStream(sessionId, mockProcess);
      streamManager.updateContent(streamId, 'Hello World');

      const response = await request(app)
        .get(`/api/sessions/${sessionId}/stream/status`);

      expect(response.status).toBe(200);
      expect(response.body.has_active_stream).toBe(true);
      expect(response.body.stream.content_length).toBe(11);
    });

    test('should return 404 when session not found', async () => {
      mockSessionManager.getSession.mockResolvedValue(null);

      const response = await request(app)
        .get(`/api/sessions/${sessionId}/stream/status`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Session not found');
    });

    test('should return 501 when streamManager not available', async () => {
      // Create app without streamManager
      const appWithoutStreamManager = express();
      appWithoutStreamManager.use(express.json());
      appWithoutStreamManager.use('/api/sessions', createSessionRoutes(mockSessionManager, mockMessageStore, null));

      mockSessionManager.getSession.mockResolvedValue({
        id: sessionId,
        status: 'active',
      });

      const response = await request(appWithoutStreamManager)
        .get(`/api/sessions/${sessionId}/stream/status`);

      expect(response.status).toBe(501);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Stream resume feature is not available');
    });
  });

  describe('GET /api/sessions/:id/stream/resume', () => {
    const sessionId = 'test-session-123';

    test('should return 400 when stream_id is missing', async () => {
      const response = await request(app)
        .get(`/api/sessions/${sessionId}/stream/resume`);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('stream_id is required');
    });

    test('should return 404 when session not found', async () => {
      mockSessionManager.getSession.mockResolvedValue(null);

      const response = await request(app)
        .get(`/api/sessions/${sessionId}/stream/resume?stream_id=stream_abc`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Session not found');
    });

    test('should return 404 when stream not found', async () => {
      mockSessionManager.getSession.mockResolvedValue({
        id: sessionId,
        status: 'active',
      });

      const response = await request(app)
        .get(`/api/sessions/${sessionId}/stream/resume?stream_id=stream_nonexistent`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Stream not found');
    });

    test('should return completed stream content as JSON', async () => {
      mockSessionManager.getSession.mockResolvedValue({
        id: sessionId,
        status: 'active',
      });

      // Register and complete a stream
      const mockProcess = { pid: 12345, kill: jest.fn() };
      const streamId = streamManager.registerStream(sessionId, mockProcess);
      streamManager.updateContent(streamId, 'Full content here');
      streamManager.completeStream(streamId, { cost_usd: 0.01, duration_ms: 1000 });

      const response = await request(app)
        .get(`/api/sessions/${sessionId}/stream/resume?stream_id=${streamId}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.status).toBe('completed');
      expect(response.body.stream_id).toBe(streamId);
      expect(response.body.content).toBe('Full content here');
      expect(response.body.metadata).toBeDefined();
      expect(response.body.metadata.cost_usd).toBe(0.01);
    });

    test('should return SSE stream for ongoing stream', async () => {
      mockSessionManager.getSession.mockResolvedValue({
        id: sessionId,
        status: 'active',
      });

      // Register an active stream (not completed)
      const mockProcess = { pid: 12345, kill: jest.fn() };
      const streamId = streamManager.registerStream(sessionId, mockProcess);
      streamManager.updateContent(streamId, 'Accumulated content');

      // For SSE streams, we use the parse option to intercept headers
      // and abort immediately after checking them
      const response = await request(app)
        .get(`/api/sessions/${sessionId}/stream/resume?stream_id=${streamId}`)
        .buffer(false)
        .parse((res, callback) => {
          // This is called when headers are received
          // Check headers immediately
          try {
            expect(res.statusCode).toBe(200);
            expect(res.headers['content-type']).toBe('text/event-stream');
            expect(res.headers['x-session-id']).toBe(sessionId);
            expect(res.headers['x-stream-id']).toBe(streamId);
          } finally {
            // Destroy the response to close the connection
            res.destroy();
            callback(null, {});
          }
        });

      // The request should complete (even though we aborted)
      expect(response.status).toBeDefined();
    });

    test('should return 501 when streamManager not available', async () => {
      // Create app without streamManager
      const appWithoutStreamManager = express();
      appWithoutStreamManager.use(express.json());
      appWithoutStreamManager.use('/api/sessions', createSessionRoutes(mockSessionManager, mockMessageStore, null));

      mockSessionManager.getSession.mockResolvedValue({
        id: sessionId,
        status: 'active',
      });

      const response = await request(appWithoutStreamManager)
        .get(`/api/sessions/${sessionId}/stream/resume?stream_id=stream_abc`);

      expect(response.status).toBe(501);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Stream resume feature is not available');
    });

    test('should return 400 when stream belongs to different session', async () => {
      mockSessionManager.getSession.mockResolvedValue({
        id: sessionId,
        status: 'active',
      });

      // Register stream for a different session
      const mockProcess = { pid: 12345, kill: jest.fn() };
      const streamId = streamManager.registerStream('different-session', mockProcess);

      const response = await request(app)
        .get(`/api/sessions/${sessionId}/stream/resume?stream_id=${streamId}`);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Stream does not belong to this session');
    });
  });

  describe('createSessionRoutes signature', () => {
    test('should accept streamManager as third parameter', () => {
      // This test verifies the function signature accepts three parameters
      const router = createSessionRoutes(mockSessionManager, mockMessageStore, streamManager);
      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });

    test('should work without streamManager (backward compatibility)', () => {
      const router = createSessionRoutes(mockSessionManager, mockMessageStore, null);
      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });
  });
});
