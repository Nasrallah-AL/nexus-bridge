const TaskStore = require('../storage/taskStore');
const ClaudeExecutor = require('./claudeExecutor');
const getLogger = require('../utils/logger');
const { EventEmitter } = require('events');

/**
 * Simple in-memory task queue.
 */
class TaskQueue extends EventEmitter {
  constructor(config, taskStore, claudeExecutor, webhookNotifier = null, providerRouter = null) {
    super();
    this.config = config;
    this.taskStore = taskStore;
    this.claudeExecutor = claudeExecutor;
    this.webhookNotifier = webhookNotifier;
    this.providerRouter = providerRouter;
    this.logger = getLogger({ logFile: config.logFile, logLevel: config.logLevel });

    // Queue configuration
    this.concurrency = config.taskQueue?.concurrency || 3;
    this.defaultTimeout = config.taskQueue?.defaultTimeout || 300000;

    // Runtime state
    this.running = false;
    this.activeTasks = new Map(); // taskId -> { promise, timeout }
    this.pendingCheckInterval = null;
  }

  /**
   * Start the queue.
   */
  async start() {
    if (this.running) {
      this.logger.warn('Task queue is already running');
      return;
    }

    this.running = true;

    // Restore previously unfinished tasks
    await this.restorePendingTasks();

    // Start the processing loop
    this.processQueue();

    // Periodically check for new tasks
    this.pendingCheckInterval = setInterval(() => {
      this.processQueue();
    }, 1000);

    this.logger.info('Task queue started', { concurrency: this.concurrency });
  }

  /**
   * Stop the queue.
   */
  async stop() {
    if (!this.running) {
      return;
    }

    this.running = false;

    // Stop the polling timer
    if (this.pendingCheckInterval) {
      clearInterval(this.pendingCheckInterval);
      this.pendingCheckInterval = null;
    }

    // Wait for active tasks to finish (up to 10 seconds)
    const timeout = setTimeout(() => {
      if (this.activeTasks.size > 0) {
        this.logger.warn('Forcing shutdown with active tasks', {
          count: this.activeTasks.size,
        });
      }
    }, 10000);

    while (this.activeTasks.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    clearTimeout(timeout);

    this.logger.info('Task queue stopped');
  }

  /**
   * Add a task to the queue.
   */
  async addTask(taskData) {
    const task = await this.taskStore.create(taskData);
    this.logger.info('Task added to queue', {
      task_id: task.id,
      priority: task.priority,
    });

    // Trigger processing
    setImmediate(() => this.processQueue());

    return task;
  }

  /**
   * Process the queue.
   */
  async processQueue() {
    if (!this.running) {
      return;
    }

    // If maximum concurrency has been reached, wait
    if (this.activeTasks.size >= this.concurrency) {
      return;
    }

    // Get the next pending task
    const task = await this.taskStore.getNextPending();
    if (!task) {
      return;
    }

    // Check whether the task is already active
    if (this.activeTasks.has(task.id)) {
      return;
    }

    // Add it to the active task list first (immediately consumes a concurrency slot)
    this.activeTasks.set(task.id, { task, startedAt: Date.now() });

    // Mark it as processing
    try {
      await this.taskStore.markProcessing(task.id);
    } catch (error) {
      // If marking fails, remove it from the active list
      this.activeTasks.delete(task.id);
      this.logger.error('Failed to mark task as processing', { task_id: task.id, error: error.message });
      return;
    }

    // Execute the task
    this.executeTask(task).catch(err => {
      this.logger.error('Task execution error', { task_id: task.id, error: err.message });
    });
  }

  /**
   * Execute a single task.
   */
  async executeTask(task) {
    const taskId = task.id;

    // Add to the active task list for concurrency control and process management
    this.activeTasks.set(taskId, { task, childProcess: null, startedAt: Date.now() });

    // Extract parameters from metadata
    const metadata = task.metadata || {};
    const webhookUrl = metadata.webhook_url;

    // Send the webhook notification that task processing has started
    if (this.webhookNotifier) {
      const taskData = {
        prompt: task.prompt,
        model: task.model,
        project_path: task.project_path,
        priority: task.priority,
        created_at: task.created_at,
      };

      if (webhookUrl) {
        await this.webhookNotifier.sendCustomNotification('task.started', {
          task_id: taskId,
          status: 'processing',
          ...taskData,
        }, webhookUrl);
      } else {
        await this.webhookNotifier.notifyTaskStarted(taskId, taskData);
      }
    }

    // Create the task timeout
    const timeout = setTimeout(async () => {
      this.logger.warn('Task timeout', { task_id: taskId });
      await this.taskStore.markFailed(taskId, 'Task execution timeout');
      this.activeTasks.delete(taskId);

      // Record failure for load balancing health tracking
      const provider = metadata.provider;
      if (provider && this.providerRouter) {
        this.providerRouter.recordFailure(provider.id);
      }

      this.emit('taskFailed', { taskId, reason: 'timeout' });

      // Send the webhook notification using the custom URL
      if (this.webhookNotifier && webhookUrl) {
        await this.webhookNotifier.sendCustomNotification('task.timeout', {
          task_id: taskId,
          error: 'Task execution timeout',
        }, webhookUrl);
      } else if (this.webhookNotifier) {
        await this.webhookNotifier.notifyTaskFailed(taskId, 'Task execution timeout');
      }

      this.processQueue();
    }, this.defaultTimeout);

    try {
      // Execute the Claude command using metadata parameters
      const result = await this.claudeExecutor.execute({
        prompt: task.prompt,
        projectPath: task.project_path,
        model: task.model,
        sessionId: metadata.session_id,
        systemPrompt: metadata.system_prompt,
        maxBudgetUsd: metadata.max_budget_usd,
        allowedTools: metadata.allowed_tools,
        disallowedTools: metadata.disallowed_tools,
        agent: metadata.agent,
        mcpConfig: metadata.mcp_config,
        permissionMode: metadata.permission_mode,
        provider: metadata.provider || null,
        providerRouter: this.providerRouter,
        onSpawn: (childProcess) => {
          // Save the child process reference so it can be terminated on cancellation
          const active = this.activeTasks.get(taskId);
          if (active) {
            active.childProcess = childProcess;
          }
        },
      });

      // Clear the timeout
      clearTimeout(timeout);

      if (result.success) {
        // Mark as successful
        await this.taskStore.markCompleted(
          taskId,
          result.result,
          result.cost_usd
        );

        // Record success for load balancing health tracking
        const provider = metadata.provider;
        if (provider && this.providerRouter) {
          this.providerRouter.recordSuccess(provider.id);
        }

        this.logger.info('Task completed', {
          task_id: taskId,
          duration_ms: result.duration_ms,
          cost_usd: result.cost_usd,
        });
        this.emit('taskCompleted', { taskId, result });

        // Send the webhook notification using the custom URL
        if (this.webhookNotifier && webhookUrl) {
          await this.webhookNotifier.sendCustomNotification('task.completed', {
            task_id: taskId,
            result: result.result,
            duration_ms: result.duration_ms,
            cost_usd: result.cost_usd,
            session_id: result.session_id,
            usage: result.usage,
          }, webhookUrl);
        } else if (this.webhookNotifier) {
          await this.webhookNotifier.notifyTaskCompleted(taskId, result);
        }
      } else {
        // Mark as failed
        await this.taskStore.markFailed(taskId, result.error);

        // Record failure for load balancing health tracking
        const provider = metadata.provider;
        if (provider && this.providerRouter) {
          this.providerRouter.recordFailure(provider.id);
        }

        this.logger.error('Task failed', {
          task_id: taskId,
          error: result.error,
        });
        this.emit('taskFailed', { taskId, error: result.error });

        // Send the webhook notification using the custom URL
        if (this.webhookNotifier && webhookUrl) {
          await this.webhookNotifier.sendCustomNotification('task.failed', {
            task_id: taskId,
            error: result.error,
          }, webhookUrl);
        } else if (this.webhookNotifier) {
          await this.webhookNotifier.notifyTaskFailed(taskId, result.error);
        }
      }
    } catch (error) {
      // Clear the timeout
      clearTimeout(timeout);

      // Mark as failed
      await this.taskStore.markFailed(taskId, error.message);

      // Record failure for load balancing health tracking
      const provider = metadata.provider;
      if (provider && this.providerRouter) {
        this.providerRouter.recordFailure(provider.id);
      }

      this.logger.error('Task error', {
        task_id: taskId,
        error: error.message,
      });
      this.emit('taskFailed', { taskId, error: error.message });

      // Send the webhook notification using the custom URL
      if (this.webhookNotifier && webhookUrl) {
        await this.webhookNotifier.sendCustomNotification('task.error', {
          task_id: taskId,
          error: error.message,
        }, webhookUrl);
      } else if (this.webhookNotifier) {
        await this.webhookNotifier.notifyTaskFailed(taskId, error.message);
      }
    } finally {
      // Remove from the active task list
      this.activeTasks.delete(taskId);

      // Trigger the next task
      setImmediate(() => this.processQueue());
    }
  }

  /**
   * Cancel a task.
   */
  async cancelTask(taskId) {
    const task = await this.taskStore.get(taskId);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    // Only tasks in pending or processing state can be cancelled
    if (task.status !== 'pending' && task.status !== 'processing') {
      return {
        success: false,
        error: `Cannot cancel task with status: ${task.status}`,
      };
    }

    // If the task is running, terminate the process
    const active = this.activeTasks.get(taskId);
    if (active && active.childProcess) {
      const child = active.childProcess;

      // Send SIGTERM first for a graceful shutdown
      child.kill('SIGTERM');
      this.logger.info('Sent SIGTERM to task process', { task_id: taskId });

      // If it is still running after 5 seconds, send SIGKILL to force termination
      const killTimer = setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
          this.logger.warn('Task force killed with SIGKILL', { task_id: taskId });
        }
      }, 5000);

      // Clear the timer after the process exits
      child.on('exit', () => {
        clearTimeout(killTimer);
        this.logger.info('Task process exited', { task_id: taskId });
      });
    }

    // Remove from the active task list
    if (this.activeTasks.has(taskId)) {
      this.activeTasks.delete(taskId);
    }

    // Mark as cancelled
    const result = await this.taskStore.cancel(taskId);
    if (result) {
      this.logger.info('Task cancelled', { task_id: taskId });
      this.emit('taskCancelled', { taskId });

      // Send the webhook notification
      if (this.webhookNotifier) {
        await this.webhookNotifier.notifyTaskCancelled(taskId);
      }

      return { success: true };
    }

    return { success: false, error: 'Failed to cancel task' };
  }

  /**
   * Get queue status.
   */
  async getStatus() {
    const stats = await this.taskStore.getStats();

    return {
      running: this.running,
      concurrency: this.concurrency,
      active_tasks: this.activeTasks.size,
      ...stats,
    };
  }

  /**
   * Restore previously unfinished tasks.
   */
  async restorePendingTasks() {
    const processingTasks = await this.taskStore.list({ status: 'processing' });

    if (processingTasks.length > 0) {
      this.logger.info('Restoring pending tasks', {
        count: processingTasks.length,
      });

      // Reset processing tasks back to pending
      for (const task of processingTasks) {
        await this.taskStore.update(task.id, { status: 'pending' });
      }
    }
  }
}

module.exports = TaskQueue;
