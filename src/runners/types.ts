import type { LogEvent } from '../log-transport.js';
import type { AgentRunOptions, AgentRunResult } from '../types/actions.js';

export type AgentProvider = 'claude' | 'codex';
export type RunnerExecutionMode = 'restricted' | 'full-access';

export interface RunnerCapabilities {
  fullAccessExecution: boolean;
}

export interface RunnerExecuteOptions extends AgentRunOptions {
  onLogEvent?: (event: LogEvent) => void;
  model?: string;
  executionMode?: RunnerExecutionMode;
}

export interface AgentRunner {
  provider: AgentProvider;
  capabilities: RunnerCapabilities;
  execute(options: RunnerExecuteOptions): Promise<AgentRunResult>;
  isAvailable(): Promise<boolean>;
}
