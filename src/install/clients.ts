import os from 'os';
import { existsSync, accessSync, constants } from 'fs';
import { join, delimiter } from 'path';
import type { McpJsonKey } from './mcp-config.js';
import type { InstallScope } from './types.js';

/**
 * How a client consumes the steward MCP server:
 * - `claude-plugin`: install the Claude Code plugin (bundles MCP + skills + slash commands)
 * - `mcp-json`: merge a server entry into a JSON config file
 * - `mcp-toml`: merge a `[mcp_servers.*]` table into a TOML config file
 * - `manual`: UI/environment-only; we can only print instructions
 */
export type ClientKind = 'claude-plugin' | 'mcp-json' | 'mcp-toml' | 'manual';

export interface ClientPaths {
  global?: () => string;
  project?: (cwd: string) => string;
}

export interface ClientDef {
  id: string;
  label: string;
  kind: ClientKind;
  /** JSON map key (mcp-json only). */
  jsonKey?: McpJsonKey;
  /** Config file locations (file-based clients). */
  paths?: ClientPaths;
  /** Best-effort heuristic for whether this client is present on the machine. */
  detect: () => boolean;
  /** Printed for `manual` clients. */
  manual?: string;
  /** Note shown alongside the client in the picker. */
  note?: string;
}

function home(): string {
  return os.homedir();
}

/** Whether an executable named `cmd` is resolvable on PATH. */
export function commandExists(cmd: string): boolean {
  const pathEnv = process.env.PATH;
  if (!pathEnv) {
    return false;
  }
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, cmd + ext);
      try {
        accessSync(candidate, constants.X_OK);
        return true;
      } catch {
        // keep scanning
      }
    }
  }
  return false;
}

function dirExists(p: string): boolean {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}

const CONNECTOR_INSTRUCTIONS =
  'Add a custom connector / remote MCP server pointing at the steward URL below ' +
  'through the app UI, then complete the browser authorization handoff.';

/**
 * Registry of install destinations. File-based clients all point at the same
 * remote HTTP MCP endpoint; only the file format and location differ.
 */
export const CLIENTS: ClientDef[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    kind: 'claude-plugin',
    detect: () => commandExists('claude'),
    note: 'installs the plugin (MCP + skills + /steward: commands)',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    kind: 'mcp-json',
    jsonKey: 'mcpServers',
    paths: {
      global: () => join(home(), '.cursor', 'mcp.json'),
      project: (cwd) => join(cwd, '.cursor', 'mcp.json'),
    },
    detect: () => commandExists('cursor') || dirExists(join(home(), '.cursor')),
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    kind: 'mcp-toml',
    paths: {
      global: () => join(home(), '.codex', 'config.toml'),
    },
    detect: () => commandExists('codex') || dirExists(join(home(), '.codex')),
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    kind: 'mcp-json',
    jsonKey: 'mcpServers',
    paths: {
      global: () => join(home(), '.codeium', 'windsurf', 'mcp_config.json'),
    },
    detect: () => commandExists('windsurf') || dirExists(join(home(), '.codeium')),
  },
  {
    id: 'vscode',
    label: 'VS Code (native MCP)',
    kind: 'mcp-json',
    jsonKey: 'servers',
    paths: {
      project: (cwd) => join(cwd, '.vscode', 'mcp.json'),
    },
    detect: () => commandExists('code') || dirExists(join(process.cwd(), '.vscode')),
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    kind: 'mcp-json',
    jsonKey: 'mcpServers',
    paths: {
      global: () => join(home(), '.gemini', 'settings.json'),
      project: (cwd) => join(cwd, '.gemini', 'settings.json'),
    },
    detect: () => commandExists('gemini') || dirExists(join(home(), '.gemini')),
  },
  {
    id: 'claude-desktop',
    label: 'Claude desktop / claude.ai',
    kind: 'manual',
    detect: () => false,
    manual: CONNECTOR_INSTRUCTIONS,
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    kind: 'manual',
    detect: () => false,
    manual: CONNECTOR_INSTRUCTIONS,
  },
];

export function getClient(id: string): ClientDef | undefined {
  return CLIENTS.find((c) => c.id === id);
}

/** Clients that look present on this machine. */
export function detectClients(): ClientDef[] {
  return CLIENTS.filter((c) => {
    try {
      return c.detect();
    } catch {
      return false;
    }
  });
}

/**
 * Resolve the config file path for a file-based client at a scope, falling back
 * to whichever scope the client supports. Returns null for clients with no
 * file path at the requested (or any) scope.
 */
export function resolveClientConfigPath(
  client: ClientDef,
  scope: InstallScope,
  cwd: string = process.cwd()
): string | null {
  const paths = client.paths;
  if (!paths) {
    return null;
  }
  if (scope === 'global') {
    if (paths.global) return paths.global();
    if (paths.project) return paths.project(cwd);
    return null;
  }
  if (paths.project) return paths.project(cwd);
  if (paths.global) return paths.global();
  return null;
}
