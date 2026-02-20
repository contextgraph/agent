import { executeClaude } from '../claude-sdk.js';
import type { AgentRunner, RunnerExecuteOptions } from './types.js';

/**
 * Claude agent runner using the Anthropic Claude SDK.
 *
 * **Capability Constraints:**
 * - `fullAccessExecution: false` - The Claude SDK does not provide sandbox bypass
 *   mechanisms required for git operations (commit, push, create PRs). Git operations
 *   require system-level access that the SDK's sandboxed environment cannot provide.
 *
 * **For workflows requiring git operations:** Use the Codex runner instead, which
 * supports full-access execution mode through `CONTEXTGRAPH_CODEX_BYPASS_SANDBOX=1`.
 *
 * **Enforcement:** Workflows that declare `executionMode: 'full-access'` will fail
 * fast with a clear error if routed to the Claude runner (see `execution-policy.ts`).
 */
export const claudeRunner: AgentRunner = {
  provider: 'claude',
  capabilities: {
    fullAccessExecution: false,
  },
  async execute(options: RunnerExecuteOptions) {
    return executeClaude(options);
  },
};
