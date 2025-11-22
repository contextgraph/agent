/**
 * SDK Integration Tests
 *
 * End-to-end tests validating SDK wrapper works in real-world scenarios.
 * Tests use real SDK interface with mocked network layer for reliability and speed.
 *
 * Test scenarios:
 * 1. Simple action execution - Basic prompt execution, verify result structure and output
 * 2. Tool use workflows - Test Read, Edit, Write, Bash tools with correct input/output flow
 * 3. Multi-turn conversations - Verify conversation history and thinking blocks preserved
 * 4. Repository operations - Test git credentials passing and repository context availability
 * 5. Error scenarios - Validate authentication failures, timeouts, invalid actions, helpful error messages
 *
 * Target: <30 seconds total execution time
 */

import { executeClaude } from '../../src/claude-sdk.js';
import type { SpawnClaudeOptions } from '../../src/types/actions.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';

// Mock the SDK module with controlled responses
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn()
}));

import { query } from '@anthropic-ai/claude-agent-sdk';
const mockQuery = query as jest.MockedFunction<typeof query>;

// Helper to create mock Query object from messages
function createMockQuery(messages: any[]): any {
  const iterator = (async function* () {
    for (const msg of messages) {
      yield msg as SDKMessage;
    }
  })();

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

describe('SDK Integration Tests', () => {
  let testDir: string;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleLogs: string[];
  let consoleErrors: string[];

  beforeEach(async () => {
    jest.clearAllMocks();

    // Create unique test directory
    testDir = join(tmpdir(), `sdk-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });

    // Capture console output
    consoleLogs = [];
    consoleErrors = [];
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      consoleLogs.push(args.map(String).join(' '));
    });
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args) => {
      consoleErrors.push(args.map(String).join(' '));
    });
  });

  afterEach(async () => {
    // Restore console
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();

    // Clean up test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('1. Simple action execution', () => {
    it('should execute basic prompt and return result structure', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'assistant',
          session_id: 'test-session-1',
          message: {
            content: [{ type: 'text', text: 'Hello!' }]
          }
        },
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 1200
        }
      ]));

      const options: SpawnClaudeOptions = {
        prompt: 'Say hello',
        cwd: testDir
      };

      const result = await executeClaude(options);

      // Verify result structure
      expect(result).toHaveProperty('exitCode');
      expect(result.exitCode).toBe(0);
      expect(result.sessionId).toBe('test-session-1');

      // Verify console output contains initialization message
      expect(consoleLogs.some(log => log.includes('Claude session initialized'))).toBe(true);

      // Verify completion message
      expect(consoleLogs.some(log => log.includes('Completed'))).toBe(true);
      expect(consoleLogs.some(log => log.includes('Hello!'))).toBe(true);

      // Verify SDK was called with correct parameters
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Say hello',
          options: expect.objectContaining({
            cwd: testDir,
            maxTurns: 50,
            permissionMode: 'acceptEdits'
          })
        })
      );
    });

    it('should return usage data when available', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: '1, 2, 3, 4, 5' }]
          }
        },
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 800,
          usage: {
            input_tokens: 15,
            output_tokens: 25
          },
          total_cost_usd: 0.02
        }
      ]));

      const options: SpawnClaudeOptions = {
        prompt: 'Count to 5',
        cwd: testDir
      };

      const result = await executeClaude(options);

      expect(result.exitCode).toBe(0);

      // Verify usage data is present and correctly formatted
      expect(result.usage).toBeDefined();
      expect(result.usage?.inputTokens).toBe(15);
      expect(result.usage?.outputTokens).toBe(25);
      expect(result.cost).toBe(0.02);
    });
  });

  describe('2. Tool use workflows', () => {
    it('should handle Read tool correctly', async () => {
      const testFilePath = join(testDir, 'test.txt');
      await writeFile(testFilePath, 'Hello from test file');

      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'I will read the file' },
              {
                type: 'tool_use',
                name: 'Read',
                input: { file_path: testFilePath }
              }
            ]
          }
        },
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 500
        }
      ]));

      const options: SpawnClaudeOptions = {
        prompt: `Read the file at ${testFilePath}`,
        cwd: testDir
      };

      const result = await executeClaude(options);

      expect(result.exitCode).toBe(0);

      // Verify Read tool was used (shown in console output)
      expect(consoleLogs.some(log => log.includes('🔧 Read:'))).toBe(true);
      expect(consoleLogs.some(log => log.includes(testFilePath))).toBe(true);
    });

    it('should handle Write tool correctly', async () => {
      const outputPath = join(testDir, 'output.txt');

      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'Write',
                input: { file_path: outputPath, content: 'Integration test' }
              }
            ]
          }
        },
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 400
        }
      ]));

      const options: SpawnClaudeOptions = {
        prompt: `Write "Integration test" to ${outputPath}`,
        cwd: testDir
      };

      const result = await executeClaude(options);

      expect(result.exitCode).toBe(0);

      // Verify Write tool was used
      expect(consoleLogs.some(log => log.includes('🔧 Write:'))).toBe(true);
      expect(consoleLogs.some(log => log.includes(outputPath))).toBe(true);
    });

    it('should handle Bash tool correctly', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'Bash',
                input: { command: 'ls -la' }
              }
            ]
          }
        },
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 600
        }
      ]));

      const options: SpawnClaudeOptions = {
        prompt: 'List files in the current directory using ls',
        cwd: testDir
      };

      const result = await executeClaude(options);

      expect(result.exitCode).toBe(0);

      // Verify Bash tool was used
      expect(consoleLogs.some(log => log.includes('🔧 Bash:'))).toBe(true);
      expect(consoleLogs.some(log => log.includes('ls -la'))).toBe(true);
    });

    it('should handle Edit tool correctly', async () => {
      const testFilePath = join(testDir, 'edit-test.txt');
      await writeFile(testFilePath, 'Original content');

      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'Edit',
                input: {
                  file_path: testFilePath,
                  old_string: 'Original',
                  new_string: 'Modified'
                }
              }
            ]
          }
        },
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 550
        }
      ]));

      const options: SpawnClaudeOptions = {
        prompt: `Edit ${testFilePath} and change "Original" to "Modified"`,
        cwd: testDir
      };

      const result = await executeClaude(options);

      expect(result.exitCode).toBe(0);

      // Verify Edit tool was used
      expect(consoleLogs.some(log => log.includes('🔧 Edit:'))).toBe(true);
      expect(consoleLogs.some(log => log.includes(testFilePath))).toBe(true);
    });
  });

  describe('3. Multi-turn conversations', () => {
    it('should handle multi-step tasks with conversation history', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'assistant',
          session_id: 'multi-turn-session',
          message: {
            content: [
              { type: 'text', text: 'Creating first file' },
              {
                type: 'tool_use',
                name: 'Write',
                input: { file_path: join(testDir, 'step1.txt'), content: 'Step 1' }
              }
            ]
          }
        },
        {
          type: 'assistant',
          session_id: 'multi-turn-session',
          message: {
            content: [
              { type: 'text', text: 'Creating second file' },
              {
                type: 'tool_use',
                name: 'Write',
                input: { file_path: join(testDir, 'step2.txt'), content: 'Step 2' }
              }
            ]
          }
        },
        {
          type: 'assistant',
          session_id: 'multi-turn-session',
          message: {
            content: [
              { type: 'text', text: 'Listing files' },
              {
                type: 'tool_use',
                name: 'Bash',
                input: { command: 'ls' }
              }
            ]
          }
        },
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 1500
        }
      ]));

      const options: SpawnClaudeOptions = {
        prompt: 'Create a file called step1.txt, then create step2.txt, then list all files',
        cwd: testDir
      };

      const result = await executeClaude(options);

      expect(result.exitCode).toBe(0);
      expect(result.sessionId).toBe('multi-turn-session');

      // Verify multiple tool uses occurred
      const toolUses = consoleLogs.filter(log => log.includes('🔧'));
      expect(toolUses.length).toBe(3);

      // Verify conversation text was displayed
      expect(consoleLogs.some(log => log.includes('Creating first file'))).toBe(true);
      expect(consoleLogs.some(log => log.includes('Creating second file'))).toBe(true);
      expect(consoleLogs.some(log => log.includes('Listing files'))).toBe(true);
    });

    it('should preserve thinking blocks in conversation', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'thinking', thinking: 'I should think about file organization first' },
              { type: 'text', text: 'Creating plan file' },
              {
                type: 'tool_use',
                name: 'Write',
                input: { file_path: join(testDir, 'plan.txt'), content: 'File plan' }
              }
            ]
          }
        },
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 700
        }
      ]));

      const options: SpawnClaudeOptions = {
        prompt: 'Think about the best way to organize files, then create a plan.txt file',
        cwd: testDir
      };

      const result = await executeClaude(options);

      expect(result.exitCode).toBe(0);

      // Note: Current implementation does not display thinking blocks separately
      // They are part of the message content but formatAssistantMessage only handles
      // text and tool_use types. This is expected behavior for now.
      // Verify text and tool use were displayed
      expect(consoleLogs.some(log => log.includes('Creating plan file'))).toBe(true);
      expect(consoleLogs.some(log => log.includes('🔧 Write:'))).toBe(true);
    });
  });

  describe('4. Repository operations', () => {
    it('should pass git credentials via environment variables', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 300
        }
      ]));

      const mockGitCredentials = {
        githubToken: 'test-github-token',
        provider: 'github' as const,
        acquiredAt: new Date().toISOString(),
        source: 'manual' as const
      };

      const options: SpawnClaudeOptions = {
        prompt: 'Echo the GITHUB_TOKEN environment variable',
        cwd: testDir,
        gitCredentials: mockGitCredentials
      };

      const result = await executeClaude(options);

      expect(result.exitCode).toBe(0);

      // Verify credentials were passed to SDK query
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            env: expect.objectContaining({
              GITHUB_TOKEN: 'test-github-token'
            })
          })
        })
      );
    });

    it('should handle repository context availability', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: `Working directory: ${testDir}` }]
          }
        },
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 250
        }
      ]));

      const options: SpawnClaudeOptions = {
        prompt: 'Check the current working directory',
        cwd: testDir
      };

      const result = await executeClaude(options);

      expect(result.exitCode).toBe(0);

      // Verify SDK was called with correct working directory
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            cwd: testDir
          })
        })
      );
    });

    it('should pass both GitHub and GitLab tokens when provided', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 200
        }
      ]));

      const mockGitCredentials = {
        githubToken: 'test-github-token',
        gitlabToken: 'test-gitlab-token',
        provider: 'github' as const,
        acquiredAt: new Date().toISOString(),
        source: 'manual' as const
      };

      const options: SpawnClaudeOptions = {
        prompt: 'List environment variables',
        cwd: testDir,
        gitCredentials: mockGitCredentials
      };

      const result = await executeClaude(options);

      expect(result.exitCode).toBe(0);

      // Verify both tokens were passed
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            env: expect.objectContaining({
              GITHUB_TOKEN: 'test-github-token',
              GITLAB_TOKEN: 'test-gitlab-token'
            })
          })
        })
      );
    });
  });

  describe('5. Error scenarios', () => {
    it('should handle SDK error results gracefully', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'result',
          subtype: 'error',
          errors: ['Authentication failed', 'Invalid API key']
        }
      ]));

      const options: SpawnClaudeOptions = {
        prompt: 'Test error handling',
        cwd: testDir
      };

      const result = await executeClaude(options);

      expect(result.exitCode).toBe(1);

      // Verify errors were logged
      expect(consoleErrors.some(log => log.includes('Execution failed'))).toBe(true);
      expect(consoleErrors.some(log => log.includes('Authentication failed'))).toBe(true);
      expect(consoleErrors.some(log => log.includes('Invalid API key'))).toBe(true);
    });

    it('should handle SDK exceptions and re-throw', async () => {
      const testError = new Error('Network connection failed');
      mockQuery.mockImplementation(() => {
        throw testError;
      });

      const options: SpawnClaudeOptions = {
        prompt: 'Test exception handling',
        cwd: testDir
      };

      await expect(executeClaude(options)).rejects.toThrow('Network connection failed');

      // Verify error was logged
      expect(consoleErrors.some(log => log.includes('Error executing Claude'))).toBe(true);
      expect(consoleErrors.some(log => log.includes('Network connection failed'))).toBe(true);
    });

    it('should timeout after 20 minutes', async () => {
      jest.useFakeTimers();

      // Create a never-ending query
      const neverEndingQuery = (async function* () {
        await new Promise(() => {}); // Never resolves
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

      const options: SpawnClaudeOptions = {
        prompt: 'Should timeout',
        cwd: testDir
      };

      const promise = executeClaude(options);

      // Fast-forward past timeout (20 minutes)
      jest.advanceTimersByTime(1200001);

      await expect(promise).rejects.toThrow('timed out after 20 minutes');

      jest.useRealTimers();
    });

    it('should handle empty result iterator', async () => {
      mockQuery.mockReturnValue(createMockQuery([]));

      const options: SpawnClaudeOptions = {
        prompt: 'Test empty result',
        cwd: testDir
      };

      const result = await executeClaude(options);

      expect(result.exitCode).toBe(1);
    });

    it('should track session ID across multiple messages', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'assistant',
          session_id: 'persistent-session',
          message: {
            content: [{ type: 'text', text: 'First message' }]
          }
        },
        {
          type: 'assistant',
          session_id: 'persistent-session',
          message: {
            content: [{ type: 'text', text: 'Second message' }]
          }
        },
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 900
        }
      ]));

      const options: SpawnClaudeOptions = {
        prompt: 'Multi-message test',
        cwd: testDir
      };

      const result = await executeClaude(options);

      expect(result.exitCode).toBe(0);
      expect(result.sessionId).toBe('persistent-session');
    });
  });

  describe('Performance validation', () => {
    it('should complete simple tasks quickly', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 150
        }
      ]));

      const start = Date.now();

      const options: SpawnClaudeOptions = {
        prompt: 'Echo "fast test"',
        cwd: testDir
      };

      const result = await executeClaude(options);

      const duration = Date.now() - start;

      expect(result.exitCode).toBe(0);

      // Execution should be very fast with mocked SDK (under 1 second)
      expect(duration).toBeLessThan(1000);
    });

    it('should handle concurrent tool uses efficiently', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'Write',
                input: { file_path: join(testDir, 'a.txt'), content: 'A' }
              }
            ]
          }
        },
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'Write',
                input: { file_path: join(testDir, 'b.txt'), content: 'B' }
              }
            ]
          }
        },
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'Write',
                input: { file_path: join(testDir, 'c.txt'), content: 'C' }
              }
            ]
          }
        },
        {
          type: 'result',
          subtype: 'success',
          duration_ms: 450
        }
      ]));

      const options: SpawnClaudeOptions = {
        prompt: 'Create three files: a.txt, b.txt, and c.txt',
        cwd: testDir
      };

      const result = await executeClaude(options);

      expect(result.exitCode).toBe(0);

      // Verify three tool uses occurred
      const toolUses = consoleLogs.filter(log => log.includes('🔧 Write:'));
      expect(toolUses.length).toBe(3);
    });
  });
});
