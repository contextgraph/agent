/**
 * SDK Event Transformer - Transforms Claude SDK messages into agentLog event format
 *
 * This module provides a pure transformation function that converts SDK messages
 * into LogEvent objects for the log streaming infrastructure.
 *
 * IMPORTANT: Events are emitted in the same format as the Vercel sandbox agents
 * to ensure compatibility with the AgentEventMessage component. The full SDK
 * message is preserved in the `data` field without truncation.
 */

import type { LogEvent } from './log-transport.js';
import type { SDKMessage, SDKAssistantMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * Transform an SDK message into a LogEvent
 *
 * The transformation preserves the full SDK message in the `data` field,
 * matching the Vercel sandbox format for UI compatibility.
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
  message: SDKMessage & { subtype?: string; content?: string },
  timestamp: string
): LogEvent {
  // Emit in the format expected by AgentEventMessage
  return {
    eventType: 'claude_message',
    content: message.content || `System: ${message.subtype || 'initialization'}`,
    data: {
      type: 'system',
      subtype: message.subtype,
      content: message.content,
      session_id: message.session_id,
    },
    timestamp,
  };
}

/**
 * Transform an assistant message (text, tool use, thinking)
 *
 * Preserves the full SDK message in the data field for UI rendering.
 * This matches the Vercel sandbox format where the entire SDK JSON
 * is stored in event.data.
 */
function transformAssistantMessage(
  message: SDKAssistantMessage,
  timestamp: string
): LogEvent | null {
  const content = message.message?.content;
  if (!content || !Array.isArray(content)) {
    return null;
  }

  // Generate a human-readable summary for the content field
  const contentSummary = generateContentSummary(content);

  // Emit the full SDK message structure in data for UI compatibility
  // This matches sandbox-execution.ts line 512-522
  return {
    eventType: 'claude_message',
    content: contentSummary,
    data: {
      type: 'assistant',
      message: message.message,
      session_id: message.session_id,
      parent_tool_use_id: message.parent_tool_use_id,
    },
    timestamp,
  };
}

/**
 * Transform a result message (completion status)
 *
 * Emits as claude_message with type='result' to match sandbox format.
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
    eventType: 'claude_message',
    content: isSuccess
      ? `Completed successfully in ${durationSec}s`
      : `Execution ${message.subtype}: ${durationSec}s`,
    data: {
      type: 'result',
      subtype: message.subtype,
      duration_ms: message.duration_ms,
      total_cost_usd: message.total_cost_usd,
      num_turns: message.num_turns,
      usage: message.usage,
      session_id: message.session_id,
    },
    timestamp,
  };
}

/**
 * Transform a user message (typically contains tool results)
 *
 * Preserves full tool result content for UI rendering.
 */
function transformUserMessage(
  message: SDKMessage & { message?: { content?: unknown } },
  timestamp: string
): LogEvent | null {
  const content = message.message?.content;
  if (!content || !Array.isArray(content)) {
    return null;
  }

  // Check if this contains tool results
  const hasToolResults = content.some(
    (block: any) => block.type === 'tool_result'
  );

  if (!hasToolResults) {
    return null;
  }

  // Generate summary for content field
  const summaries = content
    .filter((block: any) => block.type === 'tool_result')
    .map((block: any) => {
      const prefix = block.is_error ? '❌' : '✓';
      const resultText = extractToolResultText(block.content);
      return `${prefix} ${resultText.substring(0, 100)}${resultText.length > 100 ? '...' : ''}`;
    });

  // Emit full message structure in data for UI rendering
  return {
    eventType: 'claude_message',
    content: summaries.join('\n'),
    data: {
      type: 'user',
      message: message.message,
      session_id: message.session_id,
    },
    timestamp,
  };
}

/**
 * Generate a human-readable summary from message content blocks
 */
function generateContentSummary(content: unknown[]): string {
  const parts: string[] = [];

  for (const block of content as any[]) {
    if (block.type === 'text' && block.text) {
      // Include first 200 chars of text in summary
      const text = block.text.length > 200
        ? block.text.substring(0, 200) + '...'
        : block.text;
      parts.push(text);
    } else if (block.type === 'tool_use') {
      parts.push(`🔧 ${block.name}`);
    } else if (block.type === 'thinking') {
      parts.push('💭 [thinking]');
    }
  }

  return parts.join(' | ') || '[no content]';
}

/**
 * Extract text content from a tool result for summary purposes
 */
function extractToolResultText(
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
