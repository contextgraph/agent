import { describe, it, expect } from '@jest/globals';
import { buildMcpHeaderConfig } from '../../src/runners/codex-runner.js';

describe('buildMcpHeaderConfig', () => {
  it('should return config without execution action ID when includeExecutionActionId is false', () => {
    const result = buildMcpHeaderConfig({ includeExecutionActionId: false });

    expect(result).toBe(
      'mcp_servers.actions.env_http_headers={"x-authorization"="CONTEXTGRAPH_AUTH_HEADER"}'
    );
  });

  it('should return config with execution action ID when includeExecutionActionId is true', () => {
    const result = buildMcpHeaderConfig({ includeExecutionActionId: true });

    expect(result).toBe(
      'mcp_servers.actions.env_http_headers={"x-authorization"="CONTEXTGRAPH_AUTH_HEADER","x-contextgraph-execution-action-id"="CONTEXTGRAPH_EXECUTION_ACTION_ID"}'
    );
  });

  it('should always include x-authorization header in both configurations', () => {
    const withoutExecId = buildMcpHeaderConfig({ includeExecutionActionId: false });
    const withExecId = buildMcpHeaderConfig({ includeExecutionActionId: true });

    expect(withoutExecId).toContain('x-authorization');
    expect(withoutExecId).toContain('CONTEXTGRAPH_AUTH_HEADER');
    expect(withExecId).toContain('x-authorization');
    expect(withExecId).toContain('CONTEXTGRAPH_AUTH_HEADER');
  });

  it('should use proper Codex configuration syntax', () => {
    const result = buildMcpHeaderConfig({ includeExecutionActionId: false });

    // Verify it starts with the MCP server path
    expect(result).toMatch(/^mcp_servers\.actions\.env_http_headers=/);

    // Verify it uses proper JSON-like syntax with equals signs
    expect(result).toContain('{"x-authorization"="CONTEXTGRAPH_AUTH_HEADER"}');
  });

  it('should maintain header order with execution action ID header appearing after authorization', () => {
    const result = buildMcpHeaderConfig({ includeExecutionActionId: true });

    const authIndex = result.indexOf('x-authorization');
    const execIdIndex = result.indexOf('x-contextgraph-execution-action-id');

    expect(authIndex).toBeLessThan(execIdIndex);
  });
});
