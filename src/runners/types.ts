import type { LogEvent } from '../log-transport.js';
import type { AgentRunOptions, AgentRunResult } from '../types/actions.js';
import type { AgentCapability } from './capabilities.js';

export type AgentProvider = 'claude' | 'codex';
export type RunnerExecutionMode = 'restricted' | 'full-access';

/**
 * Runner capabilities interface
 *
 * This interface supports both legacy boolean flags and modern capability arrays.
 * New code should use the `capabilities` array with values from AGENT_CAPABILITIES.
 *
 * @deprecated fullAccessExecution - Use capabilities array with AGENT_CAPABILITIES.FULL_ACCESS_EXECUTION instead
 */
export interface RunnerCapabilities {
  /** @deprecated Use capabilities array instead */
  fullAccessExecution: boolean;

  /** Modern capability array using standardized capability identifiers */
  capabilities?: AgentCapability[];
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
}
