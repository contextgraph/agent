import { executeClaude } from '../claude-sdk.js';
import type { AgentRunner, RunnerExecuteOptions } from './types.js';

export const claudeRunner: AgentRunner = {
  provider: 'claude',
  capabilities: {
    fullAccessExecution: false,
  },
  async execute(options: RunnerExecuteOptions) {
    return executeClaude(options);
  },
};
