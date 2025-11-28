/**
 * SDK Event Transformer - Transforms Claude SDK messages into agentLog event format
 *
 * This module provides a pure transformation function that converts SDK messages
 * into LogEvent objects for the log streaming infrastructure.
 */

import type { LogEvent, LogEventType } from './log-transport.js';
import type { SDKMessage, SDKAssistantMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

// Constants for content truncation
const TOOL_OUTPUT_TRUNCATE_LENGTH = 500;
const TEXT_CONTENT_TRUNCATE_LENGTH = 2000;

/**
 * Content block types from SDK messages
 */
interface TextContent {
  type: 'text';
  text: string;
}

interface ToolUseContent {
  type: 'tool_use';
  id?: string;
  name: string;
  input: Record<string, unknown>;
}

interface ThinkingContent {
  type: 'thinking';
  thinking: string;
}

interface ToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content?: string | Array<{ type: string; text?: string }>;
  is_error?: boolean;
}

type MessageContent = TextContent | ToolUseContent | ThinkingContent | ToolResultContent;

/**
 * Transform an SDK message into a LogEvent
 *
 * @param message - The SDK message to transform
 * @returns A LogEvent or null if the message should be skipped
 */
export function transformSDKMessage(message: SDKMessage): LogEvent | null {
  const timestamp = new Date().toISOString();

  switch (message.type) {
    case 'system':
      return transformSystemMessage(message, timestamp);

    case 'assistant':
      return transformAssistantMessage(message as SDKAssistantMessage, timestamp);

    case 'result':
      return transformResultMessage(message as SDKResultMessage, timestamp);

    case 'user':
      // User messages with tool results
      return transformUserMessage(message, timestamp);

    default:
      // Skip unknown message types
      return null;
  }
}

/**
 * Transform a system message (initialization, etc.)
 */
function transformSystemMessage(
  message: SDKMessage & { subtype?: string },
  timestamp: string
): LogEvent | null {
  if (message.subtype === 'init') {
    return {
      eventType: 'system',
      content: 'Claude session initialized',
      data: {
        subtype: 'init',
        sessionId: message.session_id,
      },
      timestamp,
    };
  }

  // Generic system message
  return {
    eventType: 'system',
    content: `System event: ${message.subtype || 'unknown'}`,
    data: { subtype: message.subtype },
    timestamp,
  };
}

/**
 * Transform an assistant message (text, tool use, thinking)
 */
function transformAssistantMessage(
  message: SDKAssistantMessage,
  timestamp: string
): LogEvent | null {
  const content = message.message?.content;
  if (!content || !Array.isArray(content)) {
    return null;
  }

  // Process content blocks
  const textParts: string[] = [];
  const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];

  for (const block of content as MessageContent[]) {
    if (block.type === 'text' && block.text) {
      textParts.push(truncateText(block.text, TEXT_CONTENT_TRUNCATE_LENGTH));
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        name: block.name,
        input: extractToolInputSummary(block.name, block.input),
      });
    }
    // Skip 'thinking' blocks - low value for logs per spec
  }

  // If there are tool calls, emit a tool_use event
  if (toolCalls.length > 0) {
    const toolSummary = toolCalls
      .map(tc => formatToolCallSummary(tc.name, tc.input))
      .join(', ');

    return {
      eventType: 'tool_use',
      content: toolSummary,
      data: {
        role: 'assistant',
        toolCalls,
        hasText: textParts.length > 0,
      },
      timestamp,
    };
  }

  // If there's only text, emit a claude_message event
  if (textParts.length > 0) {
    return {
      eventType: 'claude_message',
      content: textParts.join('\n'),
      data: {
        role: 'assistant',
      },
      timestamp,
    };
  }

  return null;
}

/**
 * Transform a result message (completion status)
 */
function transformResultMessage(
  message: SDKResultMessage,
  timestamp: string
): LogEvent {
  const isSuccess = message.subtype === 'success';
  const durationSec = message.duration_ms
    ? (message.duration_ms / 1000).toFixed(1)
    : 'unknown';

  return {
    eventType: 'system',
    content: isSuccess
      ? `Completed successfully in ${durationSec}s`
      : `Execution failed: ${message.subtype}`,
    data: {
      subtype: message.subtype,
      success: isSuccess,
      durationMs: message.duration_ms,
      totalCostUsd: message.total_cost_usd,
      usage: message.usage,
    },
    timestamp,
  };
}

/**
 * Transform a user message (typically contains tool results)
 */
function transformUserMessage(
  message: SDKMessage & { message?: { content?: unknown } },
  timestamp: string
): LogEvent | null {
  const content = message.message?.content;
  if (!content || !Array.isArray(content)) {
    return null;
  }

  // Look for tool results
  const toolResults: Array<{
    toolUseId: string;
    result: string;
    isError: boolean;
  }> = [];

  for (const block of content as MessageContent[]) {
    if (block.type === 'tool_result') {
      const resultContent = extractToolResultContent(block.content);
      toolResults.push({
        toolUseId: block.tool_use_id,
        result: truncateText(resultContent, TOOL_OUTPUT_TRUNCATE_LENGTH),
        isError: block.is_error || false,
      });
    }
  }

  if (toolResults.length > 0) {
    const summaries = toolResults.map(tr => {
      const prefix = tr.isError ? '❌' : '✓';
      return `${prefix} ${tr.result}`;
    });

    return {
      eventType: 'tool_result',
      content: summaries.join('\n'),
      data: {
        toolResults,
      },
      timestamp,
    };
  }

  return null;
}

/**
 * Extract a summary of tool input parameters for logging
 */
function extractToolInputSummary(
  toolName: string,
  input: Record<string, unknown>
): Record<string, unknown> {
  if (!input) return {};

  // Return relevant fields based on tool type
  switch (toolName) {
    case 'Read':
      return { file_path: input.file_path };

    case 'Edit':
    case 'Write':
      return {
        file_path: input.file_path,
        // Don't include actual content - too verbose
      };

    case 'Bash':
      return {
        command: truncateText(String(input.command || ''), 100),
        description: input.description,
      };

    case 'Grep':
      return {
        pattern: input.pattern,
        glob: input.glob,
        type: input.type,
      };

    case 'Glob':
      return {
        pattern: input.pattern,
        path: input.path,
      };

    case 'Task':
      return {
        description: input.description,
        subagent_type: input.subagent_type,
      };

    default:
      // For MCP tools and others, return a subset of keys
      return Object.fromEntries(
        Object.entries(input)
          .slice(0, 5)
          .map(([k, v]) => [k, typeof v === 'string' ? truncateText(v, 100) : v])
      );
  }
}

/**
 * Format a tool call for the content summary
 */
function formatToolCallSummary(
  name: string,
  input: Record<string, unknown>
): string {
  switch (name) {
    case 'Read':
      return `Read: ${input.file_path}`;

    case 'Edit':
    case 'Write':
      return `${name}: ${input.file_path}`;

    case 'Bash':
      return `Bash: ${input.command}`;

    case 'Grep':
      return `Grep: "${input.pattern}"`;

    case 'Glob':
      return `Glob: ${input.pattern}`;

    case 'Task':
      return `Task: ${input.description}`;

    default:
      return name;
  }
}

/**
 * Extract text content from a tool result
 */
function extractToolResultContent(
  content: string | Array<{ type: string; text?: string }> | undefined
): string {
  if (!content) return '';

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter(block => block.type === 'text' && block.text)
      .map(block => block.text)
      .join('\n');
  }

  return '';
}

/**
 * Truncate text to a maximum length
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Batch transform multiple SDK messages
 * Useful for processing message arrays from SDK iterations
 *
 * @param messages - Array of SDK messages
 * @returns Array of LogEvents (excluding nulls)
 */
export function transformSDKMessages(messages: SDKMessage[]): LogEvent[] {
  return messages
    .map(transformSDKMessage)
    .filter((event): event is LogEvent => event !== null);
}
