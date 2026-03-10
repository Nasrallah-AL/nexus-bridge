const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 动态导入 LowDB ESM 模块
async function loadLowDB() {
  const lowdb = await import('lowdb');
  return lowdb;
}

// 创建 CommonJS 兼容的导入函数
async function getLowDB() {
  const lowdb = await loadLowDB();
  return lowdb.Low;
}

async function getJSONFile() {
  const lowdb = await loadLowDB();
  return lowdb.JSONFile;
}

/**
 * 带文件锁的基础存储类
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
   * 初始化数据库
   */
  async init() {
    // 确保数据目录存在
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    // 动态导入 ESM 模块
    const LowDB = await getLowDB();
    const JSONFile = await getJSONFile();

    // 初始化 LowDB
    const adapter = new JSONFile(this.dbPath);
    this.db = new LowDB(adapter, this.getDefaultData());

    // 读取数据
    await this.db.read();

    // 如果是新文件，写入默认数据
    if (!this.db.data) {
      this.db.data = this.getDefaultData();
      await this.db.write();
    }
  }

  /**
   * 获取默认数据结构（子类需要实现）
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
   * 获取文件锁
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

        // 尝试创建锁文件（O_EXCL 标志确保原子性）
        fs.writeFileSync(this.lockFilePath, JSON.stringify(lockData), { flag: 'wx' });
        return lockId;
      } catch (err) {
        if (err.code === 'EEXIST') {
          // 锁文件已存在，等待后重试
          await new Promise(resolve => setTimeout(resolve, 50));
        } else {
          throw err;
        }
      }
    }

    throw new Error('Failed to acquire lock: timeout');
  }

  /**
   * 释放文件锁
   */
  releaseLock(lockId) {
    try {
      // 验证锁文件中的 ID 是否匹配
      const lockContent = fs.readFileSync(this.lockFilePath, 'utf8');
      const lockData = JSON.parse(lockContent);
      if (lockData.lockId === lockId) {
        fs.unlinkSync(this.lockFilePath);
      }
    } catch (err) {
      // 忽略错误（文件可能已被其他进程清理）
    }
  }

  /**
   * 带锁的写入操作
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
   * 生成 UUID
   */
  generateId() {
    return crypto.randomUUID();
  }

  /**
   * 获取当前时间戳
   */
  now() {
    return new Date().toISOString();
  }
}

module.exports = BaseStore;
