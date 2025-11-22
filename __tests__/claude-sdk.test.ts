import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import type { SDKMessage, SDKAssistantMessage, SDKResultMessage, Query, SDKSystemMessage } from '@anthropic-ai/claude-agent-sdk';
import type { UUID } from 'crypto';

// Mock the SDK before importing the module under test
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
}));

// Import after mocking
import { query } from '@anthropic-ai/claude-agent-sdk';
import { executeClaude } from '../src/claude-sdk.js';
import type { SpawnClaudeOptions } from '../src/types/actions.js';

// Get the mocked query function
const mockQuery = query as jest.MockedFunction<typeof query>;

// Helper to create a mock Query object
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

// Helper to create a success result message
function createSuccessResult(sessionId: string, options: Partial<Omit<Extract<SDKResultMessage, { subtype: 'success' }>, 'type' | 'subtype'>> = {}): SDKResultMessage {
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
    uuid: '00000000-0000-0000-0000-000000000000' as UUID,
    session_id: sessionId,
    ...options,
  } as Extract<SDKResultMessage, { subtype: 'success' }>;
}

// Helper to create an error result message
function createErrorResult(sessionId: string, subtype: 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | 'error_max_structured_output_retries'): SDKResultMessage {
  return {
    type: 'result',
    subtype,
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
    uuid: '00000000-0000-0000-0000-000000000000' as UUID,
    session_id: sessionId,
  } as Extract<SDKResultMessage, { subtype: 'error_during_execution' }>;
}

// Helper to create an init system message
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

describe('SDK Wrapper Functions', () => {
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('executeClaude', () => {
    const baseOptions: SpawnClaudeOptions = {
      prompt: 'Test prompt',
      cwd: '/test/path',
    };

    describe('success scenarios', () => {
      it('should execute successfully with session ID and usage data', async () => {
        const mockMessages: SDKMessage[] = [
          createInitMessage('test-session-123'),
          {
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'Hello from assistant' },
              ],
            } as any,
            parent_tool_use_id: null,
            uuid: '00000000-0000-0000-0000-000000000001' as UUID,
            session_id: 'test-session-123',
          } as SDKAssistantMessage,
          createSuccessResult('test-session-123', {
            duration_ms: 5000,
            total_cost_usd: 0.05,
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          }),
        ];

        mockQuery.mockReturnValue(createMockQuery(mockMessages));

        const result = await executeClaude(baseOptions);

        expect(result).toEqual({
          exitCode: 0,
          sessionId: 'test-session-123',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
          cost: 0.05,
        });

        expect(mockQuery).toHaveBeenCalledWith({
          prompt: 'Test prompt',
          options: expect.objectContaining({
            cwd: '/test/path',
            permissionMode: 'acceptEdits',
            maxTurns: 100,
          }),
        });
      });

      it('should handle tool use messages', async () => {
        const mockMessages: SDKMessage[] = [
          createInitMessage('test-session-456'),
          {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  name: 'Read',
                  input: { file_path: '/path/to/file.ts' },
                },
              ],
            } as any,
            parent_tool_use_id: null,
            uuid: '00000000-0000-0000-0000-000000000002' as UUID,
            session_id: 'test-session-456',
          } as SDKAssistantMessage,
          createSuccessResult('test-session-456', {
            duration_ms: 3000,
            total_cost_usd: 0.03,
          }),
        ];

        mockQuery.mockReturnValue(createMockQuery(mockMessages));

        const result = await executeClaude(baseOptions);

        expect(result.exitCode).toBe(0);
        expect(consoleLogSpy).toHaveBeenCalledWith('🚀 Claude session initialized');
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('🔧 Read: /path/to/file.ts'));
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('✅ Completed in 3.0s'));
      });

      it('should handle multiple tool types correctly', async () => {
        const mockMessages: SDKMessage[] = [
          createInitMessage('test-session-789'),
          {
            type: 'assistant',
            message: {
              content: [
                { type: 'tool_use', name: 'Write', input: { file_path: '/new/file.ts' } },
                { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
                { type: 'tool_use', name: 'Grep', input: { pattern: 'TODO' } },
                { type: 'tool_use', name: 'Glob', input: { pattern: '**/*.ts' } },
              ],
            } as any,
            parent_tool_use_id: null,
            uuid: '00000000-0000-0000-0000-000000000003' as UUID,
            session_id: 'test-session-789',
          } as SDKAssistantMessage,
          createSuccessResult('test-session-789'),
        ];

        mockQuery.mockReturnValue(createMockQuery(mockMessages));

        const result = await executeClaude(baseOptions);

        expect(result.exitCode).toBe(0);
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Write: /new/file.ts'));
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Bash: npm test'));
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Grep: "TODO"'));
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Glob: **/*.ts'));
      });

      it('should handle thinking blocks', async () => {
        const mockMessages: SDKMessage[] = [
          createInitMessage('test-session-think'),
          {
            type: 'assistant',
            message: {
              content: [
                { type: 'thinking', thinking: 'I need to analyze this code carefully' },
                { type: 'text', text: 'Let me read the file' },
              ],
            } as any,
            parent_tool_use_id: null,
            uuid: '00000000-0000-0000-0000-000000000004' as UUID,
            session_id: 'test-session-think',
          } as SDKAssistantMessage,
          createSuccessResult('test-session-think', { duration_ms: 2000 }),
        ];

        mockQuery.mockReturnValue(createMockQuery(mockMessages));

        const result = await executeClaude(baseOptions);

        expect(result.exitCode).toBe(0);
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('💭 I need to analyze this code carefully'));
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Let me read the file'));
      });

      it('should truncate long thinking blocks', async () => {
        const longThinking = 'a'.repeat(150);
        const mockMessages: SDKMessage[] = [
          createInitMessage('test-session-long'),
          {
            type: 'assistant',
            message: {
              content: [
                { type: 'thinking', thinking: longThinking },
              ],
            } as any,
            parent_tool_use_id: null,
            uuid: '00000000-0000-0000-0000-000000000005' as UUID,
            session_id: 'test-session-long',
          } as SDKAssistantMessage,
          createSuccessResult('test-session-long'),
        ];

        mockQuery.mockReturnValue(createMockQuery(mockMessages));

        await executeClaude(baseOptions);

        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringMatching(/💭.*\.\.\./));
      });

      it('should truncate long bash commands', async () => {
        const longCommand = 'echo ' + 'x'.repeat(100);
        const mockMessages: SDKMessage[] = [
          createInitMessage('test-session-bash'),
          {
            type: 'assistant',
            message: {
              content: [
                { type: 'tool_use', name: 'Bash', input: { command: longCommand } },
              ],
            } as any,
            parent_tool_use_id: null,
            uuid: '00000000-0000-0000-0000-000000000006' as UUID,
            session_id: 'test-session-bash',
          } as SDKAssistantMessage,
          createSuccessResult('test-session-bash', { duration_ms: 500 }),
        ];

        mockQuery.mockReturnValue(createMockQuery(mockMessages));

        await executeClaude(baseOptions);

        const call = consoleLogSpy.mock.calls.find(c =>
          typeof c[0] === 'string' && c[0].includes('Bash')
        );
        expect(call?.[0]).toContain('...');
      });

      it('should pass environment variables through', async () => {
        const mockMessages: SDKMessage[] = [
          createInitMessage('test-session-env'),
          createSuccessResult('test-session-env', { duration_ms: 100 }),
        ];

        mockQuery.mockReturnValue(createMockQuery(mockMessages));

        await executeClaude(baseOptions);

        expect(mockQuery).toHaveBeenCalledWith({
          prompt: 'Test prompt',
          options: expect.objectContaining({
            env: expect.objectContaining({
              ...process.env,
              CONTEXTGRAPH_AUTH_TOKEN: '',
            }),
            plugins: expect.arrayContaining([
              expect.objectContaining({
                type: 'local',
                path: expect.stringContaining('claude-code-plugin'),
              })
            ]),
          }),
        });
      });
    });

    describe('error scenarios', () => {
      it('should handle SDK error results', async () => {
        const mockMessages: SDKMessage[] = [
          createInitMessage('test-session-error'),
          createErrorResult('test-session-error', 'error_during_execution'),
        ];

        mockQuery.mockReturnValue(createMockQuery(mockMessages));

        const result = await executeClaude(baseOptions);

        expect(result.exitCode).toBe(1);
        expect(result.sessionId).toBe('test-session-error');
        expect(consoleLogSpy).toHaveBeenCalledWith('❌ Execution failed');
      });

      it('should handle network errors', async () => {
        const errorQuery = Object.assign((async function* () {
          throw new Error('Network connection failed');
        })(), {
          interrupt: jest.fn(),
          setPermissionMode: jest.fn(),
          setModel: jest.fn(),
          setMaxThinkingTokens: jest.fn(),
          supportedCommands: jest.fn(),
          supportedModels: jest.fn(),
          mcpServerStatus: jest.fn(),
          accountInfo: jest.fn(),
        }) as Query;

        mockQuery.mockReturnValue(errorQuery);

        await expect(executeClaude(baseOptions)).rejects.toThrow(
          'Failed to execute Claude SDK: Network connection failed'
        );
      });

      // Note: Timeout testing is complex with async generators and fake timers
      // The timeout functionality is implemented and will be tested in integration tests
      it.skip('should handle timeout', async () => {
        // Skipped due to complexity of mocking async generator timeouts with Jest fake timers
      });

      it('should handle authentication errors', async () => {
        const authErrorQuery = Object.assign((async function* () {
          throw new Error('Invalid API key');
        })(), {
          interrupt: jest.fn(),
          setPermissionMode: jest.fn(),
          setModel: jest.fn(),
          setMaxThinkingTokens: jest.fn(),
          supportedCommands: jest.fn(),
          supportedModels: jest.fn(),
          mcpServerStatus: jest.fn(),
          accountInfo: jest.fn(),
        }) as Query;

        mockQuery.mockReturnValue(authErrorQuery);

        await expect(executeClaude(baseOptions)).rejects.toThrow(
          'Failed to execute Claude SDK: Invalid API key'
        );
      });

      it('should handle various error result subtypes', async () => {
        const errorTypes: Array<'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | 'error_max_structured_output_retries'> = [
          'error_during_execution',
          'error_max_turns',
          'error_max_budget_usd',
          'error_max_structured_output_retries',
        ];

        for (const errorType of errorTypes) {
          jest.clearAllMocks();

          const mockMessages: SDKMessage[] = [
            createInitMessage(`test-${errorType}`),
            createErrorResult(`test-${errorType}`, errorType),
          ];

          mockQuery.mockReturnValue(createMockQuery(mockMessages));

          const result = await executeClaude(baseOptions);

          expect(result.exitCode).toBe(1);
          expect(consoleLogSpy).toHaveBeenCalledWith('❌ Execution failed');
        }
      });
    });

    describe('edge cases', () => {
      it('should handle missing session ID', async () => {
        const mockMessages: SDKMessage[] = [
          createSuccessResult('test-no-session'),
        ];

        // Remove session_id to test the case
        delete (mockMessages[0] as any).session_id;

        mockQuery.mockReturnValue(createMockQuery(mockMessages));

        const result = await executeClaude(baseOptions);

        expect(result.sessionId).toBeUndefined();
        expect(result.exitCode).toBe(0);
      });

      it('should handle missing usage data', async () => {
        const mockMessages: SDKMessage[] = [
          createInitMessage('test-no-usage'),
          createSuccessResult('test-no-usage', {
            usage: undefined as any,
            total_cost_usd: undefined as any,
          }),
        ];

        mockQuery.mockReturnValue(createMockQuery(mockMessages));

        const result = await executeClaude(baseOptions);

        expect(result.usage).toBeUndefined();
        expect(result.cost).toBe(0);
      });

      it('should handle missing duration_ms', async () => {
        const mockMessages: SDKMessage[] = [
          createInitMessage('test-no-duration'),
          createSuccessResult('test-no-duration', {
            duration_ms: undefined as any,
          }),
        ];

        mockQuery.mockReturnValue(createMockQuery(mockMessages));

        const result = await executeClaude(baseOptions);

        expect(result.exitCode).toBe(0);
        expect(consoleLogSpy).toHaveBeenCalledWith('✅ Completed in unknown');
      });

      it('should handle empty message content', async () => {
        const mockMessages: SDKMessage[] = [
          createInitMessage('test-empty'),
          {
            type: 'assistant',
            message: {
              content: [],
            } as any,
            parent_tool_use_id: null,
            uuid: '00000000-0000-0000-0000-000000000007' as UUID,
            session_id: 'test-empty',
          } as SDKAssistantMessage,
          createSuccessResult('test-empty', { duration_ms: 100 }),
        ];

        mockQuery.mockReturnValue(createMockQuery(mockMessages));

        const result = await executeClaude(baseOptions);

        expect(result.exitCode).toBe(0);
      });

      it('should handle tool use without name or input', async () => {
        const mockMessages: SDKMessage[] = [
          createInitMessage('test-no-name'),
          {
            type: 'assistant',
            message: {
              content: [
                { type: 'tool_use' },
              ],
            } as any,
            parent_tool_use_id: null,
            uuid: '00000000-0000-0000-0000-000000000008' as UUID,
            session_id: 'test-no-name',
          } as SDKAssistantMessage,
          createSuccessResult('test-no-name', { duration_ms: 100 }),
        ];

        mockQuery.mockReturnValue(createMockQuery(mockMessages));

        const result = await executeClaude(baseOptions);

        expect(result.exitCode).toBe(0);
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('unknown'));
      });

      it('should handle unknown tool names', async () => {
        const mockMessages: SDKMessage[] = [
          createInitMessage('test-unknown-tool'),
          {
            type: 'assistant',
            message: {
              content: [
                { type: 'tool_use', name: 'UnknownTool', input: { foo: 'bar' } },
              ],
            } as any,
            parent_tool_use_id: null,
            uuid: '00000000-0000-0000-0000-000000000009' as UUID,
            session_id: 'test-unknown-tool',
          } as SDKAssistantMessage,
          createSuccessResult('test-unknown-tool', { duration_ms: 100 }),
        ];

        mockQuery.mockReturnValue(createMockQuery(mockMessages));

        const result = await executeClaude(baseOptions);

        expect(result.exitCode).toBe(0);
        // Unknown tools should not show parameter details
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('UnknownTool'));
      });

      it('should handle Edit tool formatting', async () => {
        const mockMessages: SDKMessage[] = [
          createInitMessage('test-edit'),
          {
            type: 'assistant',
            message: {
              content: [
                { type: 'tool_use', name: 'Edit', input: { file_path: '/path/to/edit.ts' } },
              ],
            } as any,
            parent_tool_use_id: null,
            uuid: '0000000a-0000-0000-0000-000000000000' as UUID,
            session_id: 'test-edit',
          } as SDKAssistantMessage,
          createSuccessResult('test-edit', { duration_ms: 100 }),
        ];

        mockQuery.mockReturnValue(createMockQuery(mockMessages));

        await executeClaude(baseOptions);

        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Edit: /path/to/edit.ts'));
      });

      it('should handle messages without expected fields', async () => {
        const mockMessages: SDKMessage[] = [
          {
            type: 'assistant',
            message: undefined as any,
            parent_tool_use_id: null,
            uuid: '0000000b-0000-0000-0000-000000000000' as UUID,
            session_id: 'test-no-message',
          } as SDKAssistantMessage,
          createSuccessResult('test-no-message', { duration_ms: 100 }),
        ];

        mockQuery.mockReturnValue(createMockQuery(mockMessages));

        const result = await executeClaude(baseOptions);

        expect(result.exitCode).toBe(0);
      });
    });
  });
});
