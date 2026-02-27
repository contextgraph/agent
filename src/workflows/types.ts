import type { AgentProvider } from '../runners/index.js';
import type { RunnerExecutionMode } from '../runners/types.js';

export interface WorkflowOptions {
  cwd?: string;
  startingCommit?: string;
  model?: string;
  provider?: AgentProvider;
  executionMode?: RunnerExecutionMode;
  runId?: string; // Pre-created runId (skips run creation and workspace setup if provided)
  skipSkills?: boolean; // Skip skill injection (for testing)
  promptPrefix?: string; // Prepended to the server-fetched prompt (e.g. workspace layout)
  prompt?: string; // Server-provided prompt payload (preferred in loop execution mode)
  loopRunSessionId?: string; // Session ID from loop wrapper for trace correlation
}
