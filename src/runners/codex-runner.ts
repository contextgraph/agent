import { spawn } from 'child_process';
import { createInterface } from 'readline';
import type { LogEvent } from '../log-transport.js';
import type { AgentRunResult } from '../types/actions.js';
import type { AgentRunner, RunnerExecuteOptions } from './types.js';

const EXECUTION_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes

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

  // Show readable progress messages when available.
  if (text && text !== type) {
    return `  ${text}`;
  }

  return null;
}

export const codexRunner: AgentRunner = {
  provider: 'codex',
  async execute(options: RunnerExecuteOptions): Promise<AgentRunResult> {
    return new Promise((resolve, reject) => {
      const args = [
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
        },
      });

      let sessionId: string | undefined;
      let usage: unknown;
      let cost: number | undefined;
      let sawInit = false;
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
      }, EXECUTION_TIMEOUT_MS);

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
        }
      };

      const stdoutRl = createInterface({ input: proc.stdout });
      stdoutRl.on('line', (line) => processLine(line, 'stdout'));

      const stderrRl = createInterface({ input: proc.stderr });
      stderrRl.on('line', (line) => processLine(line, 'stderr'));

      proc.on('error', (err) => {
        clearTimeout(timeout);
        stdoutRl.close();
        stderrRl.close();
        reject(new Error(`Failed to execute Codex CLI: ${err.message}`));
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
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
