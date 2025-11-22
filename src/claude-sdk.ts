import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKResultMessage
} from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeResult, SpawnClaudeOptions } from './types/actions.js';

/**
 * Format tool input for display
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
 * Format tool use for console output
 */
function formatToolUse(content: {
  type: string;
  name?: string;
  input?: any;
  thinking?: string;
}): string {
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
 * Format assistant message for console output
 */
function formatAssistantMessage(message: SDKAssistantMessage['message']): void {
  if (!message.content || !Array.isArray(message.content)) return;

  for (const item of message.content) {
    if (item.type === 'text' && 'text' in item && item.text) {
      console.log(`  ${item.text}`);
    } else if (item.type === 'tool_use') {
      const formatted = formatToolUse({
        type: 'tool_use',
        name: item.name,
        input: item.input
      });
      if (formatted) console.log(formatted);
    }
  }
}

/**
 * Execute Claude using the SDK (parallel implementation to spawnClaude)
 *
 * This function provides the same interface as spawnClaude() but uses the
 * Claude Agent SDK instead of spawning a CLI process. It can be used as a
 * drop-in replacement for testing and comparison.
 *
 * @param options - Same options as spawnClaude
 * @returns Promise resolving to ClaudeResult with optional SDK-specific fields
 */
export async function executeClaude(
  options: SpawnClaudeOptions
): Promise<ClaudeResult> {
  let sessionId: string | undefined;
  let timeoutHandle: NodeJS.Timeout | undefined;
  let settled = false;

  // Create timeout promise (20 minutes like current implementation)
  const timeoutPromise = new Promise<ClaudeResult>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Claude SDK execution timed out after 20 minutes'));
      }
    }, 1200000);
  });

  // Create execution promise
  const executionPromise = (async (): Promise<ClaudeResult> => {
    try {
      console.log('🚀 Claude session initialized');

      const messages: SDKMessage[] = [];

      for await (const msg of query({
        prompt: options.prompt,
        options: {
          cwd: options.cwd,
          maxTurns: 50,
          permissionMode: 'acceptEdits',
          env: {
            ...(options.gitCredentials?.githubToken && {
              GITHUB_TOKEN: options.gitCredentials.githubToken
            }),
            ...(options.gitCredentials?.gitlabToken && {
              GITLAB_TOKEN: options.gitCredentials.gitlabToken
            })
          },
          hooks: {
            PreToolUse: [
              {
                hooks: [
                  async (input) => {
                    if (input.hook_event_name === 'PreToolUse') {
                      const summary = formatToolInput(input.tool_name, input.tool_input);
                      console.log(`  🔧 ${input.tool_name}${summary}`);
                    }
                    return {};
                  }
                ]
              }
            ]
          }
        }
      })) {
        messages.push(msg);

        // Track session ID from first message
        if (!sessionId && 'session_id' in msg) {
          sessionId = msg.session_id;
        }

        // Format and display messages
        if (msg.type === 'assistant' && 'message' in msg) {
          formatAssistantMessage(msg.message);
        } else if (msg.type === 'result') {
          const resultMsg = msg as SDKResultMessage;

          if (resultMsg.subtype === 'success') {
            const duration = resultMsg.duration_ms
              ? `${(resultMsg.duration_ms / 1000).toFixed(1)}s`
              : 'unknown';
            console.log(`✅ Completed in ${duration}`);

            if (!settled) {
              settled = true;
              return {
                exitCode: 0,
                sessionId,
                usage: resultMsg.usage ? {
                  inputTokens: resultMsg.usage.input_tokens,
                  outputTokens: resultMsg.usage.output_tokens
                } : undefined,
                cost: resultMsg.total_cost_usd
              };
            }
          } else {
            // Error result
            console.error('❌ Execution failed');

            if ('errors' in resultMsg && resultMsg.errors?.length > 0) {
              for (const error of resultMsg.errors) {
                console.error(`  Error: ${error}`);
              }
            }

            if (!settled) {
              settled = true;
              return {
                exitCode: 1,
                sessionId,
                usage: resultMsg.usage ? {
                  inputTokens: resultMsg.usage.input_tokens,
                  outputTokens: resultMsg.usage.output_tokens
                } : undefined,
                cost: resultMsg.total_cost_usd
              };
            }
          }
        }
      }

      // If we get here without a result, something went wrong
      if (!settled) {
        settled = true;
        return { exitCode: 1, sessionId };
      }

      return { exitCode: 1, sessionId };
    } catch (error) {
      if (!settled) {
        settled = true;
        console.error(`Error executing Claude: ${error}`);
        throw error;
      }
      throw error;
    }
  })();

  // Race between execution and timeout
  try {
    const result = await Promise.race([executionPromise, timeoutPromise]);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return result;
  } catch (error) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    throw error;
  }
}
