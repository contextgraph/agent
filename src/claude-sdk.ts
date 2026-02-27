import { query, type SDKMessage, type SDKAssistantMessage, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentRunResult, AgentRunOptions } from './types/actions.js';
import { transformSDKMessage } from './sdk-event-transformer.js';
import type { LogEvent } from './log-transport.js';

// Constants for timeouts and truncation
const EXECUTION_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
const THINKING_TRUNCATE_LENGTH = 100;
const COMMAND_TRUNCATE_LENGTH = 60;

// Helper types for SDK message content
type ToolInput =
  | { file_path: string; old_string?: string; new_string?: string }  // Read, Edit, Write
  | { command: string; description?: string; timeout?: number }  // Bash
  | { pattern: string; glob?: string; type?: string; output_mode?: string }  // Grep
  | { pattern: string; path?: string }  // Glob
  | Record<string, unknown>;  // Other tools

type SDKMessageContent = {
  type: string;
  text?: string;
  name?: string;
  input?: ToolInput;
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
    const truncated = content.thinking.length > THINKING_TRUNCATE_LENGTH
      ? content.thinking.substring(0, THINKING_TRUNCATE_LENGTH) + '...'
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
      const truncated = cmd.length > COMMAND_TRUNCATE_LENGTH
        ? cmd.substring(0, COMMAND_TRUNCATE_LENGTH) + '...'
        : cmd;
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
        const initMsg = message as { skills?: string[] };
        const skillCount = initMsg.skills?.length ?? 0;
        if (skillCount > 0) {
          return `🚀 Claude session initialized\n📚 Skills loaded (${skillCount}): ${initMsg.skills!.join(', ')}`;
        }
        return '🚀 Claude session initialized\n📚 No skills loaded';
      }
      return null;

    case 'assistant':
      const assistantMsg = message as SDKAssistantMessage;
      if (assistantMsg.message?.content && Array.isArray(assistantMsg.message.content)) {
        return formatAssistantMessage(assistantMsg.message.content as Array<SDKMessageContent>);
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
 * Extended options for executeClaude with log streaming support
 */
export interface ExecuteClaudeOptions extends AgentRunOptions {
  /** Callback for log events - called for each SDK message transformed into a LogEvent */
  onLogEvent?: (event: LogEvent) => void;
  /** Optional model to use (e.g., 'claude-opus-4-5-20251101'). If not specified, uses SDK default (Sonnet). */
  model?: string;
  /** Session ID from loop wrapper for trace correlation */
  loopRunSessionId?: string;
}

/**
 * Execute Claude using the Agent SDK
 *
 * This is a drop-in replacement for spawnClaude() that uses the SDK instead of spawning a CLI process.
 * It matches the same interface (AgentRunOptions) and returns the same result type (AgentRunResult).
 *
 * Optionally accepts onLogEvent callback for real-time log streaming.
 */
export async function executeClaude(
  options: ExecuteClaudeOptions
): Promise<AgentRunResult> {
  let sessionId: string | undefined;
  let totalCost = 0;
  let usage: any;
  let lastResultSubtype: string | undefined;

  // Create abort controller for timeout
  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort();
  }, EXECUTION_TIMEOUT_MS);

  try {
    console.log('[Agent SDK] Auth token available:', !!options.authToken);
    console.log('[Agent SDK] Auth token prefix:', options.authToken?.substring(0, 20) + '...');
    console.log('[Agent SDK] Anthropic API key available:', !!process.env.ANTHROPIC_API_KEY);
    console.log('[Agent SDK] Claude OAuth token available:', !!process.env.CLAUDE_CODE_OAUTH_TOKEN);
    console.log('[Agent SDK] MCP server config:', JSON.stringify({
      type: 'http',
      url: 'https://mcp.contextgraph.dev',
      headers: { 'x-authorization': `Bearer ${options.authToken?.substring(0, 20)}...` },
    }));

    // Create the query with SDK using the plugin
    const iterator = query({
      prompt: options.prompt,
      options: {
        ...(options.model ? { model: options.model } : {}),
        cwd: options.cwd,
        abortController,
        permissionMode: 'bypassPermissions', // Allow MCP tools to execute automatically
        maxTurns: 100, // Reasonable limit
        // Enable skills: load from project .claude/skills/ and allow Skill tool
        settingSources: ['project'],
        allowedTools: [
          // Core file operations
          'Read', 'Write', 'Edit', 'MultiEdit',
          // Search tools
          'Grep', 'Glob',
          // Execution
          'Bash',
          // Skills
          'Skill',
          // Agent orchestration
          'Task',
          // User interaction
          'TodoWrite', 'AskUserQuestion',
          // Web access
          'WebFetch', 'WebSearch',
          // MCP tools (pattern match for contextgraph MCP server)
          'mcp__*',
        ],
        env: {
          ...process.env,
          CONTEXTGRAPH_AUTH_TOKEN: options.authToken || '',
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
          CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN || '',
          // Session ID from loop wrapper for trace correlation in observation infrastructure
          ...(options.loopRunSessionId ? { LOOP_RUN_SESSION_ID: options.loopRunSessionId } : {}),
        },
        // Configure MCP server directly with auth header (not via plugin, which has no auth)
        // Vercel strips Authorization header, so use x-authorization
        mcpServers: {
          actions: {
            type: 'http',
            url: 'https://mcp.contextgraph.dev',
            headers: {
              'x-authorization': `Bearer ${options.authToken}`,
              ...(options.executionActionId
                ? { 'x-contextgraph-execution-action-id': options.executionActionId }
                : {}),
            },
          },
        },
        // Skills are injected into workspace .claude/skills/ by injectSkills() in workspace-prep.ts
        // settingSources: ['project'] above picks them up — no plugin needed
      }
    });

    // Iterate through messages
    for await (const message of iterator) {
      // Capture session ID from first message
      if (!sessionId && message.session_id) {
        sessionId = message.session_id;
      }

      // Debug: log raw system messages to see MCP connection status
      if (message.type === 'system') {
        console.log('[Agent SDK] System message:', JSON.stringify(message, null, 2));
      }

      // Format and display the message (preserved console output)
      const formatted = formatMessage(message);
      if (formatted) {
        console.log(formatted);
      }

      // Transform and emit log event if callback is provided
      if (options.onLogEvent) {
        try {
          const logEvent = transformSDKMessage(message);
          if (logEvent) {
            options.onLogEvent(logEvent);
          }
        } catch (error) {
          // Log transformation errors but don't block execution
          console.error('[Log Transform]', error instanceof Error ? error.message : String(error));
        }
      }

      // Capture result metadata
      if (message.type === 'result') {
        const resultMsg = message as SDKResultMessage;
        lastResultSubtype = resultMsg.subtype;
        totalCost = resultMsg.total_cost_usd || 0;
        usage = resultMsg.usage;
      }
    }

    clearTimeout(timeout);

    const exitCode = lastResultSubtype?.startsWith('error_') ? 1 : 0;

    return {
      exitCode,
      sessionId,
      usage,
      cost: totalCost,
    };

  } catch (error) {
    clearTimeout(timeout);

    // Handle abort/timeout
    if (abortController.signal.aborted) {
      const timeoutMinutes = EXECUTION_TIMEOUT_MS / (60 * 1000);
      throw new Error(`Claude SDK execution timed out after ${timeoutMinutes} minutes`);
    }

    // Handle other errors
    throw new Error(`Failed to execute Claude SDK: ${(error as Error).message}`);
  }
}
