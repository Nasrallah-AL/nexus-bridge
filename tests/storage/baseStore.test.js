const fs = require('fs');
const path = require('path');
const os = require('os');
const BaseStore = require('../../src/storage/baseStore');

describe('BaseStore File Lock Mechanism', () => {
  let testDir;
  let store;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = path.join(os.tmpdir(), `basestore-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });

    // Create a test store instance
    store = new BaseStore(testDir, 'test.json');
    await store.init();
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('acquireLock', () => {
    test('should successfully acquire a lock', async () => {
      const lockId = await store.acquireLock();
      expect(lockId).toBeDefined();
      expect(typeof lockId).toBe('string');

      // Verify lock file exists
      expect(fs.existsSync(store.lockFilePath)).toBe(true);

      // Clean up
      store.releaseLock(lockId);
    });

    test('should store PID and timestamp in lock file', async () => {
      const lockId = await store.acquireLock();

      const lockContent = fs.readFileSync(store.lockFilePath, 'utf8');
      const lockData = JSON.parse(lockContent);

      expect(lockData.lockId).toBe(lockId);
      expect(lockData.pid).toBe(process.pid);
      expect(lockData.timestamp).toBeDefined();
      expect(typeof lockData.timestamp).toBe('number');

      store.releaseLock(lockId);
    });

    test('should timeout when lock cannot be acquired', async () => {
      // Acquire first lock
      const lockId1 = await store.acquireLock();

      // Try to acquire second lock with short timeout
      await expect(store.acquireLock(500)).rejects.toThrow('Failed to acquire lock: timeout');

      store.releaseLock(lockId1);
    });

    test('should clean up stale lock from dead process', async () => {
      // Create a stale lock with a fake PID
      const staleLock = {
        lockId: 'stale-lock-id',
        pid: 99999999, // Non-existent PID
        timestamp: Date.now() - 70000 // Older than 1 minute
      };
      fs.writeFileSync(store.lockFilePath, JSON.stringify(staleLock));

      // Should be able to acquire lock after cleaning up stale lock
      const lockId = await store.acquireLock();
      expect(lockId).toBeDefined();

      store.releaseLock(lockId);
    });

    test('should clean up expired lock', async () => {
      // Create an expired lock with current process PID
      const expiredLock = {
        lockId: 'expired-lock-id',
        pid: process.pid,
        timestamp: Date.now() - 70000 // Older than 1 minute
      };
      fs.writeFileSync(store.lockFilePath, JSON.stringify(expiredLock));

      // Should be able to acquire lock after cleaning up expired lock
      const lockId = await store.acquireLock();
      expect(lockId).toBeDefined();

      store.releaseLock(lockId);
    });

    test('should handle corrupted lock file', async () => {
      // Create a corrupted lock file
      fs.writeFileSync(store.lockFilePath, 'corrupted-json-{invalid}');

      // Should clean up corrupted lock and acquire new lock
      const lockId = await store.acquireLock();
      expect(lockId).toBeDefined();

      store.releaseLock(lockId);
    });
  });

  describe('releaseLock', () => {
    test('should successfully release a lock', async () => {
      const lockId = await store.acquireLock();
      expect(fs.existsSync(store.lockFilePath)).toBe(true);

      store.releaseLock(lockId);
      expect(fs.existsSync(store.lockFilePath)).toBe(false);
    });

    test('should not release lock with wrong lockId', async () => {
      const lockId = await store.acquireLock();

      // Try to release with wrong ID
      store.releaseLock('wrong-lock-id');

      // Lock file should still exist
      expect(fs.existsSync(store.lockFilePath)).toBe(true);

      // Clean up
      store.releaseLock(lockId);
    });

    test('should handle missing lock file gracefully', () => {
      // Should not throw error
      expect(() => store.releaseLock('non-existent-lock')).not.toThrow();
    });
  });

  describe('isProcessAlive', () => {
    test('should return true for current process', () => {
      expect(store.isProcessAlive(process.pid)).toBe(true);
    });

    test('should return false for non-existent process', () => {
      expect(store.isProcessAlive(99999999)).toBe(false);
    });
  });

  describe('withLock', () => {
    test('should execute operation with lock', async () => {
      let executed = false;

      await store.withLock(async () => {
        executed = true;
        return 'result';
      });

      expect(executed).toBe(true);
      // Lock should be released after operation
      expect(fs.existsSync(store.lockFilePath)).toBe(false);
    });

    test('should release lock even if operation fails', async () => {
      await expect(
        store.withLock(async () => {
          throw new Error('Operation failed');
        })
      ).rejects.toThrow('Operation failed');

      // Lock should still be released
      expect(fs.existsSync(store.lockFilePath)).toBe(false);
    });
  });
});
