import { describe, it, expect } from '@jest/globals';
import { assertRunnerCapabilities, resolveExecutionMode } from '../../src/workflows/execution-policy.js';
import type { AgentRunner } from '../../src/runners/types.js';

const makeRunner = (overrides?: Partial<AgentRunner>): AgentRunner => ({
  provider: 'codex',
  capabilities: {
    fullAccessExecution: true,
  },
  execute: async () => ({ exitCode: 0 }),
  ...overrides,
});

describe('execution policy', () => {
  it('defaults to restricted mode', () => {
    expect(resolveExecutionMode(undefined, 'codex')).toBe('restricted');
  });

  it('uses workflow-provided mode when present', () => {
    expect(resolveExecutionMode({ executionMode: 'full-access' }, 'codex')).toBe('full-access');
  });

  it('supports codex env opt-in for full-access mode', () => {
    const previous = process.env.CONTEXTGRAPH_CODEX_BYPASS_SANDBOX;
    process.env.CONTEXTGRAPH_CODEX_BYPASS_SANDBOX = '1';

    try {
      expect(resolveExecutionMode(undefined, 'codex')).toBe('full-access');
    } finally {
      if (previous === undefined) {
        delete process.env.CONTEXTGRAPH_CODEX_BYPASS_SANDBOX;
      } else {
        process.env.CONTEXTGRAPH_CODEX_BYPASS_SANDBOX = previous;
      }
    }
  });

  it('fails fast when full-access is required but unsupported', () => {
    const runner = makeRunner({
      provider: 'claude',
      capabilities: {
        fullAccessExecution: false,
      },
    });

    expect(() => assertRunnerCapabilities(runner, 'full-access', 'Execution workflow')).toThrow(
      'Execution workflow requires full-access execution'
    );
  });
});
