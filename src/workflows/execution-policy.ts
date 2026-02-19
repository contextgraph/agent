import type { AgentProvider } from '../runners/index.js';
import type { AgentRunner, RunnerExecutionMode } from '../runners/types.js';
import type { WorkflowOptions } from './types.js';

const CODEX_BYPASS_SANDBOX_ENV = 'CONTEXTGRAPH_CODEX_BYPASS_SANDBOX';

export function resolveExecutionMode(options: WorkflowOptions | undefined, provider: AgentProvider): RunnerExecutionMode {
  if (options?.executionMode) {
    return options.executionMode;
  }

  if (provider === 'codex' && process.env[CODEX_BYPASS_SANDBOX_ENV] === '1') {
    return 'full-access';
  }

  return 'restricted';
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
