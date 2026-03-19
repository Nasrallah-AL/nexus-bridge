const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

jest.setTimeout(30000);

const REPO_ROOT = path.resolve(__dirname, '../..');
const SERVER_ENTRY = path.join(REPO_ROOT, 'server.js');

function shouldSkipE2E() {
  return ['1', 'true', 'yes'].includes(String(process.env.SKIP_E2E || '').toLowerCase());
}

const skipMessage = shouldSkipE2E()
  ? 'SKIP_E2E is set'
  : null;

function isClaudeAvailable(claudePath) {
  return Boolean(claudePath && fs.existsSync(claudePath));
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stopChildProcess(childProcess, timeoutMs = 5000) {
  return new Promise(resolve => {
    if (!childProcess || childProcess.exitCode !== null) {
      resolve();
      return;
    }

    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(forceKillTimer);
      clearTimeout(giveUpTimer);
      childProcess.removeListener('exit', onExit);
      resolve();
    };

    const onExit = () => finish();

    const forceKillTimer = setTimeout(() => {
      if (childProcess.exitCode === null) {
        childProcess.kill('SIGKILL');
      }
    }, timeoutMs);

    const giveUpTimer = setTimeout(finish, timeoutMs + 1000);

    childProcess.once('exit', onExit);
    childProcess.kill('SIGTERM');
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function waitForServer(baseUrl, timeoutMs = 10000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      // Server is still starting.
    }

    await wait(200);
  }

  throw new Error(`Timed out waiting for server at ${baseUrl}`);
}

function createFakeClaudeCli(claudePath) {
  const script = `#!/usr/bin/env node
const args = process.argv.slice(2);

function getArg(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1];
}

const outputFormat = getArg('--output-format') || 'json';
const sessionId = getArg('--resume') || getArg('--session-id') || 'fake-session';

function writeJsonLine(payload) {
  process.stdout.write(JSON.stringify(payload) + '\\n');
}

if (outputFormat === 'stream-json') {
  writeJsonLine({
    type: 'stream_event',
    event: {
      type: 'message_start',
      message: {
        model: 'fake-claude-stream-model',
      },
    },
  });

  setTimeout(() => {
    writeJsonLine({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'First streamed chunk.' }],
      },
    });
  }, 100);

  setTimeout(() => {
    writeJsonLine({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Second streamed chunk.' }],
      },
    });
  }, 1500);

  setTimeout(() => {
    writeJsonLine({
      type: 'result',
      session_id: sessionId,
      result: 'First streamed chunk. Second streamed chunk.',
      total_cost_usd: 0.01,
      usage: {
        input_tokens: 12,
        output_tokens: 24,
      },
    });
    process.exit(0);
  }, 2500);

  return;
}

process.stdout.write(JSON.stringify({
  session_id: sessionId,
  result: 'fake Claude response',
  total_cost_usd: 0.01,
  usage: {
    input_tokens: 4,
    output_tokens: 8,
  },
}));
`;

  fs.writeFileSync(claudePath, script, { mode: 0o755 });
}

async function jsonRequest(baseUrl, method, routePath, body) {
  const response = await fetch(`${baseUrl}${routePath}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let parsedBody;

  try {
    parsedBody = JSON.parse(text);
  } catch (error) {
    parsedBody = text;
  }

  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: parsedBody,
  };
}

function openStreamingRequest(baseUrl, method, routePath, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}${routePath}`);
    const payload = body ? JSON.stringify(body) : null;

    const req = http.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers: payload ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      } : undefined,
    });

    req.on('response', res => {
      res.setEncoding('utf8');

      if ((res.headers['content-type'] || '').includes('application/json')) {
        let jsonText = '';
        res.on('data', chunk => {
          jsonText += chunk;
        });
        res.on('end', () => {
          try {
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              json: JSON.parse(jsonText),
            });
          } catch (error) {
            reject(new Error(`Failed to parse JSON response: ${error.message}`));
          }
        });
        return;
      }

      let firstChunk = '';
      const cleanup = () => {
        res.removeAllListeners('data');
        res.removeAllListeners('error');
        res.removeAllListeners('close');
      };

      res.on('data', chunk => {
        firstChunk += chunk;
        if (!firstChunk.includes('\n\n')) {
          return;
        }

        cleanup();
        res.destroy();
        req.destroy();

        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          firstChunk,
        });
      });

      res.on('error', err => {
        if (err.code !== 'ECONNRESET') {
          reject(err);
        }
      });

      res.on('close', () => {
        if (!firstChunk) {
          reject(new Error('Connection closed before any SSE event was received'));
        }
      });
    });

    req.on('error', err => {
      if (err.code !== 'ECONNRESET') {
        reject(err);
      }
    });

    if (payload) {
      req.write(payload);
    }

    req.end();
  });
}

const describeE2E = shouldSkipE2E() ? describe.skip : describe;

describeE2E('Stream Resume E2E', () => {
  let tempRoot;
  let tempHome;
  let runtimeDir;
  let workspacePath;
  let projectPath;
  let fakeClaudePath;
  let port;
  let baseUrl;
  let serverProcess;
  let serverLogs = '';

  beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-bridge-e2e-'));
    tempHome = path.join(tempRoot, 'home');
    runtimeDir = path.join(tempHome, '.nexus-bridge');
    workspacePath = path.join(runtimeDir, 'workspace');
    projectPath = path.join(workspacePath, 'stream-project');
    fakeClaudePath = path.join(tempRoot, 'fake-claude');

    fs.mkdirSync(projectPath, { recursive: true });
    createFakeClaudeCli(fakeClaudePath);

    port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;

    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, 'config.json'), JSON.stringify({
      port,
      host: '127.0.0.1',
      claudePath: fakeClaudePath,
      nodeBinDir: path.dirname(process.execPath),
      workspacePath,
      logFile: path.join(runtimeDir, 'logs', 'server.log'),
      pidFile: path.join(runtimeDir, 'server.pid'),
      dataDir: path.join(runtimeDir, 'data'),
      defaultModel: 'claude-sonnet-4-5',
      logLevel: 'error',
      statistics: { enabled: false },
      taskQueue: { concurrency: 1, defaultTimeout: 5000 },
      security: {
        auth: {
          enabled: false,
          bypassHealthCheck: true,
          secretKey: 'test-secret-key',
        },
        swaggerDocs: {
          enabled: false,
        },
      },
    }, null, 2));

    if (!isClaudeAvailable(fakeClaudePath)) {
      throw new Error(`Fake Claude CLI was not created at ${fakeClaudePath}`);
    }

    serverProcess = spawn(process.execPath, [SERVER_ENTRY], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        HOME: tempHome,
        NEXUS_BRIDGE_AUTH_ENABLED: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    serverProcess.stdout.on('data', chunk => {
      serverLogs += chunk.toString();
    });
    serverProcess.stderr.on('data', chunk => {
      serverLogs += chunk.toString();
    });

    await waitForServer(baseUrl);
  });

  afterAll(async () => {
    if (serverProcess && serverProcess.exitCode === null) {
      await stopChildProcess(serverProcess);
    }

    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('keeps the stream alive after disconnect and allows resume', async () => {
    const sessionResponse = await jsonRequest(baseUrl, 'POST', '/api/sessions', {
      project_path: projectPath,
      model: 'claude-sonnet-4-5',
    });

    expect(sessionResponse.status).toBe(201);
    expect(sessionResponse.body.success).toBe(true);

    const sessionId = sessionResponse.body.session.id;

    const startedStream = await openStreamingRequest(
      baseUrl,
      'POST',
      `/api/sessions/${sessionId}/continue/stream`,
      { prompt: 'Write a long explanation of HTTP protocol.' }
    );

    expect(startedStream.statusCode).toBe(200);
    expect(startedStream.headers['content-type']).toContain('text/event-stream');
    expect(startedStream.headers['x-session-id']).toBe(sessionId);
    expect(startedStream.headers['x-stream-id']).toMatch(/^stream_/);
    expect(startedStream.firstChunk).toContain('event: message');

    const streamId = startedStream.headers['x-stream-id'];

    const statusWhileRunning = await jsonRequest(
      baseUrl,
      'GET',
      `/api/sessions/${sessionId}/stream/status`
    );

    expect(statusWhileRunning.status).toBe(200);
    expect(statusWhileRunning.body.success).toBe(true);
    expect(statusWhileRunning.body.has_active_stream).toBe(true);
    expect(statusWhileRunning.body.stream.stream_id).toBe(streamId);

    const resumedWhileRunning = await openStreamingRequest(
      baseUrl,
      'GET',
      `/api/sessions/${sessionId}/stream/resume?stream_id=${streamId}`
    );

    expect(resumedWhileRunning.statusCode).toBe(200);
    expect(resumedWhileRunning.headers['content-type']).toContain('text/event-stream');
    expect(resumedWhileRunning.headers['x-session-id']).toBe(sessionId);
    expect(resumedWhileRunning.headers['x-stream-id']).toBe(streamId);
    expect(resumedWhileRunning.firstChunk).toContain('event: message');
    expect(resumedWhileRunning.firstChunk).toContain('"type":"resumed"');

    await wait(3000);

    const statusAfterCompletion = await jsonRequest(
      baseUrl,
      'GET',
      `/api/sessions/${sessionId}/stream/status`
    );

    expect(statusAfterCompletion.status).toBe(200);
    expect(statusAfterCompletion.body.has_active_stream).toBe(false);

    const completedResume = await jsonRequest(
      baseUrl,
      'GET',
      `/api/sessions/${sessionId}/stream/resume?stream_id=${streamId}`
    );

    expect(completedResume.status).toBe(200);
    expect(completedResume.body.success).toBe(true);
    expect(completedResume.body.status).toBe('completed');
    expect(completedResume.body.stream_id).toBe(streamId);
    expect(completedResume.body.metadata).toEqual(expect.objectContaining({
      success: true,
      cost_usd: 0.01,
    }));
  });
});

module.exports = {
  isClaudeAvailable,
  shouldSkipE2E,
  skipMessage,
};
