/**
 * Codex CLI Agent Runner
 *
 * This runner integrates with the Codex CLI to execute agent tasks. It differs from the
 * Claude SDK runner in several important ways that affect execution behavior, configuration,
 * and capabilities.
 *
 * ## Key Architectural Differences
 *
 * ### 1. Full-Auto Mode (Bypass Approvals)
 * - **Codex**: Uses `--full-auto` flag to suppress interactive prompts (unless bypassing sandbox)
 * - **Claude SDK**: Uses `permissionMode: 'bypassPermissions'` option
 * - **Impact**: Both achieve non-interactive execution, but through different mechanisms
 *
 * ### 2. Git Repository Check
 * - **Codex**: Uses `--skip-git-repo-check` flag to bypass repository validation
 * - **Claude SDK**: No equivalent flag (different architecture)
 * - **Impact**: Codex can execute in non-git directories when needed
 *
 * ### 3. Sandbox Behavior
 * - **Codex**: Configurable sandbox modes via `--sandbox <mode>` or `--dangerously-bypass-approvals-and-sandbox`
 *   - Default mode: 'danger-full-access'
 *   - Environment override: CONTEXTGRAPH_CODEX_SANDBOX_MODE
 *   - Full bypass: when executionMode === 'full-access'
 * - **Claude SDK**: Uses `permissionMode: 'bypassPermissions'` (no sandbox concept)
 * - **Impact**: Codex provides granular control over file system and network access
 *
 * ### 4. Model Selection
 * - **Codex**: Uses `--model <model>` flag when options.model is provided
 * - **Claude SDK**: Uses `model` option in query() config
 * - **Semantic Difference**: Both support model override, same API surface
 *
 * ### 5. Exit Code Semantics
 * - **Codex**: Returns exit code from spawned process (0 = success, 1+ = failure)
 * - **Claude SDK**: Returns 0 for successful completion, 1 for errors or timeouts
 * - **Impact**: Exit codes align but are derived from different execution models
 *
 * ### 6. MCP Server Configuration
 * - **Codex**: Configured via `-c` flags for URL, auth token, and HTTP headers
 *   - Uses environment variables for token values (CONTEXTGRAPH_AUTH_TOKEN)
 *   - Supports execution-scoped headers (x-contextgraph-execution-action-id)
 * - **Claude SDK**: Configured via `mcpServers` option object
 *   - Direct token embedding in headers object
 *   - Same execution-scoped header support
 * - **Impact**: Same capabilities, different configuration syntax
 *
 * ### 7. Event Streaming Format
 * - **Codex**: Emits JSON-formatted events via stdout with types like 'thread.started', 'turn.completed', 'item.*'
 * - **Claude SDK**: Returns SDK message objects with types like 'system', 'assistant', 'result'
 * - **Impact**: Both are normalized to LogEvent format for unified processing
 *
 * ### 8. Session Identification
 * - **Codex**: Uses `thread_id` from 'thread.started' event as sessionId
 * - **Claude SDK**: Uses `session_id` from first message
 * - **Impact**: Different field names, same purpose
 *
 * ### 9. Cost and Usage Tracking
 * - **Codex**: Extracts from event fields: total_cost_usd, cost_usd, or total_cost
 *   - Usage extracted from 'turn.completed' event.usage field
 * - **Claude SDK**: Extracts from result message: total_cost_usd and usage fields
 * - **Impact**: Same data, different event locations
 *
 * ### 10. Environment Cleanup
 * - **Codex**: Explicitly deletes sandbox-related env vars to avoid inheriting restrictive policies:
 *   - CODEX_SANDBOX_NETWORK_DISABLED
 *   - CODEX_SANDBOX
 *   - CODEX_SANDBOX_POLICY
 * - **Claude SDK**: No environment cleanup needed (no sandbox inheritance concerns)
 * - **Impact**: Codex prevents unintended sandbox restrictions from parent processes
 *
 * ### 11. Activity Heartbeat
 * - **Codex**: Implements 15-second idle threshold with "still working" console messages
 * - **Claude SDK**: No explicit heartbeat (relies on SDK message stream for activity indication)
 * - **Impact**: Codex provides better user feedback during long-running operations
 *
 * ### 12. Capabilities Declaration
 * - **Codex**: `fullAccessExecution: true` - can bypass all sandbox restrictions
 * - **Claude SDK**: `fullAccessExecution: false` - operates within SDK permission model
 * - **Impact**: Codex is preferred for operations requiring unrestricted system access
 *
 * ## When to Use Codex vs Claude SDK
 *
 * **Use Codex when:**
 * - Need unrestricted file system or network access
 * - Executing in non-git environments
 * - Require specific sandbox mode configuration
 * - Need activity heartbeat for long operations
 *
 * **Use Claude SDK when:**
 * - Standard agent execution within normal permissions
 * - Prefer library integration over CLI spawning
 * - Want tighter TypeScript integration
 * - Don't need full-access execution mode
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';
import type { LogEvent } from '../log-transport.js';
import type { AgentRunResult } from '../types/actions.js';
import type { AgentRunner, RunnerExecuteOptions } from './types.js';

const EXECUTION_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
const CONTEXTGRAPH_MCP_URL = 'https://mcp.contextgraph.dev';
const DEFAULT_CODEX_SANDBOX_MODE = 'danger-full-access';

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' ? (value as JsonObject) : null;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function emitLogEvent(
  onLogEvent: ((event: LogEvent) => void) | undefined,
  eventType: LogEvent['eventType'],
  content: string,
  data?: Record<string, unknown>
): void {
  if (!onLogEvent) return;
  onLogEvent({
    eventType,
    content,
    data,
    timestamp: new Date().toISOString(),
  });
}

function parseJsonLine(raw: string): JsonObject | null {
  try {
    const parsed = JSON.parse(raw);
    return asObject(parsed);
  } catch {
    return null;
  }
}

function extractEventText(event: JsonObject): string {
  const type = typeof event.type === 'string' ? event.type : 'event';
  const message = typeof event.message === 'string' ? event.message : undefined;
  const summary = typeof event.summary === 'string' ? event.summary : undefined;

  if (message) return message;
  if (summary) return summary;
  return type;
}

function extractNestedText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractNestedText(item);
      if (found) return found;
    }
    return undefined;
  }

  const obj = asObject(value);
  if (!obj) return undefined;

  const preferredKeys = ['text', 'message', 'summary', 'content', 'delta', 'output'];
  for (const key of preferredKeys) {
    if (key in obj) {
      const found = extractNestedText(obj[key]);
      if (found) return found;
    }
  }

  return undefined;
}

function compactPreview(value: unknown, maxLength: number = 160): string {
  try {
    const raw = JSON.stringify(value);
    if (!raw) return '';
    return raw.length > maxLength ? `${raw.slice(0, maxLength)}...` : raw;
  } catch {
    return '';
  }
}

function pickString(obj: JsonObject, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function summarizeItemEvent(type: string, event: JsonObject): string | null {
  if (!type.startsWith('item.')) return null;

  const item = asObject(event.item) ?? asObject(event.data) ?? asObject(event.payload);
  if (!item) {
    return `  [${type}]`;
  }

  const input = asObject(item.input);
  const itemType = pickString(item, ['type', 'kind', 'item_type', 'role']) || 'item';
  const toolName =
    pickString(item, ['tool_name', 'tool', 'name']) ||
    (input ? pickString(input, ['tool_name', 'tool', 'name']) : undefined);

  const detail =
    pickString(item, ['command', 'file_path', 'path', 'pattern', 'title']) ||
    (input ? pickString(input, ['command', 'file_path', 'path', 'pattern', 'title']) : undefined);

  const icon = type === 'item.started'
    ? '▶'
    : type === 'item.completed'
      ? '✓'
      : type === 'item.failed'
        ? '✗'
        : '•';

  const label = toolName ? `${itemType}/${toolName}` : itemType;
  if (detail) {
    return `  ${icon} ${label}: ${detail}`;
  }

  const nested = extractNestedText(item);
  if (nested && nested !== itemType) {
    return `  ${icon} ${label}: ${nested}`;
  }

  const preview = compactPreview(item);
  return preview ? `  ${icon} ${label} ${preview}` : `  ${icon} ${label}`;
}

function formatEventForConsole(event: JsonObject): string | null {
  const type = typeof event.type === 'string' ? event.type : '';
  const text = extractEventText(event);

  if (type === 'thread.started' || type === 'turn.started') {
    return null;
  }

  if (type === 'turn.completed') {
    return '✅ Codex turn completed';
  }

  if (type === 'turn.failed') {
    return `❌ ${text}`;
  }

  if (type === 'error') {
    return `❌ ${text}`;
  }

  const itemSummary = summarizeItemEvent(type, event);
  if (itemSummary) {
    return itemSummary;
  }

  const nested = extractNestedText(event);
  if (nested && nested !== type && nested !== text) {
    return `  ${nested}`;
  }

  // Show readable progress messages when available.
  if (text && text !== type) {
    return `  ${text}`;
  }

  if (type) {
    return `  [${type}]`;
  }

  return null;
}

export const codexRunner: AgentRunner = {
  provider: 'codex',
  capabilities: {
    fullAccessExecution: true,
  },
  async execute(options: RunnerExecuteOptions): Promise<AgentRunResult> {
    return new Promise((resolve, reject) => {
      const sandboxMode = process.env.CONTEXTGRAPH_CODEX_SANDBOX_MODE || DEFAULT_CODEX_SANDBOX_MODE;
      const mcpHeaderConfig = options.executionActionId
        ? 'mcp_servers.actions.env_http_headers={"x-authorization"="CONTEXTGRAPH_AUTH_HEADER","x-contextgraph-execution-action-id"="CONTEXTGRAPH_EXECUTION_ACTION_ID"}'
        : 'mcp_servers.actions.env_http_headers={"x-authorization"="CONTEXTGRAPH_AUTH_HEADER"}';
      const bypassSandbox = options.executionMode === 'full-access';
      const args = [
        '-c', `mcp_servers.actions.url="${CONTEXTGRAPH_MCP_URL}"`,
        '-c', 'mcp_servers.actions.bearer_token_env_var="CONTEXTGRAPH_AUTH_TOKEN"',
        '-c', mcpHeaderConfig,
        'exec',
        '--json',
        ...(bypassSandbox
          ? ['--dangerously-bypass-approvals-and-sandbox']
          : ['--sandbox', sandboxMode, '--full-auto']),
        '--skip-git-repo-check',
        '--cd', options.cwd,
      ];

      if (bypassSandbox) {
        console.log('  Codex sandbox mode: bypassed');
      } else if (sandboxMode !== DEFAULT_CODEX_SANDBOX_MODE) {
        console.log(`  Codex sandbox mode: ${sandboxMode}`);
      }

      if (options.model) {
        args.push('--model', options.model);
      }

      args.push(options.prompt);

      const childEnv = { ...process.env } as Record<string, string | undefined>;
      // Avoid inheriting restrictive sandbox flags from parent environments.
      delete childEnv.CODEX_SANDBOX_NETWORK_DISABLED;
      delete childEnv.CODEX_SANDBOX;
      delete childEnv.CODEX_SANDBOX_POLICY;

      const proc = spawn('codex', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...childEnv,
          CONTEXTGRAPH_AUTH_TOKEN: options.authToken || '',
          CONTEXTGRAPH_AUTH_HEADER: `Bearer ${options.authToken || ''}`,
          CONTEXTGRAPH_EXECUTION_ACTION_ID: options.executionActionId || '',
        },
      });

      let sessionId: string | undefined;
      let usage: unknown;
      let cost: number | undefined;
      let sawInit = false;
      let timedOut = false;
      let lastConsoleActivityAt = Date.now();

      const timeout = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
      }, EXECUTION_TIMEOUT_MS);

      const activityHeartbeat = setInterval(() => {
        const idleMs = Date.now() - lastConsoleActivityAt;
        if (idleMs >= 15000) {
          console.log('  … Codex is still working');
          lastConsoleActivityAt = Date.now();
        }
      }, 5000);

      const processLine = (rawLine: string, stream: 'stdout' | 'stderr'): void => {
        const line = rawLine.trim();
        if (!line) return;

        const event = parseJsonLine(line);
        if (!event) {
          emitLogEvent(options.onLogEvent, stream === 'stderr' ? 'stderr' : 'stdout', line, { provider: 'codex' });
          return;
        }

        const eventType = typeof event.type === 'string' ? event.type : 'unknown';

        if (eventType === 'thread.started') {
          const threadId = typeof event.thread_id === 'string' ? event.thread_id : undefined;
          if (threadId) {
            sessionId = threadId;
          }

          if (!sawInit) {
            sawInit = true;
            console.log('🚀 Codex session initialized');
            lastConsoleActivityAt = Date.now();
          }
        } else if (eventType === 'turn.completed' && asObject(event.usage)) {
          usage = event.usage;
        }

        const eventCost =
          asNumber(event.total_cost_usd) ??
          asNumber(event.cost_usd) ??
          asNumber(event.total_cost);
        if (eventCost !== undefined) {
          cost = eventCost;
        }

        const text = extractEventText(event);
        emitLogEvent(options.onLogEvent, 'agent_message', text, { provider: 'codex', ...event });

        const consoleLine = formatEventForConsole(event);
        if (consoleLine) {
          console.log(consoleLine);
          lastConsoleActivityAt = Date.now();
        }
      };

      const stdoutRl = createInterface({ input: proc.stdout });
      stdoutRl.on('line', (line) => processLine(line, 'stdout'));

      const stderrRl = createInterface({ input: proc.stderr });
      stderrRl.on('line', (line) => processLine(line, 'stderr'));

      proc.on('error', (err) => {
        clearTimeout(timeout);
        clearInterval(activityHeartbeat);
        stdoutRl.close();
        stderrRl.close();
        reject(new Error(`Failed to execute Codex CLI: ${err.message}`));
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        clearInterval(activityHeartbeat);
        stdoutRl.close();
        stderrRl.close();

        if (timedOut) {
          reject(new Error(`Codex execution timed out after ${EXECUTION_TIMEOUT_MS / (60 * 1000)} minutes`));
          return;
        }

        resolve({
          exitCode: code ?? 1,
          sessionId,
          usage,
          cost,
        });
      });
    });
  },
};
