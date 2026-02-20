import { executeClaude } from '../claude-sdk.js';
import { AGENT_CAPABILITIES } from './capabilities.js';
import type { AgentRunner, RunnerExecuteOptions } from './types.js';

export const claudeRunner: AgentRunner = {
  provider: 'claude',
  capabilities: {
    fullAccessExecution: false,
    capabilities: [
      AGENT_CAPABILITIES.FILE_OPERATIONS,
      AGENT_CAPABILITIES.SHELL_EXECUTION,
      AGENT_CAPABILITIES.CODE_SEARCH,
      AGENT_CAPABILITIES.GIT_OPERATIONS,
      AGENT_CAPABILITIES.GITHUB_PR_OPERATIONS,
      AGENT_CAPABILITIES.PACKAGE_MANAGEMENT,
      AGENT_CAPABILITIES.BUILD_AND_TEST,
      AGENT_CAPABILITIES.MCP_TOOLS,
      AGENT_CAPABILITIES.MULTI_TURN_EXECUTION,
      AGENT_CAPABILITIES.STREAMING_LOGS,
      // Note: Claude runner operates in restricted mode by default (no FULL_ACCESS_EXECUTION)
      // Note: No NETWORK_ACCESS by default (sandbox restrictions)
      // Note: No INTERACTIVE_PROMPTS (non-interactive execution)
      // Note: No ASYNC_EXECUTION (synchronous execution model)
    ],
  },
  async execute(options: RunnerExecuteOptions) {
    return executeClaude(options);
  },
};
