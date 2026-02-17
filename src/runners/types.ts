import type { LogEvent } from '../log-transport.js';
import type { AgentRunOptions, AgentRunResult } from '../types/actions.js';

export type AgentProvider = 'claude';

export interface RunnerExecuteOptions extends AgentRunOptions {
  onLogEvent?: (event: LogEvent) => void;
  model?: string;
}

export interface AgentRunner {
  provider: AgentProvider;
  execute(options: RunnerExecuteOptions): Promise<AgentRunResult>;
}
