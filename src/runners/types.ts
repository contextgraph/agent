import type { LogEvent } from '../log-transport.js';
import type { AgentRunOptions, AgentRunResult } from '../types/actions.js';
import type { Langfuse } from 'langfuse';
import type { StewardSessionContext } from '../langfuse-session.js';

export type AgentProvider = 'claude' | 'codex';
export type RunnerExecutionMode = 'restricted' | 'full-access';

export interface RunnerCapabilities {
  fullAccessExecution: boolean;
}

export interface RunnerExecuteOptions extends AgentRunOptions {
  onLogEvent?: (event: LogEvent) => void;
  model?: string;
  executionMode?: RunnerExecutionMode;
  loopRunSessionId?: string; // Session ID from loop wrapper for trace correlation
  langfuse?: Langfuse | null; // Langfuse client for observability tracing
  sessionContext?: StewardSessionContext; // Session context for Langfuse metadata
}

export interface AgentRunner {
  provider: AgentProvider;
  capabilities: RunnerCapabilities;
  execute(options: RunnerExecuteOptions): Promise<AgentRunResult>;
}
