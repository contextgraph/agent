import { query, type SDKMessage, type SDKAssistantMessage, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeResult, SpawnClaudeOptions } from './types/actions.js';

// Helper types for SDK message content
type SDKMessageContent = {
  type: string;
  text?: string;
  name?: string;
  input?: any;
  thinking?: string;
};

/**
 * Format tool use for console output
 */
function formatToolUse(content: SDKMessageContent): string {
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

/**
 * Format tool input parameters for display
 */
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

/**
 * Format assistant message content for display
 */
function formatAssistantMessage(content: Array<SDKMessageContent>): string {
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

/**
 * Format SDK message for console output
 */
function formatMessage(message: SDKMessage): string | null {
  switch (message.type) {
    case 'system':
      if (message.subtype === 'init') {
        return '🚀 Claude session initialized';
      }
      return null;

    case 'assistant':
      const assistantMsg = message as SDKAssistantMessage;
      if (assistantMsg.message?.content) {
        return formatAssistantMessage(assistantMsg.message.content as any);
      }
      return null;

    case 'result':
      const resultMsg = message as SDKResultMessage;
      if (resultMsg.subtype === 'success') {
        const duration = resultMsg.duration_ms ? `${(resultMsg.duration_ms / 1000).toFixed(1)}s` : 'unknown';
        return `✅ Completed in ${duration}`;
      } else if (resultMsg.subtype.startsWith('error_')) {
        return '❌ Execution failed';
      }
      return null;

    default:
      return null;
  }
}

/**
 * Execute Claude using the Agent SDK
 *
 * This is a drop-in replacement for spawnClaude() that uses the SDK instead of spawning a CLI process.
 * It matches the same interface (SpawnClaudeOptions) and returns the same result type (ClaudeResult).
 */
export async function executeClaude(
  options: SpawnClaudeOptions
): Promise<ClaudeResult> {
  const startTime = Date.now();
  let sessionId: string | undefined;
  let totalCost = 0;
  let usage: any;

  // Create abort controller for timeout
  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort();
  }, 1200000); // 20 minute timeout

  try {
    // Create the query with SDK
    const iterator = query({
      prompt: options.prompt,
      options: {
        cwd: options.cwd,
        abortController,
        permissionMode: 'acceptEdits', // Match default behavior
        maxTurns: 100, // Reasonable limit
        env: process.env, // Pass through environment
      }
    });

    // Iterate through messages
    for await (const message of iterator) {
      // Capture session ID from first message
      if (!sessionId && message.session_id) {
        sessionId = message.session_id;
      }

      // Format and display the message
      const formatted = formatMessage(message);
      if (formatted) {
        console.log(formatted);
      }

      // Capture result metadata
      if (message.type === 'result') {
        const resultMsg = message as SDKResultMessage;
        totalCost = resultMsg.total_cost_usd || 0;
        usage = resultMsg.usage;

        // Check for errors
        if (resultMsg.subtype.startsWith('error_')) {
          clearTimeout(timeout);
          return {
            exitCode: 1,
            sessionId,
            usage,
            cost: totalCost,
          };
        }
      }
    }

    clearTimeout(timeout);

    // Return successful result
    return {
      exitCode: 0,
      sessionId,
      usage,
      cost: totalCost,
    };

  } catch (error) {
    clearTimeout(timeout);

    // Handle abort/timeout
    if (abortController.signal.aborted) {
      throw new Error('Claude SDK execution timed out after 20 minutes');
    }

    // Handle other errors
    throw new Error(`Failed to execute Claude SDK: ${(error as Error).message}`);
  }
}
