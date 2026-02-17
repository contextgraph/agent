import { executeClaude } from '../claude-sdk.js';
import type { AgentRunner, RunnerExecuteOptions } from './types.js';

export const claudeRunner: AgentRunner = {
  provider: 'claude',
  async execute(options: RunnerExecuteOptions) {
    return executeClaude(options);
  },
};
