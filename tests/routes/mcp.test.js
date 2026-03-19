jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { execFile } = require('child_process');
const createMcpRoutes = require('../../src/routes/mcp');

describe('MCP Routes', () => {
  let app;
  let configPath;

  beforeEach(() => {
    execFile.mockImplementation((command, args, options, callback) => {
      callback(null, [
        'claude.ai Mermaid Chart: https://chatgpt.mermaid.ai/anthropic/mcp - ✓ Connected',
        'claude.ai Zapier: https://mcp.zapier.com/api/v1/connect - ! Needs authentication',
        'claude.ai Docusign: https://mcp.docusign.com/mcp - ✗ Failed to connect',
      ].join('\n'), '');
    });

    configPath = path.join(os.tmpdir(), `mcp-config-${Date.now()}.json`);
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        filesystem: {
          command: 'npx',
          args: ['@modelcontextprotocol/server-filesystem', '/tmp'],
          env: {
            API_TOKEN: 'secret',
          },
        },
      },
    }, null, 2));

    app = express();
    app.use('/api/mcp', createMcpRoutes({
      mcp: {
        enabled: true,
        configPath,
      },
    }));
  });

  afterEach(() => {
    jest.clearAllMocks();

    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
  });

  test('GET /api/mcp returns MCP summary', async () => {
    const res = await request(app).get('/api/mcp');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.mcp).toMatchObject({
      enabled: true,
      exists: true,
      valid: true,
      serverCount: 1,
    });
    expect(res.body.mcp.servers).toEqual([
      expect.objectContaining({
        name: 'filesystem',
        command: 'npx',
        args: ['@modelcontextprotocol/server-filesystem', '/tmp'],
      }),
    ]);
    expect(res.body.mcp.runtime).toMatchObject({
      available: true,
      serverCount: 3,
      error: null,
    });
    expect(res.body.mcp.runtime.servers).toEqual([
      expect.objectContaining({
        name: 'MermaidChart',
        status: 'Connected',
        state: 'connected',
      }),
      expect.objectContaining({
        name: 'Zapier',
        status: 'Needs authentication',
        state: 'needs_authentication',
      }),
      expect.objectContaining({
        name: 'Docusign',
        status: 'Failed to connect',
        state: 'failed',
      }),
    ]);
  });

  test('GET /api/mcp returns runtime error details when claude mcp list fails', async () => {
    execFile.mockImplementationOnce((command, args, options, callback) => {
      callback(new Error('spawn ENOENT'), '', 'claude: command not found');
    });

    const res = await request(app).get('/api/mcp');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.mcp.runtime).toMatchObject({
      available: false,
      serverCount: 0,
      error: 'claude: command not found',
    });
  });

  test('GET /api/mcp/config returns redacted config content', async () => {
    const res = await request(app).get('/api/mcp/config');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.config.mcpServers.filesystem.env.API_TOKEN).toBe('*** HIDDEN ***');
    expect(res.body.servers).toEqual([
      expect.objectContaining({ name: 'filesystem', envKeys: ['API_TOKEN'] }),
    ]);
  });

  test('GET /api/mcp/config returns 404 when config path is missing', async () => {
    const missingApp = express();
    missingApp.use('/api/mcp', createMcpRoutes({ mcp: { enabled: false, configPath: null } }));

    const res = await request(missingApp).get('/api/mcp/config');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

