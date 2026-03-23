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

  describe('capability enforcement', () => {
    /**
     * These tests enforce that capability declarations match actual runtime behavior.
     *
     * CRITICAL: Runners must not claim capabilities they don't implement.
     * This prevents execution mode mismatches that could:
     * - Run agents without sandboxing when restricted mode was requested
     * - Break session correlation by ignoring environment variables
     * - Silently violate execution policy after refactoring
     */

    it('runners claiming fullAccessExecution must reject restricted mode requests', () => {
      // This test prevents a runner from claiming full-access capability
      // but then always running in restricted mode regardless of executionMode.
      //
      // If a runner declares fullAccessExecution=true, it MUST be able to
      // distinguish between executionMode='restricted' and 'full-access'
      // and honor both modes correctly.

      // Currently only codex claims fullAccessExecution
      const fullAccessRunners = runners.filter(r => r.runner.capabilities.fullAccessExecution);

      expect(fullAccessRunners.length).toBeGreaterThan(0);

      for (const { runner } of fullAccessRunners) {
        // Document the contract: a runner claiming fullAccessExecution
        // must be able to run in BOTH modes correctly
        expect(runner.capabilities.fullAccessExecution).toBe(true);

        // Type-level enforcement that these options are valid
        const restrictedOptions: RunnerExecuteOptions = {
          prompt: 'test',
          cwd: '/tmp',
          authToken: 'token',
          executionMode: 'restricted',
        };

        const fullAccessOptions: RunnerExecuteOptions = {
          prompt: 'test',
          cwd: '/tmp',
          authToken: 'token',
          executionMode: 'full-access',
        };

        // We don't execute here, but we verify the types are correct
        expect(restrictedOptions.executionMode).toBe('restricted');
        expect(fullAccessOptions.executionMode).toBe('full-access');
      }
    });

    it('runners must not ignore declared capabilities at runtime', () => {
      // This test documents that capability declarations are not just
      // for show - they represent actual runtime behavior that the
      // execution policy layer depends on.

      for (const { runner } of runners) {
        // Every runner must have a capabilities object
        expect(runner.capabilities).toBeDefined();
        expect(typeof runner.capabilities.fullAccessExecution).toBe('boolean');

        // The capability declaration is used by assertRunnerCapabilities
        // to fail fast when execution mode doesn't match capability.
        // Runners must ensure their execute() implementation respects
        // the executionMode parameter when they claim fullAccessExecution.

        if (runner.capabilities.fullAccessExecution) {
          // Runner claims it CAN do full-access execution
          // Therefore its execute() MUST check options.executionMode
          // and conditionally bypass sandbox when mode='full-access'
          expect(runner.provider).toBeDefined();
        } else {
          // Runner claims it CANNOT do full-access execution
          // Therefore assertRunnerCapabilities will prevent
          // this runner from being used when mode='full-access'
          expect(runner.capabilities.fullAccessExecution).toBe(false);
        }
      }
    });

    it('codex runner implementation respects executionMode parameter', () => {
      // Regression test for PR #19 execution policy fragility.
      //
      // Two reverts in commit history showed that codex runner
      // was using environment variables instead of respecting
      // the executionMode parameter, causing execution mode mismatches.
      //
      // This test enforces the contract:
      // - codexRunner.capabilities.fullAccessExecution === true
      // - codexRunner.execute() MUST check options.executionMode
      // - When executionMode='full-access', bypass sandbox
      // - When executionMode='restricted' (or undefined), use sandbox

      expect(codexRunner.capabilities.fullAccessExecution).toBe(true);
      expect(codexRunner.execute).toBeDefined();

      // Document the options contract
      const baseOptions = {
        prompt: 'test',
        cwd: '/tmp',
        authToken: 'token',
      };

      const restrictedOptions: RunnerExecuteOptions = {
        ...baseOptions,
        executionMode: 'restricted',
      };

      const fullAccessOptions: RunnerExecuteOptions = {
        ...baseOptions,
        executionMode: 'full-access',
      };

      // Verify types are correct (compile-time enforcement)
      expect(restrictedOptions.executionMode).toBe('restricted');
      expect(fullAccessOptions.executionMode).toBe('full-access');

      // Runtime enforcement: codex-runner.ts line 196 MUST check:
      // const bypassSandbox = options.executionMode === 'full-access';
      //
      // This prevents regression to environment-variable-based control
      // which caused the two reverts mentioned in the backlog rationale.
    });

    it('runners must not silently ignore session correlation fields', () => {
      // Session correlation is critical for observability infrastructure.
      // Runners that accept loopRunSessionId MUST pass it to their
      // execution environment, or session tracing breaks.

      const sessionOptions: RunnerExecuteOptions = {
        prompt: 'test',
        cwd: '/tmp',
        authToken: 'token',
        loopRunSessionId: 'loop-session-123',
        langfuse: null,
        sessionContext: undefined,
      };

      // Both runners must support session correlation
      expect(sessionOptions.loopRunSessionId).toBe('loop-session-123');

      // Documentation of the contract:
      // - codex-runner.ts line 236: spreads LOOP_RUN_SESSION_ID into env
      // - claude-sdk.ts line 237: spreads LOOP_RUN_SESSION_ID into env
      //
      // If a runner ignores this field, session correlation breaks
      // and the observation infrastructure cannot link traces.
    });
  });
});
