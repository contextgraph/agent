import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { SDKMessage, SDKResultMessage, Query, SDKSystemMessage } from '@anthropic-ai/claude-agent-sdk';
import type { UUID } from 'crypto';

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';
import { executeClaude } from '../src/claude-sdk.js';
import type { SpawnClaudeOptions } from '../src/types/actions.js';

const mockQuery = query as jest.MockedFunction<typeof query>;

function createMockQuery(messages: SDKMessage[]): Query {
  const generator = (async function* () {
    for (const msg of messages) {
      yield msg;
    }
  })();

  return Object.assign(generator, {
    interrupt: jest.fn() as any,
    setPermissionMode: jest.fn() as any,
    setModel: jest.fn() as any,
    setMaxThinkingTokens: jest.fn() as any,
    supportedCommands: jest.fn() as any,
    supportedModels: jest.fn() as any,
    mcpServerStatus: jest.fn() as any,
    accountInfo: jest.fn() as any,
  }) as Query;
}

function createInitMessage(sessionId: string): SDKSystemMessage {
  return {
    type: 'system',
    subtype: 'init',
    agents: [],
    apiKeySource: 'user',
    claude_code_version: '1.0.0',
    cwd: '/test',
    tools: [],
    mcp_servers: [],
    model: 'claude-3-5-sonnet-20241022',
    permissionMode: 'acceptEdits',
    slash_commands: [],
    output_style: 'default',
    skills: [],
    plugins: [],
    uuid: '00000000-0000-0000-0000-000000000000' as UUID,
    session_id: sessionId,
  };
}

function createSuccessResult(sessionId: string): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 1000,
    duration_api_ms: 900,
    is_error: false,
    num_turns: 1,
    result: 'success',
    total_cost_usd: 0.01,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    uuid: '00000000-0000-0000-0000-000000000001' as UUID,
    session_id: sessionId,
  } as Extract<SDKResultMessage, { subtype: 'success' }>;
}

function createErrorResult(sessionId: string): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'error_during_execution',
    duration_ms: 1000,
    duration_api_ms: 900,
    is_error: true,
    num_turns: 1,
    total_cost_usd: 0.01,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    errors: ['Test error'],
    uuid: '00000000-0000-0000-0000-000000000002' as UUID,
    session_id: sessionId,
  } as Extract<SDKResultMessage, { subtype: 'error_during_execution' }>;
}

describe('executeClaude result ordering', () => {
  const baseOptions: SpawnClaudeOptions = {
    prompt: 'Test prompt',
    cwd: '/test/path',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('uses the final result subtype when mixed result messages are emitted (error then success)', async () => {
    const sessionId = 'test-result-order';
    const messages: SDKMessage[] = [
      createInitMessage(sessionId),
      createErrorResult(sessionId),
      createSuccessResult(sessionId),
    ];

    mockQuery.mockReturnValue(createMockQuery(messages));

    const result = await executeClaude(baseOptions);

    expect(result.exitCode).toBe(0);
    expect(result.sessionId).toBe(sessionId);
  });
});
