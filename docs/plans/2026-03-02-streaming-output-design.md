# Streaming Output Design

## Overview

Add SSE (Server-Sent Events) streaming output capability to the Claude Code Server, allowing clients to receive real-time updates as Claude processes requests.

## Goals

- Provide real-time feedback during Claude execution
- Support session continuation with streaming
- Maintain compatibility with existing sync/async endpoints

## API Design

### Endpoint

```
POST /api/sessions/:id/continue/stream
```

### Request Headers

```
Content-Type: application/json
Accept: text/event-stream
```

### Request Body

Same as existing `/api/sessions/:id/continue`:

```json
{
  "prompt": "Explain what HTTP is",
  "system_prompt": "Optional system prompt override",
  "max_budget_usd": 1.0,
  "allowed_tools": ["bash", "editor"],
  "disallowed_tools": ["web-search"]
}
```

### Response Headers

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Session-Id: <session-uuid>
```

## SSE Event Format

Events follow the SSE standard format:

```
event: <event-type>
data: <json-payload>

```

### Event Types

#### `message` - Claude Stream Events

Each JSON line from Claude CLI is forwarded as-is:

```
event: message
data: {"type":"system","subtype":"init","cwd":"/path","session_id":"xxx",...}

event: message
data: {"type":"stream_event","event":{"type":"message_start",...},...}

event: message
data: {"type":"stream_event","event":{"type":"content_block_start",...},...}

event: message
data: {"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}},...}

event: message
data: {"type":"result","subtype":"success","result":"...","total_cost_usd":0.01,...}
```

#### `done` - Stream Completion

```
event: done
data: {"session_id":"xxx","duration_ms":5000}
```

#### `error` - Error Events

```
event: error
data: {"error":"Failed to start Claude CLI","details":"..."}
```

## Claude CLI Integration

### Command Format

```bash
claude -p "prompt" \
  --output-format stream-json \
  --include-partial-messages \
  --verbose \
  --resume <session-id> \
  [other options...]
```

### Key CLI Flags

- `--output-format stream-json` - Output newline-delimited JSON
- `--include-partial-messages` - Include partial message updates
- `--verbose` - Include system events and metadata

## Implementation Architecture

### New Files

```
src/
├── services/
│   └── claudeStreamExecutor.js    # Streaming executor service
├── routes/
│   └── sessions.js                 # Add POST /:id/continue/stream
```

### claudeStreamExecutor.js

Responsible for:
- Spawning Claude CLI with streaming flags
- Parsing JSONL output line by line
- Providing a ReadableStream or EventEmitter interface
- Handling process lifecycle (spawn, error, exit)

### Route Handler Flow

1. Validate request (session exists, valid prompt)
2. Set SSE headers
3. Call `claudeStreamExecutor.executeStream()`
4. Pipe stdout lines to SSE events
5. On `result` event, update session cost/stats
6. Send `done` event and close connection

### Error Handling

- Claude CLI spawn failure → `error` event + close
- Stream break mid-way → `error` event with details
- Client disconnect → Kill Claude process

## Testing

### curl Test

```bash
curl -N -X POST http://localhost:5546/api/sessions/SESSION_ID/continue/stream \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Hello"}'
```

### JavaScript Client

```javascript
const response = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream'
  },
  body: JSON.stringify({ prompt: "Hello" })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const text = decoder.decode(value);
  // Parse SSE events
}
```

## Future Considerations

- Add `/api/stream/messages` for non-session streaming
- Add configurable stream timeout
- Support for aborting streams via DELETE endpoint
