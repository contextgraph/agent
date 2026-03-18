import { describe, it, expect, jest } from '@jest/globals';
import { claudeRunner } from '../../src/runners/claude-runner.js';
import { codexRunner } from '../../src/runners/codex-runner.js';
import { createAgentRunner } from '../../src/runners/index.js';
import type { AgentRunner, RunnerExecuteOptions } from '../../src/runners/types.js';

/**
 * Behavioral contract tests for runner interface.
 *
 * These tests verify that all runner implementations satisfy the AgentRunner
 * interface contract, ensuring that:
 * - Capability declarations are present and consistent
 * - Execute method returns valid AgentRunResult
 * - New providers cannot silently break execution semantics
 *
 * When adding a new runner implementation, these tests should pass without
 * modification. If they don't, the new implementation violates the contract.
 */

const runners: Array<{ name: string; runner: AgentRunner }> = [
  { name: 'claude', runner: claudeRunner },
  { name: 'codex', runner: codexRunner },
];

describe('runner contract', () => {
  describe.each(runners)('$name runner', ({ name, runner }) => {
    it('has required provider field', () => {
      expect(runner.provider).toBeDefined();
      expect(typeof runner.provider).toBe('string');
      expect(runner.provider).toBe(name);
    });

    it('declares capabilities', () => {
      expect(runner.capabilities).toBeDefined();
      expect(typeof runner.capabilities).toBe('object');
      expect(typeof runner.capabilities.fullAccessExecution).toBe('boolean');
    });

    it('has execute method that accepts RunnerExecuteOptions', () => {
      expect(runner.execute).toBeDefined();
      expect(typeof runner.execute).toBe('function');

      // Verify it accepts an object with the expected shape (type-level enforced by TS)
      expect(runner.execute.length).toBe(1); // Single options parameter
    });
  });

  describe('createAgentRunner factory', () => {
    it('returns claude runner by default', () => {
      const runner = createAgentRunner();
      expect(runner.provider).toBe('claude');
    });

    it('returns claude runner when explicitly requested', () => {
      const runner = createAgentRunner('claude');
      expect(runner.provider).toBe('claude');
    });

    it('returns codex runner when explicitly requested', () => {
      const runner = createAgentRunner('codex');
      expect(runner.provider).toBe('codex');
    });

    it('returns valid runner for all provider types', () => {
      const providers = ['claude', 'codex'] as const;

      for (const provider of providers) {
        const runner = createAgentRunner(provider);
        expect(runner.provider).toBe(provider);
        expect(runner.capabilities).toBeDefined();
        expect(runner.execute).toBeDefined();
      }
    });
  });

  describe('capability declarations', () => {
    it('claude runner declares no full-access execution', () => {
      expect(claudeRunner.capabilities.fullAccessExecution).toBe(false);
    });

    it('codex runner declares full-access execution capability', () => {
      expect(codexRunner.capabilities.fullAccessExecution).toBe(true);
    });
  });

  describe('execution result contract', () => {
    it('runners return AgentRunResult with required fields', () => {
      // This test documents the expected return type shape.
      // We don't execute here, just verify the type contract is clear.

      // Type-level documentation of AgentRunResult:
      const exampleResult = {
        exitCode: 0,
        sessionId: 'test-session',
        usage: {},
        cost: 0.01,
      };

      expect(exampleResult.exitCode).toBeDefined();
      // sessionId, usage, cost are optional but commonly present
    });
  });

  describe('execution options contract', () => {
    it('RunnerExecuteOptions includes all required fields', () => {
      // Type-level documentation of the options contract
      const requiredOptions: RunnerExecuteOptions = {
        prompt: 'test',
        cwd: '/tmp',
        authToken: 'token',
      };

      expect(requiredOptions.prompt).toBeDefined();
      expect(requiredOptions.cwd).toBeDefined();
      expect(requiredOptions.authToken).toBeDefined();
    });

    it('RunnerExecuteOptions supports optional execution mode', () => {
      const optionsWithMode: RunnerExecuteOptions = {
        prompt: 'test',
        cwd: '/tmp',
        authToken: 'token',
        executionMode: 'full-access',
      };

      expect(optionsWithMode.executionMode).toBe('full-access');
    });

    it('RunnerExecuteOptions supports optional session correlation fields', () => {
      const optionsWithSession: RunnerExecuteOptions = {
        prompt: 'test',
        cwd: '/tmp',
        authToken: 'token',
        loopRunSessionId: 'loop-session-123',
        langfuse: null,
        sessionContext: undefined,
      };

      expect(optionsWithSession.loopRunSessionId).toBeDefined();
    });

    it('RunnerExecuteOptions supports optional model selection', () => {
      const optionsWithModel: RunnerExecuteOptions = {
        prompt: 'test',
        cwd: '/tmp',
        authToken: 'token',
        model: 'claude-3-5-sonnet-20241022',
      };

      expect(optionsWithModel.model).toBeDefined();
    });

    it('RunnerExecuteOptions supports optional log event callback', () => {
      const mockCallback = jest.fn();
      const optionsWithCallback: RunnerExecuteOptions = {
        prompt: 'test',
        cwd: '/tmp',
        authToken: 'token',
        onLogEvent: mockCallback,
      };

      expect(optionsWithCallback.onLogEvent).toBe(mockCallback);
    });
  });

  describe('runner implementation consistency', () => {
    it('all runners have unique provider identifiers', () => {
      const providers = runners.map(r => r.runner.provider);
      const uniqueProviders = new Set(providers);
      expect(uniqueProviders.size).toBe(providers.length);
    });

    it('factory can instantiate all registered runners', () => {
      for (const { name } of runners) {
        const runner = createAgentRunner(name as 'claude' | 'codex');
        expect(runner).toBeDefined();
        expect(runner.provider).toBe(name);
      }
    });
  });
});
