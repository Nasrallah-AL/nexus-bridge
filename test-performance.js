const fs = require('fs');
const path = require('path');

// Generate mock session data
function generateSessions(count) {
  const sessions = [];
  const projectCount = Math.max(10, Math.floor(count / 5)); // Roughly one project for every five sessions

  for (let i = 0; i < count; i++) {
    const projectId = Math.floor(Math.random() * projectCount);
    sessions.push({
      id: `session-${i}`,
      project_path: `/home/user/workspace/project-${projectId}`,
      total_cost_usd: Math.random() * 2,
      messages_count: Math.floor(Math.random() * 20),
      status: 'active',
      created_at: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  return sessions;
}

// Aggregate project statistics (same as the real implementation)
function aggregateProjects(sessions) {
  const projectMap = new Map();

  for (const session of sessions) {
    const projectPath = session.project_path;

    if (!projectMap.has(projectPath)) {
      projectMap.set(projectPath, {
        project_path: projectPath,
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

    if (new Date(session.updated_at) > new Date(project.last_activity)) {
      project.last_activity = session.updated_at;
    }

    if (new Date(session.created_at) < new Date(project.created_at)) {
      project.created_at = session.created_at;
    }
  }

  return Array.from(projectMap.values());
}

// Performance test
async function runPerformanceTest() {
  const testCases = [
    { sessions: 100, label: '100 sessions' },
    { sessions: 500, label: '500 sessions' },
    { sessions: 1000, label: '1,000 sessions' },
    { sessions: 5000, label: '5,000 sessions' },
    { sessions: 10000, label: '10,000 sessions' },
    { sessions: 50000, label: '50,000 sessions' },
  ];

  console.log('\n=== Historical Project Query Performance Test ===\n');
  console.log('Scenario: read sessions → aggregate project statistics → return results\n');

  for (const test of testCases) {
    // Generate test data
    const sessions = generateSessions(test.sessions);

    // Simulate JSON serialization/deserialization overhead (similar to LowDB)
    const jsonStr = JSON.stringify({ sessions });
    const jsonSize = JSON.stringify({ sessions }).length;

    // Measure JSON.parse
    const parseStart = Date.now();
    const parsed = JSON.parse(jsonStr);
    const parseTime = Date.now() - parseStart;

    // Measure aggregation logic
    const aggregateStart = Date.now();
    const projects = aggregateProjects(parsed.sessions);
    const aggregateTime = Date.now() - aggregateStart;

    const totalTime = parseTime + aggregateTime;

    console.log(`📊 ${test.label}`);
    console.log(`   JSON size: ${(jsonSize / 1024).toFixed(2)} KB`);
    console.log(`   JSON.parse: ${parseTime} ms`);
    console.log(`   Aggregation: ${aggregateTime} ms`);
    console.log(`   Total time: ${totalTime} ms`);
    console.log(`   Project count: ${projects.length}`);
    console.log('');
  }

  console.log('=== Performance Analysis ===\n');
  console.log('Bottlenecks:');
  console.log('1. JSON.parse - scales with file size and is the main overhead');
  console.log('2. Aggregation - O(n) complexity and relatively fast');
  console.log('3. File I/O - synchronous reads of large files block the event loop\n');

  console.log('Recommendations:');
  console.log('✓ < 1,000 sessions: the current implementation is more than sufficient');
  console.log('✓ 1,000 - 10,000 sessions: acceptable, with some added latency');
  console.log('✓ > 10,000 sessions: consider adding caching or using a database\n');

  console.log('Caching options:');
  console.log('1. In-memory cache: refresh on a schedule (for example, every minute)');
  console.log('2. Incremental updates: update the cache when sessions are created');
  console.log('3. Separate storage: maintain a dedicated projects.json file');
  console.log('4. Replace JSON files with SQLite or PostgreSQL\n');
}

runPerformanceTest().catch(console.error);
