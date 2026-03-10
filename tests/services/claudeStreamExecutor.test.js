const ClaudeStreamExecutor = require('../../src/services/claudeStreamExecutor');
const StreamManager = require('../../src/services/streamManager');
const EventEmitter = require('events');

// Mock child_process
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

// Mock logger
jest.mock('../../src/utils/logger', () => () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('ClaudeStreamExecutor', () => {
  let executor;
  let mockConfig;
  let mockSessionStore;
  let mockStatsStore;
  let mockMessageStore;
  let mockStreamManager;
  let mockSpawn;

  beforeEach(() => {
    jest.clearAllMocks();

    mockConfig = {
      logFile: '/tmp/test.log',
      logLevel: 'debug',
      claudePath: '/usr/local/bin/claude',
      nodeBinDir: '/usr/local/bin',
      defaultModel: 'claude-3-sonnet-20240229',
    };

    mockSessionStore = {
      get: jest.fn(),
      addCost: jest.fn(),
      incrementMessages: jest.fn(),
    };

    mockStatsStore = {
      recordRequest: jest.fn(),
    };

    mockMessageStore = {
      addMessage: jest.fn().mockResolvedValue({ id: 'msg_test123' }),
      addStreamingMessage: jest.fn().mockResolvedValue({
        id: 'streaming_msg_123',
        status: 'streaming',
        metadata: { stream_id: 'stream_abc123' },
      }),
      updateStreamingContent: jest.fn().mockResolvedValue(true),
      completeStreamingMessage: jest.fn().mockResolvedValue({
        id: 'streaming_msg_123',
        status: 'completed',
      }),
    };

    mockStreamManager = {
      generateStreamId: jest.fn().mockReturnValue('stream_abc123'),
      registerStream: jest.fn(),
      addClient: jest.fn(),
      removeClient: jest.fn(),
      broadcast: jest.fn(),
      completeStream: jest.fn(),
      getStream: jest.fn(),
    };

    mockSpawn = require('child_process').spawn;

    executor = new ClaudeStreamExecutor(
      mockConfig,
      mockSessionStore,
      mockStatsStore,
      mockMessageStore,
      mockStreamManager
    );
  });

  describe('constructor', () => {
    test('should accept streamManager parameter', () => {
      expect(executor.streamManager).toBe(mockStreamManager);
    });

    test('should work without streamManager (backward compatibility)', () => {
      const executorNoStream = new ClaudeStreamExecutor(
        mockConfig,
        mockSessionStore,
        mockStatsStore,
        mockMessageStore,
        null
      );
      expect(executorNoStream.streamManager).toBeNull();
    });
  });

  describe('setupSSEResponse', () => {
    test('should set SSE headers with sessionId', () => {
      const mockRes = {
        setHeader: jest.fn(),
        flushHeaders: jest.fn(),
      };

      executor.setupSSEResponse(mockRes, 'session-123');

      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Session-Id', 'session-123');
      expect(mockRes.flushHeaders).toHaveBeenCalled();
    });

    test('should set X-Stream-Id header when streamId is provided', () => {
      const mockRes = {
        setHeader: jest.fn(),
        flushHeaders: jest.fn(),
      };

      executor.setupSSEResponse(mockRes, 'session-123', 'stream_abc123');

      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Stream-Id', 'stream_abc123');
    });

    test('should NOT set X-Stream-Id header when streamId is null', () => {
      const mockRes = {
        setHeader: jest.fn(),
        flushHeaders: jest.fn(),
      };

      executor.setupSSEResponse(mockRes, 'session-123', null);

      const calls = mockRes.setHeader.mock.calls;
      const streamIdCalls = calls.filter(call => call[0] === 'X-Stream-Id');
      expect(streamIdCalls.length).toBe(0);
    });
  });

  describe('executeStream with streamManager', () => {
    let mockRes;
    let mockChildProcess;

    beforeEach(() => {
      mockRes = {
        setHeader: jest.fn(),
        flushHeaders: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn(),
      };

      mockChildProcess = new EventEmitter();
      mockChildProcess.stdout = new EventEmitter();
      mockChildProcess.stderr = new EventEmitter();
      mockChildProcess.kill = jest.fn();

      mockSpawn.mockReturnValue(mockChildProcess);
    });

    test('should generate streamId when streamManager is available', async () => {
      mockSessionStore.get.mockResolvedValue(null);

      const options = {
        prompt: 'Hello',
        projectPath: '/tmp/test',
        model: 'claude-3-sonnet-20240229',
        sessionId: 'session-123',
      };

      // Start executeStream but don't await it completely
      const executePromise = executor.executeStream(options, mockRes);

      // Wait a bit for async operations
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockStreamManager.generateStreamId).toHaveBeenCalled();
    });

    test('should create streaming message when streamManager is available', async () => {
      mockSessionStore.get.mockResolvedValue(null);
      mockMessageStore.addStreamingMessage.mockResolvedValue({
        id: 'streaming_msg_456',
        status: 'streaming',
        metadata: { stream_id: 'stream_xyz789' },
      });

      const options = {
        prompt: 'Hello',
        projectPath: '/tmp/test',
        model: 'claude-3-sonnet-20240229',
        sessionId: 'session-123',
      };

      executor.executeStream(options, mockRes);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockMessageStore.addStreamingMessage).toHaveBeenCalledWith(
        'session-123',
        expect.objectContaining({
          stream_id: 'stream_abc123',
          model: 'claude-3-sonnet-20240229',
        })
      );
    });

    test('should call spawnStreamCommand with streamId and streamingMessageId', async () => {
      mockSessionStore.get.mockResolvedValue(null);

      const spy = jest.spyOn(executor, 'spawnStreamCommand');

      const options = {
        prompt: 'Hello',
        projectPath: '/tmp/test',
        model: 'claude-3-sonnet-20240229',
        sessionId: 'session-123',
      };

      executor.executeStream(options, mockRes);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(spy).toHaveBeenCalledWith(
        '/tmp/test',
        expect.any(Array),
        mockRes,
        expect.any(Number),
        'session-123',
        'claude-3-sonnet-20240229',
        'stream_abc123',
        'streaming_msg_123'
      );
    });

    test('should pass null for streamId when streamManager is null', async () => {
      const executorNoStream = new ClaudeStreamExecutor(
        mockConfig,
        mockSessionStore,
        mockStatsStore,
        mockMessageStore,
        null
      );

      mockSessionStore.get.mockResolvedValue(null);

      const spy = jest.spyOn(executorNoStream, 'spawnStreamCommand');

      const options = {
        prompt: 'Hello',
        projectPath: '/tmp/test',
        model: 'claude-3-sonnet-20240229',
        sessionId: 'session-123',
      };

      executorNoStream.executeStream(options, mockRes);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(spy).toHaveBeenCalledWith(
        '/tmp/test',
        expect.any(Array),
        mockRes,
        expect.any(Number),
        'session-123',
        'claude-3-sonnet-20240229',
        null,
        null
      );
    });
  });

  describe('spawnStreamCommand with stream continuation', () => {
    let mockRes;
    let mockChildProcess;

    beforeEach(() => {
      mockRes = {
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            mockRes._closeCallback = callback;
          }
        }),
      };

      mockChildProcess = new EventEmitter();
      mockChildProcess.stdout = new EventEmitter();
      mockChildProcess.stderr = new EventEmitter();
      mockChildProcess.kill = jest.fn();

      mockSpawn.mockReturnValue(mockChildProcess);
    });

    test('should register stream with streamManager', () => {
      const args = ['-p', 'Hello', '--output-format', 'stream-json'];

      executor.spawnStreamCommand(
        '/tmp/test',
        args,
        mockRes,
        Date.now(),
        'session-123',
        'claude-3-sonnet-20240229',
        'stream_abc123',
        'streaming_msg_123'
      );

      expect(mockStreamManager.registerStream).toHaveBeenCalledWith(
        'session-123',
        mockChildProcess,
        'stream_abc123'
      );
    });

    test('should add client to streamManager', () => {
      const args = ['-p', 'Hello', '--output-format', 'stream-json'];

      executor.spawnStreamCommand(
        '/tmp/test',
        args,
        mockRes,
        Date.now(),
        'session-123',
        'claude-3-sonnet-20240229',
        'stream_abc123',
        'streaming_msg_123'
      );

      expect(mockStreamManager.addClient).toHaveBeenCalledWith('stream_abc123', mockRes);
    });

    test('should NOT kill process on client disconnect when streamManager is present', () => {
      const args = ['-p', 'Hello', '--output-format', 'stream-json'];

      executor.spawnStreamCommand(
        '/tmp/test',
        args,
        mockRes,
        Date.now(),
        'session-123',
        'claude-3-sonnet-20240229',
        'stream_abc123',
        'streaming_msg_123'
      );

      // Simulate client disconnect
      mockRes._closeCallback();

      // Should remove client, not kill process
      expect(mockStreamManager.removeClient).toHaveBeenCalledWith('stream_abc123', mockRes);
      expect(mockChildProcess.kill).not.toHaveBeenCalled();
    });

    test('should kill process on client disconnect when streamManager is null', () => {
      const executorNoStream = new ClaudeStreamExecutor(
        mockConfig,
        mockSessionStore,
        mockStatsStore,
        mockMessageStore,
        null
      );

      const args = ['-p', 'Hello', '--output-format', 'stream-json'];

      executorNoStream.spawnStreamCommand(
        '/tmp/test',
        args,
        mockRes,
        Date.now(),
        'session-123',
        'claude-3-sonnet-20240229',
        null,
        null
      );

      // Simulate client disconnect
      mockRes._closeCallback();

      expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    test('should broadcast via streamManager on stdout data', () => {
      const args = ['-p', 'Hello', '--output-format', 'stream-json'];

      executor.spawnStreamCommand(
        '/tmp/test',
        args,
        mockRes,
        Date.now(),
        'session-123',
        'claude-3-sonnet-20240229',
        'stream_abc123',
        'streaming_msg_123'
      );

      const jsonData = { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello response' }] } };
      mockChildProcess.stdout.emit('data', Buffer.from(JSON.stringify(jsonData) + '\n'));

      expect(mockStreamManager.broadcast).toHaveBeenCalledWith(
        'stream_abc123',
        'message',
        jsonData
      );
    });

    test('should update streaming content on stdout data', () => {
      const args = ['-p', 'Hello', '--output-format', 'stream-json'];

      executor.spawnStreamCommand(
        '/tmp/test',
        args,
        mockRes,
        Date.now(),
        'session-123',
        'claude-3-sonnet-20240229',
        'stream_abc123',
        'streaming_msg_123'
      );

      const jsonData = { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello response' }] } };
      mockChildProcess.stdout.emit('data', Buffer.from(JSON.stringify(jsonData) + '\n'));

      expect(mockMessageStore.updateStreamingContent).toHaveBeenCalledWith(
        'session-123',
        'streaming_msg_123',
        'Hello response'
      );
    });

    test('should call streamManager.completeStream on process complete', async () => {
      const args = ['-p', 'Hello', '--output-format', 'stream-json'];

      executor.spawnStreamCommand(
        '/tmp/test',
        args,
        mockRes,
        Date.now(),
        'session-123',
        'claude-3-sonnet-20240229',
        'stream_abc123',
        'streaming_msg_123'
      );

      // Emit close with code 0 (success)
      mockChildProcess.emit('close', 0);

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockStreamManager.completeStream).toHaveBeenCalledWith(
        'stream_abc123',
        expect.objectContaining({
          cost_usd: expect.any(Number),
          duration_ms: expect.any(Number),
        })
      );
    });

    test('should call messageStore.completeStreamingMessage on process complete', async () => {
      const args = ['-p', 'Hello', '--output-format', 'stream-json'];

      executor.spawnStreamCommand(
        '/tmp/test',
        args,
        mockRes,
        Date.now(),
        'session-123',
        'claude-3-sonnet-20240229',
        'stream_abc123',
        'streaming_msg_123'
      );

      // Emit close with code 0 (success)
      mockChildProcess.emit('close', 0);

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockMessageStore.completeStreamingMessage).toHaveBeenCalledWith(
        'session-123',
        'streaming_msg_123',
        expect.objectContaining({
          cost_usd: expect.any(Number),
          duration_ms: expect.any(Number),
        })
      );
    });

    test('should NOT call streamManager methods when streamId is null', async () => {
      const executorNoStream = new ClaudeStreamExecutor(
        mockConfig,
        mockSessionStore,
        mockStatsStore,
        mockMessageStore,
        null
      );

      const args = ['-p', 'Hello', '--output-format', 'stream-json'];

      executorNoStream.spawnStreamCommand(
        '/tmp/test',
        args,
        mockRes,
        Date.now(),
        'session-123',
        'claude-3-sonnet-20240229',
        null,
        null
      );

      const jsonData = { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } };
      mockChildProcess.stdout.emit('data', Buffer.from(JSON.stringify(jsonData) + '\n'));

      mockChildProcess.emit('close', 0);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockStreamManager.registerStream).not.toHaveBeenCalled();
      expect(mockStreamManager.addClient).not.toHaveBeenCalled();
      expect(mockStreamManager.broadcast).not.toHaveBeenCalled();
      expect(mockStreamManager.completeStream).not.toHaveBeenCalled();
    });
  });

  describe('backward compatibility', () => {
    let mockRes;
    let mockChildProcess;

    beforeEach(() => {
      mockRes = {
        setHeader: jest.fn(),
        flushHeaders: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            mockRes._closeCallback = callback;
          }
        }),
      };

      mockChildProcess = new EventEmitter();
      mockChildProcess.stdout = new EventEmitter();
      mockChildProcess.stderr = new EventEmitter();
      mockChildProcess.kill = jest.fn();

      mockSpawn.mockReturnValue(mockChildProcess);
    });

    test('should work without streamManager (legacy behavior)', async () => {
      const executorNoStream = new ClaudeStreamExecutor(
        mockConfig,
        mockSessionStore,
        mockStatsStore,
        mockMessageStore,
        null
      );

      mockSessionStore.get.mockResolvedValue(null);

      const options = {
        prompt: 'Hello',
        projectPath: '/tmp/test',
        model: 'claude-3-sonnet-20240229',
        sessionId: 'session-123',
      };

      executorNoStream.executeStream(options, mockRes);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Should NOT call streamManager methods
      expect(mockStreamManager.registerStream).not.toHaveBeenCalled();
      expect(mockStreamManager.addClient).not.toHaveBeenCalled();

      // Should still spawn the process
      expect(mockSpawn).toHaveBeenCalled();
    });

    test('should not call addStreamingMessage when streamManager is null', async () => {
      const executorNoStream = new ClaudeStreamExecutor(
        mockConfig,
        mockSessionStore,
        mockStatsStore,
        mockMessageStore,
        null
      );

      mockSessionStore.get.mockResolvedValue(null);

      const options = {
        prompt: 'Hello',
        projectPath: '/tmp/test',
        model: 'claude-3-sonnet-20240229',
        sessionId: 'session-123',
      };

      executorNoStream.executeStream(options, mockRes);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockMessageStore.addStreamingMessage).not.toHaveBeenCalled();
    });
  });
});
