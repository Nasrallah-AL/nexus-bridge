/**
 * 创建项目路由
 */
function createProjectsRoutes(sessionStore, config, messageStore = null) {
  const router = require('express').Router();
  const path = require('path');

  /**
   * @swagger
   * /api/projects:
   *   get:
   *     summary: List historical projects
   *     description: |
   *       Retrieve a list of all projects that have sessions.
   *       Returns aggregated statistics for each project including:
   *       session count, total cost, message count, and last activity time.
   *       Useful for viewing project history and resource usage.
   *     tags: [Projects]
   *     parameters:
   *       - name: limit
   *         in: query
   *         description: Maximum number of projects to return
   *         required: false
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 1000
   *           default: 100
   *         example: 50
   *       - name: sort_by
   *         in: query
   *         description: Sort field
   *         required: false
   *         schema:
   *           type: string
   *           enum: [last_activity, total_cost, session_count, messages_count]
   *           default: last_activity
   *         example: last_activity
   *       - name: order
   *         in: query
   *         description: Sort order
   *         required: false
   *         schema:
   *           type: string
   *           enum: [asc, desc]
   *           default: desc
   *         example: desc
   *     responses:
   *       '200':
   *         description: Projects retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 projects:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       project_path:
   *                         type: string
   *                         description: Full project path
   *                         example: "/home/user/.claude-code-server/workspace/my-project"
   *                       relative_path:
   *                         type: string
   *                         description: Path relative to workspace
   *                         example: "my-project"
   *                       session_count:
   *                         type: integer
   *                         description: Number of sessions for this project
   *                         example: 5
   *                       total_cost_usd:
   *                         type: number
   *                         format: float
   *                         description: Total cost across all sessions
   *                         example: 2.45
   *                       messages_count:
   *                         type: integer
   *                         description: Total messages across all sessions
   *                         example: 42
   *                       last_activity:
   *                         type: string
   *                         format: date-time
   *                         description: Last activity timestamp
   *                         example: "2025-02-27T10:30:00.000Z"
   *                       created_at:
   *                         type: string
   *                         format: date-time
   *                         description: First session creation time
   *                         example: "2025-02-20T10:30:00.000Z"
   *                 count:
   *                   type: integer
   *                   description: Number of projects returned
   *                   example: 3
   *             example:
   *               success: true
   *               projects:
   *                 - project_path: "/home/user/.claude-code-server/workspace/my-project"
   *                   relative_path: "my-project"
   *                   session_count: 5
   *                   total_cost_usd: 2.45
   *                   messages_count: 42
   *                   last_activity: "2025-02-27T10:30:00.000Z"
   *                   created_at: "2025-02-20T10:30:00.000Z"
   *                 - project_path: "/home/user/.claude-code-server/workspace/another-project"
   *                   relative_path: "another-project"
   *                   session_count: 2
   *                   total_cost_usd: 0.87
   *                   messages_count: 15
   *                   last_activity: "2025-02-26T15:20:00.000Z"
   *                   created_at: "2025-02-25T09:00:00.000Z"
   *               count: 2
   *       '500':
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               success: false
   *               error: "Failed to retrieve projects"
   */
  // GET /api/projects - 列出历史项目
  router.get('/', async (req, res) => {
    try {
      const sessions = await sessionStore.list();

      // 按项目路径分组
      const projectMap = new Map();

      for (const session of sessions) {
        const projectPath = session.project_path || config.workspacePath;

        if (!projectMap.has(projectPath)) {
          projectMap.set(projectPath, {
            project_path: projectPath,
            relative_path: path.relative(config.workspacePath, projectPath),
            session_count: 0,
            total_cost_usd: 0,
            messages_count: 0,
            last_activity: session.updated_at,
            created_at: session.created_at,
          });
        }

        const project = projectMap.get(projectPath);
        project.session_count++;
        project.total_cost_usd += session.total_cost_usd || 0;
        project.messages_count += session.messages_count || 0;

        // 更新最后活动时间
        if (new Date(session.updated_at) > new Date(project.last_activity)) {
          project.last_activity = session.updated_at;
        }

        // 更新最早创建时间
        if (new Date(session.created_at) < new Date(project.created_at)) {
          project.created_at = session.created_at;
        }
      }

      let projects = Array.from(projectMap.values());

      // 排序
      const sortBy = req.query.sort_by || 'last_activity';
      const order = req.query.order || 'desc';

      projects.sort((a, b) => {
        let comparison = 0;

        switch (sortBy) {
          case 'total_cost':
            comparison = a.total_cost_usd - b.total_cost_usd;
            break;
          case 'session_count':
            comparison = a.session_count - b.session_count;
            break;
          case 'messages_count':
            comparison = a.messages_count - b.messages_count;
            break;
          case 'last_activity':
          default:
            comparison = new Date(a.last_activity) - new Date(b.last_activity);
            break;
        }

        return order === 'asc' ? comparison : -comparison;
      });

      // 分页
      const limit = req.query.limit ? parseInt(req.query.limit) : undefined;
      if (limit) {
        projects = projects.slice(0, limit);
      }

      res.json({
        success: true,
        projects,
        count: projects.length,
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
   * /api/projects/stats:
   *   get:
   *     summary: Get overall project statistics
   *     description: |
   *       Retrieve aggregated statistics across all projects.
   *       Includes total projects, sessions, costs, and messages.
   *     tags: [Projects]
   *     responses:
   *       '200':
   *         description: Statistics retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 stats:
   *                   type: object
   *                   properties:
   *                     total_projects:
   *                       type: integer
   *                       description: Total number of unique projects
   *                       example: 5
   *                     total_sessions:
   *                       type: integer
   *                       description: Total number of sessions across all projects
   *                       example: 23
   *                     total_cost_usd:
   *                       type: number
   *                       format: float
   *                       description: Total cost across all sessions
   *                       example: 15.67
   *                     total_messages:
   *                       type: integer
   *                       description: Total messages across all sessions
   *                       example: 342
   *                     most_expensive_project:
   *                       type: object
   *                       description: Project with highest total cost
   *                       properties:
   *                         project_path:
   *                           type: string
   *                         total_cost_usd:
   *                           type: number
   *                     most_active_project:
   *                       type: object
   *                       description: Project with most sessions
   *                       properties:
   *                         project_path:
   *                           type: string
   *                         session_count:
   *                           type: integer
   *             example:
   *               success: true
   *               stats:
   *                 total_projects: 5
   *                 total_sessions: 23
   *                 total_cost_usd: 15.67
   *                 total_messages: 342
   *                 most_expensive_project:
   *                   project_path: "/home/user/.claude-code-server/workspace/my-project"
   *                   total_cost_usd: 8.45
   *                 most_active_project:
   *                   project_path: "/home/user/.claude-code-server/workspace/my-project"
   *                   session_count: 12
   *       '500':
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               success: false
   *               error: "Failed to retrieve statistics"
   */
  /**
   * @swagger
   * /api/projects/{path}:
   *   delete:
   *     summary: Delete a project and its sessions
   *     description: |
   *       Delete all sessions associated with a project path.
   *       This removes the project from the project list and deletes all related session data.
   *       Note: This does NOT delete the actual project files/directory on the server.
   *     tags: [Projects]
   *     parameters:
   *       - name: path
   *         in: path
   *         description: |
   *           Project path (URL encoded).
   *           Use the full project_path from the project list.
   *         required: true
   *         schema:
   *           type: string
   *         example: "/home/user/.claude-code-server/workspace/my-project"
   *     responses:
   *       '200':
   *         description: Project deleted successfully
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
   *                   example: "Project deleted successfully"
   *                 deleted_sessions:
   *                   type: integer
   *                   description: Number of sessions deleted
   *                   example: 5
   *                 project_path:
   *                   type: string
   *                   example: "/home/user/.claude-code-server/workspace/my-project"
   *             example:
   *               success: true
   *               message: "Project deleted successfully"
   *               deleted_sessions: 5
   *               project_path: "/home/user/.claude-code-server/workspace/my-project"
   *       '400':
   *         description: Invalid request
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               success: false
   *               error: "Project path is required"
   *       '404':
   *         description: Project not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               success: false
   *               error: "No sessions found for this project"
   *       '500':
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               success: false
   *               error: "Failed to delete project"
   */
  // DELETE /api/projects/:path* - 删除项目及其 sessions（不删除文件）
  router.delete('/*', async (req, res) => {
    try {
      // 获取项目路径（处理路径中的斜杠）
      const projectPath = decodeURIComponent(req.params[0] || '');

      if (!projectPath) {
        return res.status(400).json({
          success: false,
          error: 'Project path is required',
        });
      }

      // 获取所有 sessions
      const sessions = await sessionStore.list();

      // 筛选该项目路径下的 sessions
      const projectSessions = sessions.filter(
        session => (session.project_path || config.workspacePath) === projectPath
      );

      if (projectSessions.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'No sessions found for this project',
          project_path: projectPath,
        });
      }

      // 删除所有相关 sessions 和消息
      let deletedCount = 0;
      let deletedMessages = 0;
      for (const session of projectSessions) {
        try {
          await sessionStore.delete(session.id);
          deletedCount++;

          // 删除消息文件
          if (messageStore) {
            try {
              await messageStore.deleteMessages(session.id);
              deletedMessages++;
            } catch (msgErr) {
              console.error(`Failed to delete messages for session ${session.id}:`, msgErr.message);
            }
          }
        } catch (err) {
          console.error(`Failed to delete session ${session.id}:`, err.message);
        }
      }

      res.json({
        success: true,
        message: 'Project deleted successfully',
        deleted_sessions: deletedCount,
        deleted_messages: deletedMessages,
        project_path: projectPath,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // GET /api/projects/stats - 获取项目统计
  router.get('/stats', async (req, res) => {
    try {
      const sessions = await sessionStore.list();

      // 按项目路径分组
      const projectMap = new Map();

      for (const session of sessions) {
        const projectPath = session.project_path || config.workspacePath;

        if (!projectMap.has(projectPath)) {
          projectMap.set(projectPath, {
            project_path: projectPath,
            total_cost_usd: 0,
            session_count: 0,
            messages_count: 0,
          });
        }

        const project = projectMap.get(projectPath);
        project.session_count++;
        project.total_cost_usd += session.total_cost_usd || 0;
        project.messages_count += session.messages_count || 0;
      }

      const projects = Array.from(projectMap.values());

      // 找出最贵和最活跃的项目
      let mostExpensive = null;
      let mostActive = null;

      for (const project of projects) {
        if (!mostExpensive || project.total_cost_usd > mostExpensive.total_cost_usd) {
          mostExpensive = project;
        }
        if (!mostActive || project.session_count > mostActive.session_count) {
          mostActive = project;
        }
      }

      const stats = {
        total_projects: projects.length,
        total_sessions: sessions.length,
        total_cost_usd: sessions.reduce((sum, s) => sum + (s.total_cost_usd || 0), 0),
        total_messages: sessions.reduce((sum, s) => sum + (s.messages_count || 0), 0),
        most_expensive_project: mostExpensive ? {
          project_path: mostExpensive.project_path,
          total_cost_usd: mostExpensive.total_cost_usd,
        } : null,
        most_active_project: mostActive ? {
          project_path: mostActive.project_path,
          session_count: mostActive.session_count,
        } : null,
      };

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

  return router;
}

module.exports = createProjectsRoutes;
