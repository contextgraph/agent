import type { AgentProvider } from '../runners/index.js';

export interface WorkflowOptions {
  cwd?: string;
  startingCommit?: string;
  model?: string;
  provider?: AgentProvider;
  runId?: string; // Pre-created runId (skips run creation and workspace setup if provided)
  skipSkills?: boolean; // Skip skill injection (for testing)
  promptPrefix?: string; // Prepended to the server-fetched prompt (e.g. workspace layout)
}
