import { describe, it, expect } from '@jest/globals';
import os from 'os';
import { join } from 'path';
import {
  CLIENTS,
  getClient,
  resolveClientConfigPath,
  detectClients,
} from '../../src/install/clients.js';

describe('CLIENTS registry', () => {
  it('has unique ids', () => {
    const ids = CLIENTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes the major destinations', () => {
    const ids = CLIENTS.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['claude-code', 'cursor', 'codex', 'vscode', 'gemini']));
  });

  it('file-based clients declare at least one path; manual clients carry instructions', () => {
    for (const client of CLIENTS) {
      if (client.kind === 'mcp-json' || client.kind === 'mcp-toml') {
        expect(client.paths).toBeDefined();
        expect(Boolean(client.paths?.global || client.paths?.project)).toBe(true);
      }
      if (client.kind === 'mcp-json') {
        expect(['mcpServers', 'servers']).toContain(client.jsonKey);
      }
      if (client.kind === 'manual') {
        expect(client.manual).toBeTruthy();
      }
    }
  });
});

describe('resolveClientConfigPath', () => {
  it('resolves the project path for Cursor', () => {
    const cursor = getClient('cursor')!;
    expect(resolveClientConfigPath(cursor, 'project', '/repo')).toBe(join('/repo', '.cursor', 'mcp.json'));
  });

  it('resolves the global path for Cursor', () => {
    const cursor = getClient('cursor')!;
    expect(resolveClientConfigPath(cursor, 'global')).toBe(join(os.homedir(), '.cursor', 'mcp.json'));
  });

  it('falls back to global when a project path is unavailable (Codex)', () => {
    const codex = getClient('codex')!;
    expect(resolveClientConfigPath(codex, 'project', '/repo')).toBe(
      join(os.homedir(), '.codex', 'config.toml')
    );
  });

  it('falls back to project when a global path is unavailable (VS Code)', () => {
    const vscode = getClient('vscode')!;
    expect(resolveClientConfigPath(vscode, 'global', '/repo')).toBe(join('/repo', '.vscode', 'mcp.json'));
  });

  it('returns null for clients without file paths', () => {
    const manual = getClient('chatgpt')!;
    expect(resolveClientConfigPath(manual, 'global')).toBeNull();
  });

  it('uses the VS Code "servers" json key', () => {
    expect(getClient('vscode')!.jsonKey).toBe('servers');
  });
});

describe('detectClients', () => {
  it('does not throw and returns a subset of the registry', () => {
    const detected = detectClients();
    const ids = new Set(CLIENTS.map((c) => c.id));
    for (const client of detected) {
      expect(ids.has(client.id)).toBe(true);
    }
  });
});
