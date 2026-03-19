const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Dynamically import the LowDB ESM module.
async function loadLowDB() {
  const lowdb = await import('lowdb');
  return lowdb;
}

// Create CommonJS-compatible import helpers.
async function getLowDB() {
  const lowdb = await loadLowDB();
  return lowdb.Low;
}

async function getJSONFile() {
  const lowdb = await loadLowDB();
  return lowdb.JSONFile;
}

/**
 * Base storage class with file locking.
 */
class BaseStore {
  constructor(dataDir, dbFileName) {
    this.dataDir = dataDir;
    this.dbFileName = dbFileName;
    this.dbPath = path.join(dataDir, dbFileName);
    this.lockFilePath = this.dbPath + '.lock';
    this.db = null;
  }

  /**
   * Initialize the database.
   */
  async init() {
    // Ensure the data directory exists.
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    // Dynamically import the ESM modules.
    const LowDB = await getLowDB();
    const JSONFile = await getJSONFile();

    // Initialize LowDB.
    const adapter = new JSONFile(this.dbPath);
    this.db = new LowDB(adapter, this.getDefaultData());

    // Read the data.
    await this.db.read();

    // If this is a new file, write the default data.
    if (!this.db.data) {
      this.db.data = this.getDefaultData();
      await this.db.write();
    }
  }

  /**
   * Get the default data structure (must be implemented by subclasses).
   */
  getDefaultData() {
    return {};
  }

  /**
   * Check if a process is alive
   */
  isProcessAlive(pid) {
    try {
      // process.kill with signal 0 doesn't actually kill the process
      // It just checks if the process exists
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Clean up stale lock file
   */
  cleanupStaleLock() {
    try {
      if (!fs.existsSync(this.lockFilePath)) {
        return false;
      }

      const lockContent = fs.readFileSync(this.lockFilePath, 'utf8');
      const lockData = JSON.parse(lockContent);
      const currentTime = Date.now();
      const lockAge = currentTime - lockData.timestamp;
      const LOCK_EXPIRY = 60000; // 1 minute

      // Check if lock is expired or process is dead
      if (lockAge > LOCK_EXPIRY || !this.isProcessAlive(lockData.pid)) {
        fs.unlinkSync(this.lockFilePath);
        return true;
      }

      return false;
    } catch (err) {
      // If we can't read/parse the lock file, it's likely corrupted - remove it
      try {
        fs.unlinkSync(this.lockFilePath);
        return true;
      } catch (unlinkErr) {
        return false;
      }
    }
  }

  /**
   * Acquire a file lock.
   */
  async acquireLock(timeout = 5000) {
    const startTime = Date.now();
    const lockId = crypto.randomUUID();
    const lockData = {
      lockId,
      pid: process.pid,
      timestamp: Date.now()
    };

    while (Date.now() - startTime < timeout) {
      try {
        // Try to clean up stale locks first
        this.cleanupStaleLock();

        // Try to create the lock file (`O_EXCL` guarantees atomicity).
        fs.writeFileSync(this.lockFilePath, JSON.stringify(lockData), { flag: 'wx' });
        return lockId;
      } catch (err) {
        if (err.code === 'EEXIST') {
          // The lock file already exists, so wait and retry.
          await new Promise(resolve => setTimeout(resolve, 50));
        } else {
          throw err;
        }
      }
    }

    throw new Error('Failed to acquire lock: timeout');
  }

  /**
   * Release the file lock.
   */
  releaseLock(lockId) {
    try {
      // Verify that the lock file ID matches.
      const lockContent = fs.readFileSync(this.lockFilePath, 'utf8');
      const lockData = JSON.parse(lockContent);
      if (lockData.lockId === lockId) {
        fs.unlinkSync(this.lockFilePath);
      }
    } catch (err) {
      // Ignore errors because another process may already have cleaned it up.
    }
  }

  /**
   * Perform a write operation while holding the lock.
   */
  async withLock(operation) {
    const lockId = await this.acquireLock();
    try {
      const result = await operation();
      await this.db.write();
      return result;
    } finally {
      this.releaseLock(lockId);
    }
  }

  /**
   * Generate a UUID.
   */
  generateId() {
    return crypto.randomUUID();
  }

  /**
   * Get the current timestamp.
   */
  now() {
    return new Date().toISOString();
  }
}

module.exports = BaseStore;
