import type { AgentProvider } from '../runners/index.js';
import type { AgentRunner, RunnerExecutionMode } from '../runners/types.js';
import type { WorkflowOptions } from './types.js';

const CODEX_BYPASS_SANDBOX_ENV = 'CONTEXTGRAPH_CODEX_BYPASS_SANDBOX';

export interface ExecutionModeResolution {
  mode: RunnerExecutionMode;
  source: 'explicit_option' | 'env_bypass' | 'default';
  bypassEnabled?: boolean;
}

export function resolveExecutionMode(options: WorkflowOptions | undefined, provider: AgentProvider): RunnerExecutionMode {
  if (options?.executionMode) {
    return options.executionMode;
  }

  if (provider === 'codex' && process.env[CODEX_BYPASS_SANDBOX_ENV] === '1') {
    return 'full-access';
  }

  return 'restricted';
}

export function resolveExecutionModeWithContext(
  options: WorkflowOptions | undefined,
  provider: AgentProvider
): ExecutionModeResolution {
  if (options?.executionMode) {
    return {
      mode: options.executionMode,
      source: 'explicit_option',
    };
  }

  const bypassEnabled = process.env[CODEX_BYPASS_SANDBOX_ENV] === '1';
  if (provider === 'codex' && bypassEnabled) {
    return {
      mode: 'full-access',
      source: 'env_bypass',
      bypassEnabled: true,
    };
  }

  return {
    mode: 'restricted',
    source: 'default',
    bypassEnabled: provider === 'codex' ? false : undefined,
  };
}

export function assertRunnerCapabilities(
  runner: AgentRunner,
  executionMode: RunnerExecutionMode,
  context: string
): void {
  if (executionMode === 'full-access' && !runner.capabilities.fullAccessExecution) {
    throw new Error(`${context} requires full-access execution, but provider "${runner.provider}" does not support it.`);
  }
}
