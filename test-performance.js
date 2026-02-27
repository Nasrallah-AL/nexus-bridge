const fs = require('fs');
const path = require('path');

// 模拟会话数据生成
function generateSessions(count) {
  const sessions = [];
  const projectCount = Math.max(10, Math.floor(count / 5)); // 每5个会话大约1个项目

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

// 聚合项目统计（与实际实现相同）
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

// 性能测试
async function runPerformanceTest() {
  const testCases = [
    { sessions: 100, label: '100 会话' },
    { sessions: 500, label: '500 会话' },
    { sessions: 1000, label: '1,000 会话' },
    { sessions: 5000, label: '5,000 会话' },
    { sessions: 10000, label: '10,000 会话' },
    { sessions: 50000, label: '50,000 会话' },
  ];

  console.log('\n=== 历史项目查询性能测试 ===\n');
  console.log('测试场景: 读取会话 → 聚合项目统计 → 返回结果\n');

  for (const test of testCases) {
    // 生成测试数据
    const sessions = generateSessions(test.sessions);

    // 模拟 JSON 序列化/反序列化（LowDB 的开销）
    const jsonStr = JSON.stringify({ sessions });
    const jsonSize = JSON.stringify({ sessions }).length;

    // 测试 JSON.parse
    const parseStart = Date.now();
    const parsed = JSON.parse(jsonStr);
    const parseTime = Date.now() - parseStart;

    // 测试聚合逻辑
    const aggregateStart = Date.now();
    const projects = aggregateProjects(parsed.sessions);
    const aggregateTime = Date.now() - aggregateStart;

    const totalTime = parseTime + aggregateTime;

    console.log(`📊 ${test.label}`);
    console.log(`   JSON 大小: ${(jsonSize / 1024).toFixed(2)} KB`);
    console.log(`   JSON.parse: ${parseTime} ms`);
    console.log(`   聚合计算: ${aggregateTime} ms`);
    console.log(`   总耗时: ${totalTime} ms`);
    console.log(`   项目数量: ${projects.length}`);
    console.log('');
  }

  console.log('=== 性能分析 ===\n');
  console.log('瓶颈分析:');
  console.log('1. JSON.parse - 与文件大小成正比，主要开销');
  console.log('2. 聚合计算 - O(n) 复杂度，相对较快');
  console.log('3. 文件 I/O - 同步读取大文件会阻塞\n');

  console.log('优化建议:');
  console.log('✓ < 1,000 会话: 当前实现完全足够');
  console.log('✓ 1,000 - 10,000 会话: 可以接受，略有延迟');
  console.log('✓ > 10,000 会话: 建议添加缓存或使用数据库\n');

  console.log('缓存方案:');
  console.log('1. 内存缓存: 定期刷新（如每分钟）');
  console.log('2. 增量更新: 创建会话时更新缓存');
  console.log('3. 独立存储: 维护 projects.json 文件');
  console.log('4. 使用 SQLite/PostgreSQL 替代 JSON 文件\n');
}

runPerformanceTest().catch(console.error);
