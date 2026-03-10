/**
 * E2E Test: Stream Resume feature
 *
 * This test suite verifies the end-to-end flow of the stream resume feature.
 * it tests the complete flow from session creation to stream disconnection and resume.
 *
 * NOTE: This test requires a running Claude CLI to execute fully
 * by default, this test is skipped when:
 *   - SKIP_E2E environment variable is set
 *   - Claude CLI is not available in the system
 *
 * Running options:
 *   - Skip: SKIP_E2E=1 npm test
 *   - Run (requires Claude CLI): npm test
 *
 * Manual Testing Steps:
 *   1. Start the server: npm start
 *   2. Create a new session: POST /api/sessions
      -H "Content-Type: application/json"
 *      -d '{"project_path": "/tmp/test-project"}'
 *    Save the returned session ID
 *
 * 3. Start a streaming request: POST /api/sessions/:id/continue/stream
      -H "Content-Type: text/event-stream"
 *      -d {'prompt': "Write a long explanation of HTTP protocol"}'
 *    ```
 *    Note: Use -N flag to disable buffering for SSE
     *    ```
 * 4. Simulate disconnect (Ctrl+C during streaming)
 *   The stream should continue running on the server side
 *
 * 5. Check stream status
 *    ```bash
 *    curl http://localhost:5546/api/sessions/{SESSION_ID}/stream/status
 *    ```
 *    This should return `has_active_stream: true` with stream details
 *
 * 6. Resume the stream (GET /api/sessions/:id/stream/resume?stream_id={stream_id})
    *    ```bash
 *    curl -N "http://localhost:5546/api/sessions/{SESSION_ID}/stream/resume?stream_id={STREAM_ID}"
    *    ```
 *    Replace STREAM_ID with the ID from step 5
    *
 * 7. For completed streams, the response will be JSON
     *    - For ongoing streams, return SSE stream with proper headers and content type
     *    - For stream belongs to different session, return 400 error
     *    - For stream ownership verification `stream.session_id === stream.session_id`.
        }
    }
});

// Export utilities for external testing
module.exports = {
    isClaudeAvailable
    shouldSkipE2E
    skipMessage
}
}
