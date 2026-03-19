# Stream Resume After Client Disconnect

## Background

When an SSE client disconnects, the server should not immediately terminate the Claude child process. The original behavior caused in-flight streaming tasks to be lost whenever a client went to the background or briefly lost connectivity.

## Goals

1. Keep the AI request running on the server after client disconnect.
2. Persist streamed output incrementally to the session history.
3. Allow clients to reconnect and resume receiving output through a poll plus SSE hybrid approach.

## Design Summary

### Before

```text
client disconnect -> res.on('close') -> child.kill('SIGTERM') -> task lost
```

### After

```text
client disconnect -> res.on('close') -> detach client -> task continues -> client can resume
```

## Core Changes

- Track active streams independently from the original HTTP response.
- Keep child processes alive when a client disconnects.
- Persist partial assistant output while streaming.
- Expose stream status and resume endpoints.
- Reattach later SSE clients to the same stream.

## Expected Result

Streaming sessions become resilient to brief disconnects, mobile app backgrounding, and browser tab refreshes without losing server-side work.
