const fs = require('fs');
const path = require('path');
const os = require('os');
const MessageStore = require('../../src/storage/messageStore');

describe('MessageStore', () => {
  let testDir;
  let messageStore;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = path.join(os.tmpdir(), `messagestore-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });

    // Create a MessageStore instance
    messageStore = new MessageStore(testDir);
    await messageStore.init();
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('addMessage', () => {
    test('should add a message to a session', async () => {
      const sessionId = 'test-session-123';
      const message = {
        role: 'user',
        content: 'Hello, world!',
        metadata: { source: 'test' }
      };

      const result = await messageStore.addMessage(sessionId, message);

      expect(result.id).toBeDefined();
      expect(result.id).toMatch(/^msg_/);
      expect(result.session_id).toBe(sessionId);
      expect(result.role).toBe('user');
      expect(result.content).toBe('Hello, world!');
      expect(result.created_at).toBeDefined();
      expect(result.metadata).toEqual({ source: 'test' });
    });
  });

  describe('getMessages', () => {
    test('should get messages with pagination', async () => {
      const sessionId = 'test-session-456';

      // Add some messages
      await messageStore.addMessage(sessionId, { role: 'user', content: 'Message 1' });
      await messageStore.addMessage(sessionId, { role: 'assistant', content: 'Message 2' });

      const result = await messageStore.getMessages(sessionId, { limit: 10 });

      expect(result.messages.length).toBe(2);
      expect(result.count).toBe(2);
      expect(result.pagination.has_more).toBe(false);
    });
  });

  describe('Streaming Message Support', () => {
    describe('addStreamingMessage', () => {
      test('should create a streaming message with status "streaming"', async () => {
        const sessionId = 'stream-session-123';
        const options = {
          stream_id: 'stream_abc123',
          model: 'claude-3-opus'
        };

        const message = await messageStore.addStreamingMessage(sessionId, options);

        expect(message.id).toBeDefined();
        expect(message.id).toMatch(/^msg_/);
        expect(message.session_id).toBe(sessionId);
        expect(message.role).toBe('assistant');
        expect(message.content).toBe('');
        expect(message.status).toBe('streaming');
        expect(message.created_at).toBeDefined();
        expect(message.metadata.stream_id).toBe('stream_abc123');
        expect(message.metadata.model).toBe('claude-3-opus');
        expect(message.metadata.started_at).toBeDefined();
        expect(message.metadata.completed_at).toBeNull();
        expect(message.metadata.cost_usd).toBeNull();
        expect(message.metadata.duration_ms).toBeNull();
      });

      test('should generate stream_id if not provided', async () => {
        const sessionId = 'stream-session-456';
        const options = {
          model: 'claude-3-opus'
        };

        const message = await messageStore.addStreamingMessage(sessionId, options);

        expect(message.metadata.stream_id).toBeDefined();
        expect(message.metadata.stream_id).toMatch(/^stream_/);
      });

      test('should add streaming message to session messages list', async () => {
        const sessionId = 'stream-session-789';
        const options = {
          stream_id: 'stream_xyz',
          model: 'claude-3-opus'
        };

        await messageStore.addStreamingMessage(sessionId, options);

        const data = await messageStore.readSessionMessages(sessionId);
        expect(data.messages.length).toBe(1);
        expect(data.messages[0].status).toBe('streaming');
      });
    });

    describe('updateStreamingContent', () => {
      test('should append content to streaming message', async () => {
        const sessionId = 'update-session-123';
        const options = { stream_id: 'stream_update_1', model: 'claude-3-opus' };

        const message = await messageStore.addStreamingMessage(sessionId, options);

        await messageStore.updateStreamingContent(sessionId, message.id, 'Hello ');
        await messageStore.updateStreamingContent(sessionId, message.id, 'World!');

        const data = await messageStore.readSessionMessages(sessionId);
        expect(data.messages[0].content).toBe('Hello World!');
      });

      test('should return true when update succeeds', async () => {
        const sessionId = 'update-session-456';
        const options = { stream_id: 'stream_update_2', model: 'claude-3-opus' };

        const message = await messageStore.addStreamingMessage(sessionId, options);

        const result = await messageStore.updateStreamingContent(sessionId, message.id, 'Test content');

        expect(result).toBe(true);
      });

      test('should return false when message not found', async () => {
        const sessionId = 'update-session-789';

        const result = await messageStore.updateStreamingContent(sessionId, 'msg_nonexistent', 'Test');

        expect(result).toBe(false);
      });

      test('should throw error when trying to update non-streaming message', async () => {
        const sessionId = 'update-session-error';

        // Add a regular (non-streaming) message
        const regularMessage = await messageStore.addMessage(sessionId, {
          role: 'assistant',
          content: 'Regular message'
        });

        // Try to update it as streaming
        await expect(
          messageStore.updateStreamingContent(sessionId, regularMessage.id, 'New content')
        ).rejects.toThrow(/not a streaming message/);
      });
    });

    describe('completeStreamingMessage', () => {
      test('should mark message as completed with metadata', async () => {
        const sessionId = 'complete-session-123';
        const options = { stream_id: 'stream_complete_1', model: 'claude-3-opus' };

        const message = await messageStore.addStreamingMessage(sessionId, options);
        await messageStore.updateStreamingContent(sessionId, message.id, 'Final content');

        const metadata = {
          cost_usd: 0.05,
          duration_ms: 1234
        };

        const result = await messageStore.completeStreamingMessage(sessionId, message.id, metadata);

        expect(result.status).toBe('completed');
        expect(result.content).toBe('Final content');
        expect(result.metadata.completed_at).toBeDefined();
        expect(result.metadata.cost_usd).toBe(0.05);
        expect(result.metadata.duration_ms).toBe(1234);
      });

      test('should return null when message not found', async () => {
        const sessionId = 'complete-session-456';

        const result = await messageStore.completeStreamingMessage(
          sessionId,
          'msg_nonexistent',
          { cost_usd: 0.01 }
        );

        expect(result).toBeNull();
      });

      test('should preserve existing metadata when completing', async () => {
        const sessionId = 'complete-session-789';
        const options = {
          stream_id: 'stream_complete_2',
          model: 'claude-3-opus',
          custom_field: 'custom_value'
        };

        const message = await messageStore.addStreamingMessage(sessionId, options);

        const result = await messageStore.completeStreamingMessage(
          sessionId,
          message.id,
          { cost_usd: 0.02, duration_ms: 500 }
        );

        expect(result.metadata.model).toBe('claude-3-opus');
        expect(result.metadata.custom_field).toBe('custom_value');
        expect(result.metadata.stream_id).toBe('stream_complete_2');
      });

      test('should throw when completing non-streaming message', async () => {
        // First create and complete a streaming message
        const msg = await messageStore.addStreamingMessage('session-1');
        await messageStore.completeStreamingMessage('session-1', msg.id);

        // Try to complete it again
        await expect(
          messageStore.completeStreamingMessage('session-1', msg.id)
        ).rejects.toThrow(/Cannot complete message with status 'completed'/);
      });
    });

    describe('getStreamingMessage', () => {
      test('should find message by stream_id', async () => {
        const sessionId = 'get-session-123';
        const options = { stream_id: 'stream_get_1', model: 'claude-3-opus' };

        const message = await messageStore.addStreamingMessage(sessionId, options);

        const found = await messageStore.getStreamingMessage(sessionId, 'stream_get_1');

        expect(found).toBeDefined();
        expect(found.id).toBe(message.id);
        expect(found.metadata.stream_id).toBe('stream_get_1');
      });

      test('should return null when stream_id not found', async () => {
        const sessionId = 'get-session-456';

        const found = await messageStore.getStreamingMessage(sessionId, 'stream_nonexistent');

        expect(found).toBeNull();
      });

      test('should find completed streaming message by stream_id', async () => {
        const sessionId = 'get-session-789';
        const options = { stream_id: 'stream_get_2', model: 'claude-3-opus' };

        const message = await messageStore.addStreamingMessage(sessionId, options);
        await messageStore.updateStreamingContent(sessionId, message.id, 'Content');
        await messageStore.completeStreamingMessage(sessionId, message.id, { cost_usd: 0.01 });

        const found = await messageStore.getStreamingMessage(sessionId, 'stream_get_2');

        expect(found).toBeDefined();
        expect(found.status).toBe('completed');
        expect(found.metadata.stream_id).toBe('stream_get_2');
      });

      test('should only search in the specified session', async () => {
        const sessionId1 = 'get-session-a';
        const sessionId2 = 'get-session-b';

        await messageStore.addStreamingMessage(sessionId1, {
          stream_id: 'stream_session_a',
          model: 'claude-3-opus'
        });

        await messageStore.addStreamingMessage(sessionId2, {
          stream_id: 'stream_session_b',
          model: 'claude-3-opus'
        });

        // Search for stream_session_a in session2 should return null
        const found = await messageStore.getStreamingMessage(sessionId2, 'stream_session_a');
        expect(found).toBeNull();

        // Search for stream_session_b in session1 should return null
        const found2 = await messageStore.getStreamingMessage(sessionId1, 'stream_session_b');
        expect(found2).toBeNull();
      });
    });

    describe('Full streaming lifecycle', () => {
      test('should support complete streaming message lifecycle', async () => {
        const sessionId = 'lifecycle-session';

        // 1. Create streaming message
        const message = await messageStore.addStreamingMessage(sessionId, {
          stream_id: 'stream_lifecycle',
          model: 'claude-3-opus'
        });
        expect(message.status).toBe('streaming');
        expect(message.content).toBe('');

        // 2. Append content multiple times
        await messageStore.updateStreamingContent(sessionId, message.id, 'Hello, ');
        await messageStore.updateStreamingContent(sessionId, message.id, 'this is ');
        await messageStore.updateStreamingContent(sessionId, message.id, 'a streaming ');
        await messageStore.updateStreamingContent(sessionId, message.id, 'message!');

        // 3. Verify content accumulated
        let data = await messageStore.readSessionMessages(sessionId);
        expect(data.messages[0].content).toBe('Hello, this is a streaming message!');

        // 4. Complete the message
        const completed = await messageStore.completeStreamingMessage(
          sessionId,
          message.id,
          { cost_usd: 0.15, duration_ms: 2500 }
        );

        expect(completed.status).toBe('completed');
        expect(completed.content).toBe('Hello, this is a streaming message!');
        expect(completed.metadata.cost_usd).toBe(0.15);
        expect(completed.metadata.duration_ms).toBe(2500);
        expect(completed.metadata.completed_at).toBeDefined();

        // 5. Verify can retrieve by stream_id
        const retrieved = await messageStore.getStreamingMessage(sessionId, 'stream_lifecycle');
        expect(retrieved.id).toBe(message.id);
        expect(retrieved.status).toBe('completed');
      });
    });
  });
});
