import { claudeRunner } from './claude-runner.js';
import { codexRunner } from './codex-runner.js';
import type { AgentProvider, AgentRunner } from './types.js';

export function createAgentRunner(provider: AgentProvider = 'claude'): AgentRunner {
  switch (provider) {
    case 'claude':
      return claudeRunner;
    case 'codex':
      return codexRunner;
    default:
      return claudeRunner;
  }
}

export type { AgentProvider, AgentRunner, RunnerExecuteOptions } from './types.js';
