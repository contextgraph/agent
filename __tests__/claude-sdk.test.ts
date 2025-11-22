/**
 * Unit tests for SDK wrapper functions.
 *
 * Tests the SDK wrapper implementation in src/claude-sdk.ts including:
 * - formatToolInput() - Tool input formatting
 * - formatToolUse() - Tool use event formatting
 * - formatAssistantMessage() - Assistant message formatting with thinking blocks
 * - executeClaude() - SDK execution with error handling, timeouts, credentials
 */

import { executeClaude } from '../src/claude-sdk.js';
import type { SpawnClaudeOptions } from '../src/types/actions.js';

// Mock the SDK module
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn()
}));

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
const mockQuery = query as jest.MockedFunction<typeof query>;

// Helper to create mock Query object from messages
function createMockQuery(messages: any[]): any {
  const iterator = (async function* () {
    for (const msg of messages) {
      yield msg as SDKMessage;
    }
  })();

  // Add Query interface methods
  return Object.assign(iterator, {
    interrupt: jest.fn().mockResolvedValue(undefined),
    setPermissionMode: jest.fn().mockResolvedValue(undefined),
    setModel: jest.fn().mockResolvedValue(undefined),
    setMaxThinkingTokens: jest.fn().mockResolvedValue(undefined),
    supportedCommands: jest.fn().mockResolvedValue([]),
    supportedModels: jest.fn().mockResolvedValue([]),
    mcpServerStatus: jest.fn().mockResolvedValue([]),
    accountInfo: jest.fn().mockResolvedValue({})
  });
}

describe('claude-sdk unit tests', () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('formatToolInput tests (via executeClaude)', () => {
    it('should format Read tool input with file path', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 1000
        }
      ]));

      const options: SpawnClaudeOptions = {
        prompt: 'test',
        cwd: '/tmp'
      };

      await executeClaude(options);

      // Verify query was called with PreToolUse hook
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'test',
          options: expect.objectContaining({
            hooks: expect.objectContaining({
              PreToolUse: expect.any(Array)
            })
          })
        })
      );
    });

    it('should format Edit tool input with file path', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 1000
        }
      ]));

      await executeClaude({ prompt: 'test', cwd: '/tmp' });

      const hookConfig = (mockQuery.mock.calls[0][0] as any).options.hooks.PreToolUse[0];
      const hookFn = hookConfig.hooks[0];

      // Test Edit tool formatting
      const result = await hookFn({
        hook_event_name: 'PreToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: '/path/to/file.ts' }
      });

      expect(result).toEqual({});
      expect(consoleLogSpy).toHaveBeenCalledWith('  🔧 Edit: /path/to/file.ts');
    });

    it('should format Write tool input with file path', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 1000
        }
      ]));

      await executeClaude({ prompt: 'test', cwd: '/tmp' });

      const hookConfig = (mockQuery.mock.calls[0][0] as any).options.hooks.PreToolUse[0];
      const hookFn = hookConfig.hooks[0];

      const result = await hookFn({
        hook_event_name: 'PreToolUse',
        tool_name: 'Write',
        tool_input: { file_path: '/path/to/file.ts' }
      });

      expect(result).toEqual({});
      expect(consoleLogSpy).toHaveBeenCalledWith('  🔧 Write: /path/to/file.ts');
    });

    it('should format Bash tool input with truncated command', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 1000
        }
      ]));

      await executeClaude({ prompt: 'test', cwd: '/tmp' });

      const hookConfig = (mockQuery.mock.calls[0][0] as any).options.hooks.PreToolUse[0];
      const hookFn = hookConfig.hooks[0];

      // Test with short command
      await hookFn({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'ls -la' }
      });

      expect(consoleLogSpy).toHaveBeenCalledWith('  🔧 Bash: ls -la');

      // Test with long command (should truncate)
      consoleLogSpy.mockClear();
      const longCommand = 'a'.repeat(100);
      await hookFn({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: longCommand }
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(`  🔧 Bash: ${'a'.repeat(60)}...`);
    });

    it('should format Grep tool input with pattern', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 1000
        }
      ]));

      await executeClaude({ prompt: 'test', cwd: '/tmp' });

      const hookConfig = (mockQuery.mock.calls[0][0] as any).options.hooks.PreToolUse[0];
      const hookFn = hookConfig.hooks[0];

      await hookFn({
        hook_event_name: 'PreToolUse',
        tool_name: 'Grep',
        tool_input: { pattern: 'TODO' }
      });

      expect(consoleLogSpy).toHaveBeenCalledWith('  🔧 Grep: "TODO"');
    });

    it('should format Glob tool input with pattern', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 1000
        }
      ]));

      await executeClaude({ prompt: 'test', cwd: '/tmp' });

      const hookConfig = (mockQuery.mock.calls[0][0] as any).options.hooks.PreToolUse[0];
      const hookFn = hookConfig.hooks[0];

      await hookFn({
        hook_event_name: 'PreToolUse',
        tool_name: 'Glob',
        tool_input: { pattern: '**/*.ts' }
      });

      expect(consoleLogSpy).toHaveBeenCalledWith('  🔧 Glob: **/*.ts');
    });

    it('should handle tools with no input', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 1000
        }
      ]));

      await executeClaude({ prompt: 'test', cwd: '/tmp' });

      const hookConfig = (mockQuery.mock.calls[0][0] as any).options.hooks.PreToolUse[0];
      const hookFn = hookConfig.hooks[0];

      await hookFn({
        hook_event_name: 'PreToolUse',
        tool_name: 'Read',
        tool_input: null
      });

      expect(consoleLogSpy).toHaveBeenCalledWith('  🔧 Read');
    });

    it('should handle unknown tools', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 1000
        }
      ]));

      await executeClaude({ prompt: 'test', cwd: '/tmp' });

      const hookConfig = (mockQuery.mock.calls[0][0] as any).options.hooks.PreToolUse[0];
      const hookFn = hookConfig.hooks[0];

      await hookFn({
        hook_event_name: 'PreToolUse',
        tool_name: 'UnknownTool',
        tool_input: { some: 'data' }
      });

      expect(consoleLogSpy).toHaveBeenCalledWith('  🔧 UnknownTool');
    });
  });

  describe('formatAssistantMessage tests', () => {
    it('should format text content', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Hello, world!' }
            ]
          }
        },
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 1000
        }
      ]));

      await executeClaude({ prompt: 'test', cwd: '/tmp' });

      expect(consoleLogSpy).toHaveBeenCalledWith('  Hello, world!');
    });

    it('should format tool_use content', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'Read',
                input: { file_path: '/test.ts' }
              }
            ]
          }
        },
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 1000
        }
      ]));

      await executeClaude({ prompt: 'test', cwd: '/tmp' });

      expect(consoleLogSpy).toHaveBeenCalledWith('  🔧 Read: /test.ts');
    });

    it('should handle mixed content (text and tool_use)', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Let me read the file' },
              {
                type: 'tool_use',
                name: 'Read',
                input: { file_path: '/test.ts' }
              }
            ]
          }
        },
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 1000
        }
      ]));

      await executeClaude({ prompt: 'test', cwd: '/tmp' });

      expect(consoleLogSpy).toHaveBeenCalledWith('  Let me read the file');
      expect(consoleLogSpy).toHaveBeenCalledWith('  🔧 Read: /test.ts');
    });

    it('should handle empty or missing content', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'assistant',
          message: {
            content: []
          }
        },
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 1000
        }
      ]));

      await executeClaude({ prompt: 'test', cwd: '/tmp' });

      // Should not crash, just not log anything
      expect(consoleLogSpy).toHaveBeenCalledWith('🚀 Claude session initialized');
    });

    it('should handle non-array content', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'assistant',
          message: {
            content: null as any
          }
        },
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 1000
        }
      ]));

      await executeClaude({ prompt: 'test', cwd: '/tmp' });

      // Should not crash
      expect(consoleLogSpy).toHaveBeenCalledWith('🚀 Claude session initialized');
    });
  });

  describe('executeClaude success scenarios', () => {
    it('should execute successfully and return exit code 0', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 1500,
          usage: {
            input_tokens: 100,
            output_tokens: 200
          },
          total_cost_usd: 0.05
        }
      ]));

      const result = await executeClaude({
        prompt: 'Test prompt',
        cwd: '/tmp'
      });

      expect(result).toEqual({
        exitCode: 0,
        sessionId: undefined,
        usage: {
          inputTokens: 100,
          outputTokens: 200
        },
        cost: 0.05
      });

      expect(consoleLogSpy).toHaveBeenCalledWith('🚀 Claude session initialized');
      expect(consoleLogSpy).toHaveBeenCalledWith('✅ Completed in 1.5s');
    });

    it('should track session ID from messages', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'assistant',
          session_id: 'session-123',
          message: {
            content: [{ type: 'text', text: 'Hello' }]
          }
        },
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 1000
        }
      ]));

      const result = await executeClaude({
        prompt: 'Test',
        cwd: '/tmp'
      });

      expect(result.sessionId).toBe('session-123');
    });

    it('should pass Git credentials via environment variables', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 1000
        }
      ]));

      await executeClaude({
        prompt: 'Test',
        cwd: '/tmp',
        gitCredentials: {
          githubToken: 'gh-token-123',
          gitlabToken: 'gl-token-456',
          provider: 'github',
          acquiredAt: new Date().toISOString(),
          source: 'manual'
        }
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Test',
          options: expect.objectContaining({
            env: {
              GITHUB_TOKEN: 'gh-token-123',
              GITLAB_TOKEN: 'gl-token-456'
            }
          })
        })
      );
    });

    it('should pass only GitHub token when provided', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 1000
        }
      ]));

      await executeClaude({
        prompt: 'Test',
        cwd: '/tmp',
        gitCredentials: {
          githubToken: 'gh-token-123',
          provider: 'github',
          acquiredAt: new Date().toISOString(),
          source: 'manual'
        }
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            env: {
              GITHUB_TOKEN: 'gh-token-123'
            }
          })
        })
      );
    });

    it('should configure SDK with correct options', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 1000
        }
      ]));

      await executeClaude({
        prompt: 'Test prompt',
        cwd: '/test/dir'
      });

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'Test prompt',
        options: expect.objectContaining({
          cwd: '/test/dir',
          maxTurns: 50,
          permissionMode: 'acceptEdits',
          hooks: expect.any(Object)
        })
      });
    });

    it('should handle success without usage data', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 1000
        }
      ]));

      const result = await executeClaude({
        prompt: 'Test',
        cwd: '/tmp'
      });

      expect(result).toEqual({
        exitCode: 0,
        sessionId: undefined,
        usage: undefined,
        cost: undefined
      });
    });

    it('should handle success without duration', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'result',
          subtype: 'success'
        }
      ]));

      await executeClaude({
        prompt: 'Test',
        cwd: '/tmp'
      });

      expect(consoleLogSpy).toHaveBeenCalledWith('✅ Completed in unknown');
    });
  });

  describe('executeClaude error scenarios', () => {
    it('should handle SDK errors with exit code 1', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'result',
          subtype: 'error',
          errors: ['Something went wrong', 'Another error'],
          usage: {
            input_tokens: 50,
            output_tokens: 10
          },
          total_cost_usd: 0.01
        }
      ]));

      const result = await executeClaude({
        prompt: 'Test',
        cwd: '/tmp'
      });

      expect(result).toEqual({
        exitCode: 1,
        sessionId: undefined,
        usage: {
          inputTokens: 50,
          outputTokens: 10
        },
        cost: 0.01
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith('❌ Execution failed');
      expect(consoleErrorSpy).toHaveBeenCalledWith('  Error: Something went wrong');
      expect(consoleErrorSpy).toHaveBeenCalledWith('  Error: Another error');
    });

    it('should handle error result without error messages', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'result',
          subtype: 'error'
        }
      ]));

      const result = await executeClaude({
        prompt: 'Test',
        cwd: '/tmp'
      });

      expect(result.exitCode).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith('❌ Execution failed');
    });

    it('should handle SDK exception and re-throw', async () => {
      const testError = new Error('Network failure');
      mockQuery.mockImplementation(() => {
        throw testError;
      });

      await expect(
        executeClaude({
          prompt: 'Test',
          cwd: '/tmp'
        })
      ).rejects.toThrow('Network failure');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error executing Claude: Error: Network failure')
      );
    });

    it('should handle iterator completion without result', async () => {
      mockQuery.mockReturnValue(createMockQuery([]));

      const result = await executeClaude({
        prompt: 'Test',
        cwd: '/tmp'
      });

      expect(result.exitCode).toBe(1);
    });

    it('should handle non-result messages only', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Working...' }]
          }
        }
      ]));

      const result = await executeClaude({
        prompt: 'Test',
        cwd: '/tmp'
      });

      expect(result.exitCode).toBe(1);
    });
  });

  describe('executeClaude timeout scenarios', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should timeout after 20 minutes', async () => {
      // Create a promise that never resolves
      const neverEndingQuery = (async function* () {
        // Wait forever
        await new Promise(() => {});
      })();

      mockQuery.mockReturnValue(Object.assign(neverEndingQuery, {
        interrupt: jest.fn().mockResolvedValue(undefined),
        setPermissionMode: jest.fn().mockResolvedValue(undefined),
        setModel: jest.fn().mockResolvedValue(undefined),
        setMaxThinkingTokens: jest.fn().mockResolvedValue(undefined),
        supportedCommands: jest.fn().mockResolvedValue([]),
        supportedModels: jest.fn().mockResolvedValue([]),
        mcpServerStatus: jest.fn().mockResolvedValue([]),
        accountInfo: jest.fn().mockResolvedValue({})
      }));

      const promise = executeClaude({
        prompt: 'Test',
        cwd: '/tmp'
      });

      // Fast-forward time by 20 minutes
      jest.advanceTimersByTime(1200000);

      await expect(promise).rejects.toThrow('Claude SDK execution timed out after 20 minutes');
    });

    it('should clear timeout on successful completion', async () => {
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 1000
        }
      ]));

      const promise = executeClaude({
        prompt: 'Test',
        cwd: '/tmp'
      });

      // Run all pending promises
      await jest.runOnlyPendingTimersAsync();
      await promise;

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('should clear timeout on error', async () => {
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      mockQuery.mockImplementation(() => {
        throw new Error('Test error');
      });

      try {
        await executeClaude({
          prompt: 'Test',
          cwd: '/tmp'
        });
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toBe('Test error');
        expect(clearTimeoutSpy).toHaveBeenCalled();
      } finally {
        clearTimeoutSpy.mockRestore();
      }
    });

    it('should not return result after timeout', async () => {
      let resolveQuery: () => void;
      const queryPromise = new Promise<void>((resolve) => {
        resolveQuery = resolve;
      });

      const delayedQuery = (async function* () {
        await queryPromise;
        yield {
          type: 'result',
          subtype: 'success',
          duration_ms: 1000
        } as any;
      })();

      mockQuery.mockReturnValue(Object.assign(delayedQuery, {
        interrupt: jest.fn().mockResolvedValue(undefined),
        setPermissionMode: jest.fn().mockResolvedValue(undefined),
        setModel: jest.fn().mockResolvedValue(undefined),
        setMaxThinkingTokens: jest.fn().mockResolvedValue(undefined),
        supportedCommands: jest.fn().mockResolvedValue([]),
        supportedModels: jest.fn().mockResolvedValue([]),
        mcpServerStatus: jest.fn().mockResolvedValue([]),
        accountInfo: jest.fn().mockResolvedValue({})
      }));

      const promise = executeClaude({
        prompt: 'Test',
        cwd: '/tmp'
      });

      // Trigger timeout
      jest.advanceTimersByTime(1200000);

      await expect(promise).rejects.toThrow('Claude SDK execution timed out after 20 minutes');

      // Now resolve the query - should not affect the result
      resolveQuery!();
      await jest.runAllTimersAsync();
    });
  });

  describe('executeClaude hook integration', () => {
    it('should invoke PreToolUse hook for each tool use', async () => {
      mockQuery.mockImplementation((config: any) => {
        // Simulate hook being called
        const hook = config.options.hooks.PreToolUse[0].hooks[0];

        hook({
          hook_event_name: 'PreToolUse',
          tool_name: 'Read',
          tool_input: { file_path: '/test.ts' }
        });

        hook({
          hook_event_name: 'PreToolUse',
          tool_name: 'Write',
          tool_input: { file_path: '/output.ts' }
        });

        return createMockQuery([
          {
            type: 'result',
            subtype: 'success',
            duration_ms: 1000
          }
        ]);
      });

      await executeClaude({
        prompt: 'Test',
        cwd: '/tmp'
      });

      expect(consoleLogSpy).toHaveBeenCalledWith('  🔧 Read: /test.ts');
      expect(consoleLogSpy).toHaveBeenCalledWith('  🔧 Write: /output.ts');
    });

    it('should handle hook returning empty object', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 1000
        }
      ]));

      await executeClaude({
        prompt: 'Test',
        cwd: '/tmp'
      });

      const hookConfig = (mockQuery.mock.calls[0][0] as any).options.hooks.PreToolUse[0];
      const hookFn = hookConfig.hooks[0];

      const result = await hookFn({
        hook_event_name: 'PreToolUse',
        tool_name: 'Read',
        tool_input: { file_path: '/test.ts' }
      });

      expect(result).toEqual({});
    });

    it('should not log for non-PreToolUse events', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 1000
        }
      ]));

      await executeClaude({
        prompt: 'Test',
        cwd: '/tmp'
      });

      const hookConfig = (mockQuery.mock.calls[0][0] as any).options.hooks.PreToolUse[0];
      const hookFn = hookConfig.hooks[0];

      consoleLogSpy.mockClear();

      await hookFn({
        hook_event_name: 'SomeOtherEvent',
        tool_name: 'Read',
        tool_input: { file_path: '/test.ts' }
      });

      // Should not log anything since it's not PreToolUse
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('executeClaude complex scenarios', () => {
    it('should handle multiple messages with session tracking', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'assistant',
          session_id: 'session-abc',
          message: {
            content: [{ type: 'text', text: 'Starting task' }]
          }
        },
        {
          type: 'assistant',
          session_id: 'session-abc',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'Read',
                input: { file_path: '/test.ts' }
              }
            ]
          }
        },
        {
          type: 'assistant',
          session_id: 'session-abc',
          message: {
            content: [{ type: 'text', text: 'Task complete' }]
          }
        },
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 2000,
          usage: {
            input_tokens: 150,
            output_tokens: 300
          },
          total_cost_usd: 0.08
        }
      ]));

      const result = await executeClaude({
        prompt: 'Complex task',
        cwd: '/tmp'
      });

      expect(result).toEqual({
        exitCode: 0,
        sessionId: 'session-abc',
        usage: {
          inputTokens: 150,
          outputTokens: 300
        },
        cost: 0.08
      });

      expect(consoleLogSpy).toHaveBeenCalledWith('  Starting task');
      expect(consoleLogSpy).toHaveBeenCalledWith('  🔧 Read: /test.ts');
      expect(consoleLogSpy).toHaveBeenCalledWith('  Task complete');
      expect(consoleLogSpy).toHaveBeenCalledWith('✅ Completed in 2.0s');
    });

    it('should handle empty environment when no credentials provided', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 1000
        }
      ]));

      await executeClaude({
        prompt: 'Test',
        cwd: '/tmp'
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            env: {}
          })
        })
      );
    });

    it('should handle race condition where result arrives just before timeout', async () => {
      jest.useFakeTimers();

      const almostTimeoutQuery = (async function* () {
        // Wait almost 20 minutes
        await new Promise(resolve => setTimeout(resolve, 1199999));
        yield {
          type: 'result',
          subtype: 'success',
          duration_ms: 1199999
        } as any;
      })();

      mockQuery.mockReturnValue(Object.assign(almostTimeoutQuery, {
        interrupt: jest.fn().mockResolvedValue(undefined),
        setPermissionMode: jest.fn().mockResolvedValue(undefined),
        setModel: jest.fn().mockResolvedValue(undefined),
        setMaxThinkingTokens: jest.fn().mockResolvedValue(undefined),
        supportedCommands: jest.fn().mockResolvedValue([]),
        supportedModels: jest.fn().mockResolvedValue([]),
        mcpServerStatus: jest.fn().mockResolvedValue([]),
        accountInfo: jest.fn().mockResolvedValue({})
      }));

      const promise = executeClaude({
        prompt: 'Test',
        cwd: '/tmp'
      });

      // Advance to just before timeout
      jest.advanceTimersByTime(1199999);
      await jest.runOnlyPendingTimersAsync();

      const result = await promise;
      expect(result.exitCode).toBe(0);

      jest.useRealTimers();
    });
  });
});
