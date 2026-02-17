import { spawn } from 'child_process';
import { createInterface } from 'readline';
import type { LogEvent } from '../log-transport.js';
import type { AgentRunResult } from '../types/actions.js';
import type { AgentRunner, RunnerExecuteOptions } from './types.js';

const EXECUTION_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
const CONTEXTGRAPH_MCP_URL = 'https://mcp.contextgraph.dev';

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
  async execute(options: RunnerExecuteOptions): Promise<AgentRunResult> {
    return new Promise((resolve, reject) => {
      const args = [
        '-c', `mcp_servers.actions.url="${CONTEXTGRAPH_MCP_URL}"`,
        '-c', 'mcp_servers.actions.bearer_token_env_var="CONTEXTGRAPH_AUTH_TOKEN"',
        '-c', 'mcp_servers.actions.env_http_headers={"x-authorization"="CONTEXTGRAPH_AUTH_HEADER"}',
        'exec',
        '--json',
        '--sandbox', 'workspace-write',
        '--full-auto',
        '--skip-git-repo-check',
        '--cd', options.cwd,
      ];

      if (options.model) {
        args.push('--model', options.model);
      }

      args.push(options.prompt);

      const proc = spawn('codex', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CONTEXTGRAPH_AUTH_TOKEN: options.authToken || '',
          CONTEXTGRAPH_AUTH_HEADER: `Bearer ${options.authToken || ''}`,
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
        emitLogEvent(options.onLogEvent, 'claude_message', text, { provider: 'codex', ...event });

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
