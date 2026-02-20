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
  async isAvailable(): Promise<boolean> {
    // Claude SDK is bundled with the agent, so it's always available
    return true;
  },
};
