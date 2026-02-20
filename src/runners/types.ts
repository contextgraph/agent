import type { LogEvent } from '../log-transport.js';
import type { AgentRunOptions, AgentRunResult } from '../types/actions.js';

export type AgentProvider = 'claude' | 'codex';
export type RunnerExecutionMode = 'restricted' | 'full-access';

/**
 * Declares what capabilities a runner implementation supports.
 *
 * This enables workflows to make informed provider selection decisions and fail fast
 * if routed to a runner that cannot meet their requirements.
 */
export interface RunnerCapabilities {
  /**
   * Whether this runner can execute in full-access mode with sandbox bypass.
   *
   * Full-access execution is required for git operations (commit, push, create PRs)
   * that need system-level access beyond sandboxed environments.
   *
   * - `false`: Runner operates in a sandboxed environment (e.g., Claude SDK)
   * - `true`: Runner can bypass sandbox when configured (e.g., Codex with
   *   `CONTEXTGRAPH_CODEX_BYPASS_SANDBOX=1`)
   *
   * **Enforcement:** See `assertRunnerCapabilities()` in `execution-policy.ts` for
   * validation logic that prevents mismatched execution modes.
   */
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
}
