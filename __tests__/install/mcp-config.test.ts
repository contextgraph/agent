import { describe, it, expect } from '@jest/globals';
import {
  upsertMcpServerJson,
  hasMcpServerJson,
  upsertMcpServerToml,
  hasMcpServerToml,
  type McpHttpEntry,
} from '../../src/install/mcp-config.js';

const entry: McpHttpEntry = { type: 'http', url: 'https://mcp.steward.foo' };

describe('upsertMcpServerJson', () => {
  it('creates the config from empty/null input', () => {
    const result = upsertMcpServerJson(null, 'mcpServers', 'steward', entry);
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({ mcpServers: { steward: { type: 'http', url: 'https://mcp.steward.foo' } } });
    expect(result.endsWith('\n')).toBe(true);
  });

  it('preserves existing servers and unrelated keys', () => {
    const existing = JSON.stringify({
      someOtherKey: { keep: true },
      mcpServers: { other: { type: 'http', url: 'https://example.com' } },
    });
    const result = JSON.parse(upsertMcpServerJson(existing, 'mcpServers', 'steward', entry));
    expect(result.someOtherKey).toEqual({ keep: true });
    expect(result.mcpServers.other).toEqual({ type: 'http', url: 'https://example.com' });
    expect(result.mcpServers.steward).toEqual(entry);
  });

  it('overwrites an existing steward entry idempotently', () => {
    const first = upsertMcpServerJson(null, 'mcpServers', 'steward', entry);
    const second = upsertMcpServerJson(first, 'mcpServers', 'steward', entry);
    expect(second).toBe(first);
  });

  it('supports the VS Code "servers" key', () => {
    const result = JSON.parse(upsertMcpServerJson(null, 'servers', 'steward', entry));
    expect(result.servers.steward).toEqual(entry);
    expect(result.mcpServers).toBeUndefined();
  });

  it('refuses to overwrite invalid JSON', () => {
    expect(() => upsertMcpServerJson('{not json', 'mcpServers', 'steward', entry)).toThrow(/not valid JSON/);
  });

  it('refuses to overwrite a non-object JSON document', () => {
    expect(() => upsertMcpServerJson('[]', 'mcpServers', 'steward', entry)).toThrow(/not a JSON object/);
  });
});

describe('hasMcpServerJson', () => {
  it('detects presence and absence', () => {
    const config = upsertMcpServerJson(null, 'mcpServers', 'steward', entry);
    expect(hasMcpServerJson(config, 'mcpServers', 'steward')).toBe(true);
    expect(hasMcpServerJson(config, 'mcpServers', 'other')).toBe(false);
    expect(hasMcpServerJson(null, 'mcpServers', 'steward')).toBe(false);
  });
});

describe('upsertMcpServerToml', () => {
  it('creates the table from empty input', () => {
    const result = upsertMcpServerToml(null, 'steward', entry.url);
    expect(result).toBe('[mcp_servers.steward]\nurl = "https://mcp.steward.foo"\n');
  });

  it('appends to existing config preserving other tables', () => {
    const existing = '[mcp_servers.other]\nurl = "https://example.com"\n';
    const result = upsertMcpServerToml(existing, 'steward', entry.url);
    expect(result).toContain('[mcp_servers.other]');
    expect(result).toContain('url = "https://example.com"');
    expect(result).toContain('[mcp_servers.steward]');
    expect(result).toContain('url = "https://mcp.steward.foo"');
  });

  it('replaces an existing steward table without touching following tables', () => {
    const existing =
      '[mcp_servers.steward]\nurl = "https://old.example.com"\nextra = "drop"\n\n[other]\nkeep = true\n';
    const result = upsertMcpServerToml(existing, 'steward', entry.url);
    expect(result).toContain('url = "https://mcp.steward.foo"');
    expect(result).not.toContain('old.example.com');
    expect(result).not.toContain('extra = "drop"');
    expect(result).toContain('[other]');
    expect(result).toContain('keep = true');
  });

  it('is idempotent', () => {
    const first = upsertMcpServerToml('[tools]\nx = 1\n', 'steward', entry.url);
    const second = upsertMcpServerToml(first, 'steward', entry.url);
    expect(second).toBe(first);
  });
});

describe('hasMcpServerToml', () => {
  it('detects presence and absence', () => {
    expect(hasMcpServerToml('[mcp_servers.steward]\nurl = "x"', 'steward')).toBe(true);
    expect(hasMcpServerToml('[mcp_servers.other]\nurl = "x"', 'steward')).toBe(false);
    expect(hasMcpServerToml(null, 'steward')).toBe(false);
  });
});
