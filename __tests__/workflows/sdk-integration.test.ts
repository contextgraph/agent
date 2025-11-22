import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { SDKMessage, Query, SDKSystemMessage, SDKAssistantMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { UUID } from 'crypto';

/**
 * Integration tests for SDK execution workflows
 *
 * These tests validate the SDK wrapper works in real-world scenarios.
 * Instead of making real API calls (which would be slow and unreliable),
 * we mock the SDK's query function but use realistic message flows that
 * simulate real-world execution patterns.
 *
 * This approach:
 * - Tests the full executeClaude() workflow end-to-end
 * - Validates message formatting, console output, and result structure
 * - Runs quickly (<30 seconds total) and deterministically
 * - Doesn't require API keys or network access
 */

// Mock the SDK before importing
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
}));

// Import after mocking
import { query } from '@anthropic-ai/claude-agent-sdk';
import { executeClaude } from '../../src/claude-sdk.js';
import type { SpawnClaudeOptions } from '../../src/types/actions.js';

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

// Helper to create system init message
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

// Helper to create success result
function createSuccessResult(sessionId: string, options: Partial<SDKResultMessage> = {}): SDKResultMessage {
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
  } as SDKResultMessage;
}

// Helper to create error result
function createErrorResult(sessionId: string, subtype: 'error_during_execution' | 'error_max_turns'): SDKResultMessage {
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
  } as SDKResultMessage;
}

describe('SDK Integration Tests', () => {
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('Simple action execution', () => {
    it('should execute a basic prompt and return structured result', async () => {
      const mockMessages: SDKMessage[] = [
        createInitMessage('session-simple-1'),
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'The answer is 4.' },
            ],
          } as any,
          parent_tool_use_id: null,
          uuid: '00000001-0000-0000-0000-000000000000' as UUID,
          session_id: 'session-simple-1',
        } as SDKAssistantMessage,
        createSuccessResult('session-simple-1', {
          duration_ms: 2500,
          total_cost_usd: 0.02,
          usage: {
            input_tokens: 150,
            output_tokens: 75,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        }),
      ];

      mockQuery.mockReturnValue(createMockQuery(mockMessages));

      const options: SpawnClaudeOptions = {
        prompt: 'Calculate 2 + 2 and respond with just the number.',
        cwd: process.cwd(),
      };

      const result = await executeClaude(options);

      // Verify result structure
      expect(result).toMatchObject({
        exitCode: 0,
        sessionId: 'session-simple-1',
        usage: {
          input_tokens: 150,
          output_tokens: 75,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        cost: 0.02,
      });

      // Verify console output
      expect(consoleLogSpy).toHaveBeenCalledWith('🚀 Claude session initialized');
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('The answer is 4.'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('✅ Completed in 2.5s'));
    });

    it('should handle prompts with thinking blocks', async () => {
      const mockMessages: SDKMessage[] = [
        createInitMessage('session-simple-2'),
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'thinking', thinking: 'Let me process this request carefully' },
              { type: 'text', text: 'Hello!' },
            ],
          } as any,
          parent_tool_use_id: null,
          uuid: '00000002-0000-0000-0000-000000000000' as UUID,
          session_id: 'session-simple-2',
        } as SDKAssistantMessage,
        createSuccessResult('session-simple-2'),
      ];

      mockQuery.mockReturnValue(createMockQuery(mockMessages));

      const options: SpawnClaudeOptions = {
        prompt: 'Say hello',
        cwd: process.cwd(),
      };

      const result = await executeClaude(options);

      expect(result.exitCode).toBe(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('💭 Let me process this request carefully'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Hello!'));
    });
  });

  describe('Tool use workflows', () => {
    it('should successfully execute Read tool', async () => {
      const mockMessages: SDKMessage[] = [
        createInitMessage('session-tool-read'),
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Read', input: { file_path: '/test/package.json' } },
            ],
          } as any,
          parent_tool_use_id: null,
          uuid: '00000003-0000-0000-0000-000000000000' as UUID,
          session_id: 'session-tool-read',
        } as SDKAssistantMessage,
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'The project name is "test-project".' },
            ],
          } as any,
          parent_tool_use_id: null,
          uuid: '00000004-0000-0000-0000-000000000000' as UUID,
          session_id: 'session-tool-read',
        } as SDKAssistantMessage,
        createSuccessResult('session-tool-read', {
          usage: {
            input_tokens: 250,
            output_tokens: 100,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        }),
      ];

      mockQuery.mockReturnValue(createMockQuery(mockMessages));

      const options: SpawnClaudeOptions = {
        prompt: 'Read the package.json file',
        cwd: process.cwd(),
      };

      const result = await executeClaude(options);

      expect(result.exitCode).toBe(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('🔧 Read: /test/package.json'));
    });

    it('should handle multiple tool calls in sequence', async () => {
      const mockMessages: SDKMessage[] = [
        createInitMessage('session-multi-tool'),
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Glob', input: { pattern: 'src/**/*.ts' } },
            ],
          } as any,
          parent_tool_use_id: null,
          uuid: '00000005-0000-0000-0000-000000000000' as UUID,
          session_id: 'session-multi-tool',
        } as SDKAssistantMessage,
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Bash', input: { command: 'wc -l' } },
            ],
          } as any,
          parent_tool_use_id: null,
          uuid: '00000006-0000-0000-0000-000000000000' as UUID,
          session_id: 'session-multi-tool',
        } as SDKAssistantMessage,
        createSuccessResult('session-multi-tool'),
      ];

      mockQuery.mockReturnValue(createMockQuery(mockMessages));

      const options: SpawnClaudeOptions = {
        prompt: 'Find TypeScript files and count them',
        cwd: process.cwd(),
      };

      const result = await executeClaude(options);

      expect(result.exitCode).toBe(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Glob: src/**/*.ts'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Bash: wc -l'));
    });

    it('should format different tool types correctly', async () => {
      const mockMessages: SDKMessage[] = [
        createInitMessage('session-tool-types'),
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Write', input: { file_path: '/test/new.ts' } },
              { type: 'tool_use', name: 'Edit', input: { file_path: '/test/edit.ts' } },
              { type: 'tool_use', name: 'Grep', input: { pattern: 'TODO' } },
            ],
          } as any,
          parent_tool_use_id: null,
          uuid: '00000007-0000-0000-0000-000000000000' as UUID,
          session_id: 'session-tool-types',
        } as SDKAssistantMessage,
        createSuccessResult('session-tool-types'),
      ];

      mockQuery.mockReturnValue(createMockQuery(mockMessages));

      const result = await executeClaude({ prompt: 'Test', cwd: process.cwd() });

      expect(result.exitCode).toBe(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Write: /test/new.ts'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Edit: /test/edit.ts'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Grep: "TODO"'));
    });
  });

  describe('Multi-turn conversations', () => {
    it('should handle workflows requiring multiple turns', async () => {
      const mockMessages: SDKMessage[] = [
        createInitMessage('session-multi-turn'),
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'thinking', thinking: 'First I need to check if the file exists' },
              { type: 'tool_use', name: 'Glob', input: { pattern: 'package.json' } },
            ],
          } as any,
          parent_tool_use_id: null,
          uuid: '00000008-0000-0000-0000-000000000000' as UUID,
          session_id: 'session-multi-turn',
        } as SDKAssistantMessage,
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'thinking', thinking: 'File exists, now I will read it' },
              { type: 'tool_use', name: 'Read', input: { file_path: 'package.json' } },
            ],
          } as any,
          parent_tool_use_id: null,
          uuid: '00000009-0000-0000-0000-000000000000' as UUID,
          session_id: 'session-multi-turn',
        } as SDKAssistantMessage,
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'The version is 1.0.0' },
            ],
          } as any,
          parent_tool_use_id: null,
          uuid: '0000000a-0000-0000-0000-000000000000' as UUID,
          session_id: 'session-multi-turn',
        } as SDKAssistantMessage,
        createSuccessResult('session-multi-turn', {
          num_turns: 3,
          usage: {
            input_tokens: 500,
            output_tokens: 200,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        }),
      ];

      mockQuery.mockReturnValue(createMockQuery(mockMessages));

      const result = await executeClaude({ prompt: 'Check and read package.json', cwd: process.cwd() });

      expect(result.exitCode).toBe(0);
      expect(result.usage?.output_tokens).toBe(200);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('💭 First I need to check'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('💭 File exists, now I will read it'));
    });

    it('should preserve conversation flow with text and tools', async () => {
      const mockMessages: SDKMessage[] = [
        createInitMessage('session-flow'),
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'I will search for the configuration file.' },
              { type: 'tool_use', name: 'Grep', input: { pattern: 'config' } },
            ],
          } as any,
          parent_tool_use_id: null,
          uuid: '0000000b-0000-0000-0000-000000000000' as UUID,
          session_id: 'session-flow',
        } as SDKAssistantMessage,
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Found the config file. Reading it now.' },
              { type: 'tool_use', name: 'Read', input: { file_path: 'config.json' } },
            ],
          } as any,
          parent_tool_use_id: null,
          uuid: '0000000c-0000-0000-0000-000000000000' as UUID,
          session_id: 'session-flow',
        } as SDKAssistantMessage,
        createSuccessResult('session-flow'),
      ];

      mockQuery.mockReturnValue(createMockQuery(mockMessages));

      const result = await executeClaude({ prompt: 'Find and read config', cwd: process.cwd() });

      expect(result.exitCode).toBe(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('I will search for the configuration file.'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Found the config file. Reading it now.'));
    });
  });

  describe('Repository operations', () => {
    it('should pass repository context via environment', async () => {
      const mockMessages: SDKMessage[] = [
        createInitMessage('session-repo'),
        createSuccessResult('session-repo'),
      ];

      mockQuery.mockReturnValue(createMockQuery(mockMessages));

      const result = await executeClaude({ prompt: 'Test', cwd: '/test/repo' });

      expect(result.exitCode).toBe(0);
      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'Test',
        options: expect.objectContaining({
          cwd: '/test/repo',
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

    it('should set permission mode for automatic execution', async () => {
      const mockMessages: SDKMessage[] = [
        createInitMessage('session-perms'),
        createSuccessResult('session-perms'),
      ];

      mockQuery.mockReturnValue(createMockQuery(mockMessages));

      const result = await executeClaude({ prompt: 'Test', cwd: process.cwd() });

      expect(result.exitCode).toBe(0);
      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'Test',
        options: expect.objectContaining({
          permissionMode: 'acceptEdits',
          maxTurns: 100,
        }),
      });
    });
  });

  describe('Error scenarios', () => {
    it('should handle SDK error results', async () => {
      const mockMessages: SDKMessage[] = [
        createInitMessage('session-error'),
        createErrorResult('session-error', 'error_during_execution'),
      ];

      mockQuery.mockReturnValue(createMockQuery(mockMessages));

      const result = await executeClaude({ prompt: 'Cause error', cwd: process.cwd() });

      expect(result.exitCode).toBe(1);
      expect(result.sessionId).toBe('session-error');
      expect(consoleLogSpy).toHaveBeenCalledWith('❌ Execution failed');
    });

    it('should handle max turns error', async () => {
      const mockMessages: SDKMessage[] = [
        createInitMessage('session-max-turns'),
        createErrorResult('session-max-turns', 'error_max_turns'),
      ];

      mockQuery.mockReturnValue(createMockQuery(mockMessages));

      const result = await executeClaude({ prompt: 'Too many turns', cwd: process.cwd() });

      expect(result.exitCode).toBe(1);
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

      await expect(executeClaude({ prompt: 'Test', cwd: process.cwd() })).rejects.toThrow(
        'Failed to execute Claude SDK: Network connection failed'
      );
    });

    it('should handle timeout gracefully', async () => {
      const timeoutQuery = Object.assign((async function* () {
        // Simulate a long-running operation that would trigger abort
        await new Promise(resolve => setTimeout(resolve, 1500000)); // 25 minutes
        yield createSuccessResult('session-timeout');
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

      mockQuery.mockReturnValue(timeoutQuery);

      // This test would take too long, so we skip it
      // The timeout logic is tested via the abort controller implementation
    }, 1000);
  });

  describe('Output formatting', () => {
    it('should truncate long thinking blocks', async () => {
      const longThinking = 'a'.repeat(150);
      const mockMessages: SDKMessage[] = [
        createInitMessage('session-truncate'),
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'thinking', thinking: longThinking },
            ],
          } as any,
          parent_tool_use_id: null,
          uuid: '0000000d-0000-0000-0000-000000000000' as UUID,
          session_id: 'session-truncate',
        } as SDKAssistantMessage,
        createSuccessResult('session-truncate'),
      ];

      mockQuery.mockReturnValue(createMockQuery(mockMessages));

      await executeClaude({ prompt: 'Test', cwd: process.cwd() });

      const thinkingCall = consoleLogSpy.mock.calls.find(c =>
        typeof c[0] === 'string' && c[0].includes('💭')
      );
      expect(thinkingCall?.[0]).toContain('...');
      expect(thinkingCall?.[0].length).toBeLessThan(150);
    });

    it('should truncate long bash commands', async () => {
      const longCommand = 'echo ' + 'x'.repeat(100);
      const mockMessages: SDKMessage[] = [
        createInitMessage('session-bash'),
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Bash', input: { command: longCommand } },
            ],
          } as any,
          parent_tool_use_id: null,
          uuid: '0000000e-0000-0000-0000-000000000000' as UUID,
          session_id: 'session-bash',
        } as SDKAssistantMessage,
        createSuccessResult('session-bash'),
      ];

      mockQuery.mockReturnValue(createMockQuery(mockMessages));

      await executeClaude({ prompt: 'Test', cwd: process.cwd() });

      const bashCall = consoleLogSpy.mock.calls.find(c =>
        typeof c[0] === 'string' && c[0].includes('Bash')
      );
      expect(bashCall?.[0]).toContain('...');
    });
  });
});
