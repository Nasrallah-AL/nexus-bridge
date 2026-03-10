const StreamManager = require('../../src/services/streamManager');

describe('StreamManager', () => {
  let streamManager;

  beforeEach(() => {
    streamManager = new StreamManager();
  });

  describe('registerStream', () => {
    test('should register a new stream and return stream_id', () => {
      const sessionId = 'test-session-123';
      const mockProcess = { pid: 12345, kill: jest.fn() };

      const streamId = streamManager.registerStream(sessionId, mockProcess);

      expect(streamId).toBeDefined();
      expect(typeof streamId).toBe('string');
      expect(streamManager.activeStreams.has(streamId)).toBe(true);
    });

    test('should store session_id and childProcess', () => {
      const sessionId = 'test-session-123';
      const mockProcess = { pid: 12345, kill: jest.fn() };

      const streamId = streamManager.registerStream(sessionId, mockProcess);
      const stream = streamManager.activeStreams.get(streamId);

      expect(stream.session_id).toBe(sessionId);
      expect(stream.childProcess).toBe(mockProcess);
      expect(stream.content).toBe('');
      expect(stream.clients).toEqual([]);
    });
  });

  describe('getStream', () => {
    test('should return stream by stream_id', () => {
      const mockProcess = { pid: 12345, kill: jest.fn() };
      const streamId = streamManager.registerStream('session-1', mockProcess);

      const stream = streamManager.getStream(streamId);

      expect(stream).toBeDefined();
      expect(stream.session_id).toBe('session-1');
    });

    test('should return undefined for non-existent stream_id', () => {
      const stream = streamManager.getStream('non-existent');
      expect(stream).toBeUndefined();
    });
  });

  describe('getStreamBySession', () => {
    test('should return active stream by session_id', () => {
      const mockProcess = { pid: 12345, kill: jest.fn() };
      const streamId = streamManager.registerStream('session-1', mockProcess);

      const stream = streamManager.getStreamBySession('session-1');

      expect(stream).toBeDefined();
      expect(stream.stream_id).toBe(streamId);
    });

    test('should return null if no active stream for session', () => {
      const stream = streamManager.getStreamBySession('no-stream-session');
      expect(stream).toBeNull();
    });
  });

  describe('updateContent', () => {
    test('should append content to stream', () => {
      const mockProcess = { pid: 12345, kill: jest.fn() };
      const streamId = streamManager.registerStream('session-1', mockProcess);

      streamManager.updateContent(streamId, 'Hello ');
      streamManager.updateContent(streamId, 'World');

      const stream = streamManager.getStream(streamId);
      expect(stream.content).toBe('Hello World');
    });
  });

  describe('completeStream', () => {
    test('should mark stream as completed', () => {
      const mockProcess = { pid: 12345, kill: jest.fn() };
      const streamId = streamManager.registerStream('session-1', mockProcess);

      streamManager.completeStream(streamId, { cost_usd: 0.01 });

      const stream = streamManager.getStream(streamId);
      expect(stream.status).toBe('completed');
      expect(stream.metadata.cost_usd).toBe(0.01);
    });
  });

  describe('addClient / removeClient', () => {
    test('should add client to stream', () => {
      const mockProcess = { pid: 12345, kill: jest.fn() };
      const streamId = streamManager.registerStream('session-1', mockProcess);
      const mockRes = { write: jest.fn(), end: jest.fn() };

      streamManager.addClient(streamId, mockRes);

      const stream = streamManager.getStream(streamId);
      expect(stream.clients).toContain(mockRes);
    });

    test('should remove client from stream', () => {
      const mockProcess = { pid: 12345, kill: jest.fn() };
      const streamId = streamManager.registerStream('session-1', mockProcess);
      const mockRes = { write: jest.fn(), end: jest.fn() };

      streamManager.addClient(streamId, mockRes);
      streamManager.removeClient(streamId, mockRes);

      const stream = streamManager.getStream(streamId);
      expect(stream.clients).not.toContain(mockRes);
    });
  });

  describe('broadcast', () => {
    test('should send SSE event to all clients', () => {
      const mockProcess = { pid: 12345, kill: jest.fn() };
      const streamId = streamManager.registerStream('session-1', mockProcess);
      const mockRes1 = { write: jest.fn(), end: jest.fn() };
      const mockRes2 = { write: jest.fn(), end: jest.fn() };

      streamManager.addClient(streamId, mockRes1);
      streamManager.addClient(streamId, mockRes2);
      streamManager.broadcast(streamId, 'message', { text: 'hello' });

      expect(mockRes1.write).toHaveBeenCalledWith(expect.stringContaining('event: message'));
      expect(mockRes2.write).toHaveBeenCalledWith(expect.stringContaining('event: message'));
    });
  });

  describe('killStream', () => {
    test('should kill child process and remove stream', () => {
      const mockProcess = { pid: 12345, kill: jest.fn() };
      const streamId = streamManager.registerStream('session-1', mockProcess);

      streamManager.killStream(streamId);

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(streamManager.activeStreams.has(streamId)).toBe(false);
    });
  });

  describe('cleanupCompletedStreams', () => {
    test('should remove completed streams older than maxAge', () => {
      const mockProcess = { pid: 12345, kill: jest.fn() };
      const streamId = streamManager.registerStream('session-1', mockProcess);

      // Complete the stream
      streamManager.completeStream(streamId, {});

      // Set completed_at to 2 hours ago
      const stream = streamManager.getStream(streamId);
      stream.completed_at = Date.now() - 7200000; // 2 hours ago

      // Cleanup with 1 hour max age
      streamManager.cleanupCompletedStreams(3600000);

      expect(streamManager.activeStreams.has(streamId)).toBe(false);
    });

    test('should keep recently completed streams', () => {
      const mockProcess = { pid: 12345, kill: jest.fn() };
      const streamId = streamManager.registerStream('session-1', mockProcess);

      streamManager.completeStream(streamId, {});

      // Cleanup with 1 hour max age
      streamManager.cleanupCompletedStreams(3600000);

      expect(streamManager.activeStreams.has(streamId)).toBe(true);
    });
  });
});
