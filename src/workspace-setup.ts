import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { prepareWorkspace } from './workspace-prep.js';
import { LogTransportService } from './log-transport.js';
import { ApiClient } from './api-client.js';
import type { ActionDetailResource } from './types/actions.js';

const API_BASE_URL = 'https://www.contextgraph.dev';

export interface WorkspaceSetupResult {
  workspacePath: string;
  cleanup: () => Promise<void>;
  startingCommit: string | undefined;
  runId: string;
  logTransport: LogTransportService;
}

export interface WorkspaceSetupOptions {
  /** Auth token for API calls */
  authToken: string;
  /** Phase of execution ('prepare' or 'execute') */
  phase: 'prepare' | 'execute';
  /** Pre-fetched action detail (skips API call if provided) */
  actionDetail?: ActionDetailResource;
  /** Optional starting commit override */
  startingCommit?: string;
}

/**
 * Sets up a workspace for action execution.
 *
 * This function handles the full workspace setup flow:
 * 1. Fetches action details (if not provided)
 * 2. Creates the run FIRST (so skill loading can be tracked)
 * 3. Clones the repository and injects skills (if repo configured)
 * 4. Or creates a blank temp workspace (if no repo)
 *
 * Used by both the agent loop and standalone prepare/execute commands
 * to ensure consistent behavior.
 */
export async function setupWorkspaceForAction(
  actionId: string,
  options: WorkspaceSetupOptions
): Promise<WorkspaceSetupResult> {
  const { authToken, phase, startingCommit: startingCommitOverride } = options;

  // Fetch action details if not provided
  let actionDetail = options.actionDetail;
  if (!actionDetail) {
    const apiClient = new ApiClient();
    console.log(`Fetching action details for ${actionId}...`);
    actionDetail = await apiClient.getActionDetail(actionId);
  }

  // Create run FIRST so we can track which skills are loaded
  // This enables the "skill refinement signals" feature
  const logTransport = new LogTransportService(API_BASE_URL, authToken);
  console.log(`[Log Streaming] Creating run for ${phase} phase...`);
  const runId = await logTransport.createRun(actionId, phase, {
    startingCommit: startingCommitOverride,
  });
  console.log(`[Log Streaming] Run created: ${runId}`);

  // Set up workspace based on whether action has a repository
  const repoUrl = actionDetail.resolved_repository_url || actionDetail.repository_url;
  const branch = actionDetail.resolved_branch || actionDetail.branch;

  let workspacePath: string;
  let cleanup: () => Promise<void>;
  let startingCommit: string | undefined = startingCommitOverride;

  if (repoUrl) {
    // Clone repository and inject skills
    // Pass runId so skills loading is recorded for this run
    const workspace = await prepareWorkspace(repoUrl, {
      branch: branch || undefined,
      authToken,
      runId,
    });
    workspacePath = workspace.path;
    cleanup = workspace.cleanup;
    startingCommit = workspace.startingCommit;
  } else {
    // Create a blank temp directory (no repo configured)
    console.log(`📂 No repository configured - creating blank workspace`);
    workspacePath = await mkdtemp(join(tmpdir(), 'cg-workspace-'));
    console.log(`   → ${workspacePath}`);
    cleanup = async () => {
      try {
        await rm(workspacePath, { recursive: true, force: true });
      } catch (error) {
        console.error(`Warning: Failed to cleanup workspace at ${workspacePath}:`, error);
      }
    };
  }

  return {
    workspacePath,
    cleanup,
    startingCommit,
    runId,
    logTransport,
  };
}
