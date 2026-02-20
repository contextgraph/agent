import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import type { LogEvent } from '../../src/log-transport.js';

/**
 * Integration test for Codex cost and usage data extraction
 *
 * This test validates the complete flow of cost/usage data from Codex CLI events
 * through the logging pipeline to ensure proper extraction and reporting.
 *
 * Test Flow:
 * 1. Mock Codex CLI to emit cost events via stdout (JSON format)
 * 2. Validate codex-runner extracts cost from events
 * 3. Verify LogEvent callbacks receive cost data
 * 4. Confirm final AgentRunResult contains cost/usage
 *
 * Known Gap:
 * - The /api/runs/finish endpoint doesn't currently process cost/usage metadata
 *   for Langfuse reporting. This is documented for follow-up work.
 */

// Mock child_process before importing
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

// Import after mocking
import { spawn } from 'child_process';
import { codexRunner } from '../../src/runners/codex-runner.js';

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

// Helper to create a mock ChildProcess
function createMockChildProcess(
  stdoutLines: string[],
  exitCode: number = 0
): ChildProcess {
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const mockProc = new EventEmitter() as ChildProcess;

  mockProc.stdout = stdout;
  mockProc.stderr = stderr;
  mockProc.kill = jest.fn(() => true) as any;

  // Emit lines after a small delay to simulate real execution
  setTimeout(() => {
    for (const line of stdoutLines) {
      stdout.push(line + '\n');
    }
    stdout.push(null); // EOF

    stderr.push(null); // EOF

    // Emit close event after streams end
    setTimeout(() => {
      mockProc.emit('close', exitCode);
    }, 10);
  }, 10);

  return mockProc;
}

describe('Codex Cost Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Cost extraction from Codex events', () => {
    it('should extract cost from total_cost_usd field', async () => {
      const events = [
        JSON.stringify({
          type: 'thread.started',
          thread_id: 'test-thread-123',
          timestamp: new Date().toISOString(),
        }),
        JSON.stringify({
          type: 'turn.completed',
          thread_id: 'test-thread-123',
          total_cost_usd: 0.0456,
          usage: {
            input_tokens: 1500,
            output_tokens: 800,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 500,
          },
          timestamp: new Date().toISOString(),
        }),
      ];

      const mockProc = createMockChildProcess(events, 0);
      mockSpawn.mockReturnValue(mockProc);

      const result = await codexRunner.execute({
        prompt: 'Test prompt',
        cwd: '/test',
        authToken: 'test-token',
      });

      expect(result.exitCode).toBe(0);
      expect(result.sessionId).toBe('test-thread-123');
      expect(result.cost).toBe(0.0456);
      expect(result.usage).toEqual({
        input_tokens: 1500,
        output_tokens: 800,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 500,
      });
    });

    it('should extract cost from cost_usd field', async () => {
      const events = [
        JSON.stringify({
          type: 'thread.started',
          thread_id: 'test-thread-456',
        }),
        JSON.stringify({
          type: 'item.completed',
          cost_usd: 0.0234,
        }),
      ];

      const mockProc = createMockChildProcess(events, 0);
      mockSpawn.mockReturnValue(mockProc);

      const result = await codexRunner.execute({
        prompt: 'Test prompt',
        cwd: '/test',
      });

      expect(result.cost).toBe(0.0234);
    });

    it('should extract cost from total_cost field', async () => {
      const events = [
        JSON.stringify({
          type: 'thread.started',
          thread_id: 'test-thread-789',
        }),
        JSON.stringify({
          type: 'turn.completed',
          total_cost: 0.0678,
        }),
      ];

      const mockProc = createMockChildProcess(events, 0);
      mockSpawn.mockReturnValue(mockProc);

      const result = await codexRunner.execute({
        prompt: 'Test prompt',
        cwd: '/test',
      });

      expect(result.cost).toBe(0.0678);
    });

    it('should use the most recent cost value when multiple events have cost', async () => {
      const events = [
        JSON.stringify({
          type: 'thread.started',
          thread_id: 'test-thread-multi',
        }),
        JSON.stringify({
          type: 'item.completed',
          cost_usd: 0.01,
        }),
        JSON.stringify({
          type: 'item.completed',
          cost_usd: 0.02,
        }),
        JSON.stringify({
          type: 'turn.completed',
          total_cost_usd: 0.03,
        }),
      ];

      const mockProc = createMockChildProcess(events, 0);
      mockSpawn.mockReturnValue(mockProc);

      const result = await codexRunner.execute({
        prompt: 'Test prompt',
        cwd: '/test',
      });

      // Should use the last cost value (from turn.completed)
      expect(result.cost).toBe(0.03);
    });

    it('should handle missing cost data gracefully', async () => {
      const events = [
        JSON.stringify({
          type: 'thread.started',
          thread_id: 'test-thread-no-cost',
        }),
        JSON.stringify({
          type: 'turn.completed',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
        }),
      ];

      const mockProc = createMockChildProcess(events, 0);
      mockSpawn.mockReturnValue(mockProc);

      const result = await codexRunner.execute({
        prompt: 'Test prompt',
        cwd: '/test',
      });

      expect(result.exitCode).toBe(0);
      expect(result.cost).toBeUndefined();
      expect(result.usage).toBeDefined();
    });
  });

  describe('LogEvent callback integration', () => {
    it('should emit log events with cost data in event metadata', async () => {
      const logEvents: LogEvent[] = [];
      const onLogEvent = (event: LogEvent) => {
        logEvents.push(event);
      };

      const events = [
        JSON.stringify({
          type: 'thread.started',
          thread_id: 'test-thread-log',
          message: 'Thread started',
        }),
        JSON.stringify({
          type: 'turn.completed',
          message: 'Turn completed successfully',
          total_cost_usd: 0.0567,
          usage: {
            input_tokens: 2000,
            output_tokens: 1000,
          },
        }),
      ];

      const mockProc = createMockChildProcess(events, 0);
      mockSpawn.mockReturnValue(mockProc);

      const result = await codexRunner.execute({
        prompt: 'Test prompt',
        cwd: '/test',
        onLogEvent,
      });

      // Verify execution completed successfully
      expect(result.exitCode).toBe(0);
      expect(result.cost).toBe(0.0567);

      // Verify log events were emitted
      expect(logEvents.length).toBeGreaterThan(0);

      // Check that events have the cost data in their metadata
      const turnCompletedEvent = logEvents.find(
        (e) => e.data?.type === 'turn.completed'
      );
      expect(turnCompletedEvent).toBeDefined();
      expect(turnCompletedEvent?.data?.total_cost_usd).toBe(0.0567);
      expect(turnCompletedEvent?.data?.usage).toEqual({
        input_tokens: 2000,
        output_tokens: 1000,
      });

      // Verify provider is set
      expect(turnCompletedEvent?.data?.provider).toBe('codex');
    });

    it('should emit log events for all Codex event types', async () => {
      const logEvents: LogEvent[] = [];
      const onLogEvent = (event: LogEvent) => {
        logEvents.push(event);
      };

      const events = [
        JSON.stringify({
          type: 'thread.started',
          thread_id: 'test-thread-events',
        }),
        JSON.stringify({
          type: 'item.started',
          item: {
            type: 'tool_use',
            tool_name: 'Read',
            input: { file_path: '/test/file.ts' },
          },
        }),
        JSON.stringify({
          type: 'item.completed',
          item: {
            type: 'tool_use',
            tool_name: 'Read',
          },
        }),
        JSON.stringify({
          type: 'turn.completed',
          total_cost_usd: 0.01,
        }),
      ];

      const mockProc = createMockChildProcess(events, 0);
      mockSpawn.mockReturnValue(mockProc);

      await codexRunner.execute({
        prompt: 'Test prompt',
        cwd: '/test',
        onLogEvent,
      });

      // Verify we captured events for all types
      const eventTypes = logEvents
        .map((e) => e.data?.type)
        .filter(Boolean);

      expect(eventTypes).toContain('thread.started');
      expect(eventTypes).toContain('item.started');
      expect(eventTypes).toContain('item.completed');
      expect(eventTypes).toContain('turn.completed');
    });
  });

  describe('End-to-end cost flow', () => {
    it('should validate complete cost data flow from extraction to result', async () => {
      const logEvents: LogEvent[] = [];
      const onLogEvent = (event: LogEvent) => {
        logEvents.push(event);
      };

      const events = [
        JSON.stringify({
          type: 'thread.started',
          thread_id: 'test-e2e-flow',
        }),
        JSON.stringify({
          type: 'item.started',
          item: {
            type: 'tool_use',
            tool_name: 'Bash',
            input: { command: 'echo "test"' },
          },
          cost_usd: 0.001,
        }),
        JSON.stringify({
          type: 'item.completed',
          item: {
            type: 'tool_use',
            tool_name: 'Bash',
          },
          cost_usd: 0.002,
        }),
        JSON.stringify({
          type: 'turn.completed',
          message: 'Task completed',
          total_cost_usd: 0.0123,
          usage: {
            input_tokens: 3000,
            output_tokens: 1500,
            cache_creation_input_tokens: 100,
            cache_read_input_tokens: 800,
          },
        }),
      ];

      const mockProc = createMockChildProcess(events, 0);
      mockSpawn.mockReturnValue(mockProc);

      const result = await codexRunner.execute({
        prompt: 'Run a test command',
        cwd: '/test',
        authToken: 'test-token',
        onLogEvent,
      });

      // Step 1: Verify runner extracted cost from events
      expect(result.cost).toBe(0.0123);
      expect(result.usage).toEqual({
        input_tokens: 3000,
        output_tokens: 1500,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 800,
      });

      // Step 2: Verify log events contain cost data for downstream processing
      const costEvents = logEvents.filter((e) => e.data?.cost_usd || e.data?.total_cost_usd);
      expect(costEvents.length).toBeGreaterThan(0);

      // Step 3: Verify final event has complete cost and usage
      const finalEvent = logEvents[logEvents.length - 1];
      expect(finalEvent.data?.total_cost_usd).toBe(0.0123);
      expect(finalEvent.data?.usage).toBeDefined();

      // Step 4: Document the gap
      // NOTE: The /api/runs/finish endpoint currently doesn't process this
      // cost/usage metadata for Langfuse reporting. This test validates that
      // the data is extracted and available, but integration with Langfuse
      // needs to be implemented in the finish endpoint.
    });
  });

  describe('Error scenarios', () => {
    it('should handle malformed JSON events gracefully', async () => {
      const logEvents: LogEvent[] = [];
      const onLogEvent = (event: LogEvent) => {
        logEvents.push(event);
      };

      const events = [
        JSON.stringify({
          type: 'thread.started',
          thread_id: 'test-malformed',
        }),
        'This is not JSON',
        JSON.stringify({
          type: 'turn.completed',
          total_cost_usd: 0.01,
        }),
      ];

      const mockProc = createMockChildProcess(events, 0);
      mockSpawn.mockReturnValue(mockProc);

      const result = await codexRunner.execute({
        prompt: 'Test prompt',
        cwd: '/test',
        onLogEvent,
      });

      expect(result.exitCode).toBe(0);
      expect(result.cost).toBe(0.01);

      // Verify malformed line was logged as stdout
      const stdoutEvent = logEvents.find(
        (e) => e.eventType === 'stdout' && e.content === 'This is not JSON'
      );
      expect(stdoutEvent).toBeDefined();
    });

    it('should handle Codex process failure', async () => {
      const events = [
        JSON.stringify({
          type: 'thread.started',
          thread_id: 'test-failure',
        }),
        JSON.stringify({
          type: 'error',
          message: 'Execution failed',
        }),
      ];

      const mockProc = createMockChildProcess(events, 1);
      mockSpawn.mockReturnValue(mockProc);

      const result = await codexRunner.execute({
        prompt: 'Test prompt',
        cwd: '/test',
      });

      expect(result.exitCode).toBe(1);
      // Cost should still be extracted even on failure
      expect(result.sessionId).toBe('test-failure');
    });
  });

  describe('Multiple turn workflow', () => {
    it('should track cost accumulation across multiple turns', async () => {
      const logEvents: LogEvent[] = [];
      const onLogEvent = (event: LogEvent) => {
        logEvents.push(event);
      };

      const events = [
        JSON.stringify({
          type: 'thread.started',
          thread_id: 'test-multi-turn',
        }),
        JSON.stringify({
          type: 'turn.completed',
          total_cost_usd: 0.01,
          usage: { input_tokens: 1000, output_tokens: 500 },
        }),
        JSON.stringify({
          type: 'turn.started',
        }),
        JSON.stringify({
          type: 'turn.completed',
          total_cost_usd: 0.025,
          usage: { input_tokens: 2000, output_tokens: 1000 },
        }),
      ];

      const mockProc = createMockChildProcess(events, 0);
      mockSpawn.mockReturnValue(mockProc);

      const result = await codexRunner.execute({
        prompt: 'Multi-turn task',
        cwd: '/test',
        onLogEvent,
      });

      // Should have the final cumulative cost
      expect(result.cost).toBe(0.025);

      // Verify both turn completions were logged
      const turnEvents = logEvents.filter(
        (e) => e.data?.type === 'turn.completed'
      );
      expect(turnEvents.length).toBe(2);
      expect(turnEvents[0].data?.total_cost_usd).toBe(0.01);
      expect(turnEvents[1].data?.total_cost_usd).toBe(0.025);
    });
  });
});
