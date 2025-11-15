import { spawn } from 'child_process';
import { Writable } from 'stream';
import type { ClaudeResult, SpawnClaudeOptions } from './types/actions.js';

type ClaudeEvent = {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: {
    role: string;
    content: Array<{
      type: string;
      text?: string;
      name?: string;
      input?: any;
      thinking?: string;
    }>;
  };
  duration_ms?: number;
};

function formatToolUse(content: { type: string; name?: string; input?: any; thinking?: string }): string {
  if (content.type === 'tool_use') {
    const name = content.name || 'unknown';
    const summary = formatToolInput(name, content.input);
    return `  🔧 ${name}${summary}`;
  }
  if (content.type === 'thinking' && content.thinking) {
    const truncated = content.thinking.length > 100
      ? content.thinking.substring(0, 100) + '...'
      : content.thinking;
    return `  💭 ${truncated}`;
  }
  return '';
}

function formatToolInput(toolName: string, input: any): string {
  if (!input) return '';

  switch (toolName) {
    case 'Read':
      return `: ${input.file_path}`;
    case 'Edit':
    case 'Write':
      return `: ${input.file_path}`;
    case 'Bash':
      const cmd = input.command || '';
      const truncated = cmd.length > 60 ? cmd.substring(0, 60) + '...' : cmd;
      return `: ${truncated}`;
    case 'Grep':
      return `: "${input.pattern}"`;
    case 'Glob':
      return `: ${input.pattern}`;
    default:
      return '';
  }
}

function formatAssistantMessage(content: Array<{ type: string; text?: string; name?: string; input?: any; thinking?: string }>): string {
  const lines: string[] = [];

  for (const item of content) {
    if (item.type === 'text' && item.text) {
      lines.push(`  ${item.text}`);
    } else if (item.type === 'tool_use' || item.type === 'thinking') {
      const formatted = formatToolUse(item);
      if (formatted) lines.push(formatted);
    }
  }

  return lines.join('\n');
}

function formatEvent(event: ClaudeEvent): string | null {
  switch (event.type) {
    case 'system':
      if (event.subtype === 'init') {
        return '🚀 Claude session initialized';
      }
      return null;

    case 'assistant':
      if (event.message?.content) {
        return formatAssistantMessage(event.message.content);
      }
      return null;

    case 'result':
      if (event.subtype === 'success') {
        const duration = event.duration_ms ? `${(event.duration_ms / 1000).toFixed(1)}s` : 'unknown';
        return `✅ Completed in ${duration}`;
      } else if (event.subtype === 'error') {
        return '❌ Execution failed';
      }
      return null;

    default:
      return null;
  }
}

export async function spawnClaude(
  options: SpawnClaudeOptions
): Promise<ClaudeResult> {
  return new Promise((resolve, reject) => {
    // Use sh -c with cat | claude to avoid raw mode issues
    // This matches how the Vercel Sandbox executes Claude
    const claudeArgs = [
      '--print',                         // Non-interactive mode (required for --output-format)
      '--output-format', 'stream-json',  // Disable interactive UI
      '--verbose',
    ].map(arg => `'${arg.replace(/'/g, "'\\''")}'`).join(' ');

    const command = `cat | claude ${claudeArgs}`;

    let lineBuffer = '';

    // Create a writable stream to parse and format stdout
    const stdout = new Writable({
      write(chunk: Buffer, encoding: string, callback: Function) {
        try {
          lineBuffer += chunk.toString();
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;

            try {
              const event = JSON.parse(line) as ClaudeEvent;
              const formatted = formatEvent(event);
              if (formatted) {
                console.log(formatted);
              }
            } catch (parseError) {
              console.log(line);
            }
          }
        } catch (error) {
          console.error('Error processing stdout:', error);
        }
        callback();
      }
    });

    const shell = spawn('sh', ['-c', command], {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'inherit'], // stdin=pipe, stdout=pipe, stderr=inherit
      env: {
        ...process.env,
      },
    });

    // Pipe stdout through our formatter
    if (shell.stdout) {
      shell.stdout.pipe(stdout);
    }

    // Track if we've resolved/rejected to avoid hanging
    let settled = false;

    // Timeout to prevent hanging (20 minutes)
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        shell.kill('SIGTERM');
        reject(new Error('Claude CLI execution timed out after 20 minutes'));
      }
    }, 1200000);

    // Write prompt to stdin and close it
    if (shell.stdin) {
      shell.stdin.write(options.prompt);
      shell.stdin.end();
    }

    shell.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve({ exitCode: code || 0 });
      }
    });

    shell.on('error', (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Failed to spawn Claude: ${error.message}`));
      }
    });
  });
}
