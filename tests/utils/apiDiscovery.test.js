const { parseMcpListLine, parseMcpListOutput } = require('../../src/utils/apiDiscovery');

describe('apiDiscovery MCP parsing', () => {
  test('parseMcpListLine extracts name and status from connected output', () => {
    const parsed = parseMcpListLine('claude.ai Mermaid Chart: https://chatgpt.mermaid.ai/anthropic/mcp - ✓ Connected');

    expect(parsed).toEqual({
      raw: 'claude.ai Mermaid Chart: https://chatgpt.mermaid.ai/anthropic/mcp - ✓ Connected',
      name: 'MermaidChart',
      url: 'https://chatgpt.mermaid.ai/anthropic/mcp',
      status: 'Connected',
      statusSymbol: '✓',
      state: 'connected',
    });
  });

  test('parseMcpListLine extracts name and status from authentication-needed output', () => {
    const parsed = parseMcpListLine('claude.ai Zapier: https://mcp.zapier.com/api/v1/connect - ! Needs authentication');

    expect(parsed).toEqual(expect.objectContaining({
      name: 'Zapier',
      status: 'Needs authentication',
      statusSymbol: '!',
      state: 'needs_authentication',
    }));
  });

  test('parseMcpListLine extracts name and status from failed output', () => {
    const parsed = parseMcpListLine('claude.ai Docusign: https://mcp.docusign.com/mcp - ✗ Failed to connect');

    expect(parsed).toEqual(expect.objectContaining({
      name: 'Docusign',
      status: 'Failed to connect',
      statusSymbol: '✗',
      state: 'failed',
    }));
  });

  test('parseMcpListOutput ignores blank and invalid lines', () => {
    const parsed = parseMcpListOutput([
      '',
      'invalid line',
      'claude.ai Slack: https://mcp.slack.com/mcp - ✓ Connected',
    ].join('\n'));

    expect(parsed).toEqual([
      expect.objectContaining({
        name: 'Slack',
        status: 'Connected',
      }),
    ]);
  });
});

