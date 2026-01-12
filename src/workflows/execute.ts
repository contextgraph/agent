import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { executeClaude } from '../claude-sdk.js';
import { fetchWithRetry } from '../fetch-with-retry.js';
import { LogTransportService } from '../log-transport.js';
import { LogBuffer } from '../log-buffer.js';
import { HeartbeatManager } from '../heartbeat-manager.js';
import { ApiClient } from '../api-client.js';
import { prepareWorkspace } from '../workspace-prep.js';

const API_BASE_URL = 'https://www.contextgraph.dev';

export interface WorkflowOptions {
  cwd?: string;
  startingCommit?: string;
  model?: string;
}

export async function runExecute(actionId: string, options?: WorkflowOptions): Promise<void> {
  const credentials = await loadCredentials();

  if (!credentials) {
    console.error('❌ Not authenticated. Run authentication first.');
    process.exit(1);
  }

  if (isExpired(credentials) || isTokenExpired(credentials.clerkToken)) {
    console.error('❌ Token expired. Re-authenticate to continue.');
    process.exit(1);
  }

  // Determine workspace - use provided cwd or prepare workspace from action details
  let workspacePath: string;
  let cleanup: (() => Promise<void>) | undefined;
  let startingCommit = options?.startingCommit;

  if (options?.cwd) {
    // Called from agent.ts with pre-prepared workspace
    workspacePath = options.cwd;
  } else {
    // Standalone CLI invocation - prepare workspace ourselves
    const apiClient = new ApiClient();
    const actionDetail = await apiClient.getActionDetail(actionId);

    const repoUrl = actionDetail.resolved_repository_url || actionDetail.repository_url;
    const branch = actionDetail.resolved_branch || actionDetail.branch;

    if (repoUrl) {
      console.log(`📦 Preparing workspace for action "${actionDetail.title}"...`);
      const workspace = await prepareWorkspace(repoUrl, {
        branch: branch || undefined,
        authToken: credentials.clerkToken,
      });
      workspacePath = workspace.path;
      cleanup = workspace.cleanup;
      startingCommit = workspace.startingCommit;
    } else {
      console.log(`📂 No repository configured - creating blank workspace`);
      workspacePath = await mkdtemp(join(tmpdir(), 'cg-workspace-'));
      console.log(`   → ${workspacePath}`);
      cleanup = async () => {
        const { rm } = await import('fs/promises');
        await rm(workspacePath, { recursive: true, force: true });
      };
    }
  }

  // Initialize log streaming infrastructure
  const logTransport = new LogTransportService(API_BASE_URL, credentials.clerkToken);
  let runId: string | undefined;
  let heartbeatManager: HeartbeatManager | undefined;
  let logBuffer: LogBuffer | undefined;

  try {
    // Create run for this execution FIRST so we have runId for the prompt
    console.log('[Log Streaming] Creating run...');
    runId = await logTransport.createRun(actionId, 'execute', {
      startingCommit,
    });
    console.log(`[Log Streaming] Run created: ${runId}`);

    // Now fetch execution instructions with runId included
    console.log(`Fetching execution instructions for action ${actionId}...\n`);

    const response = await fetchWithRetry(
      `${API_BASE_URL}/api/prompts/execute`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${credentials.clerkToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ actionId, runId }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch execute prompt: ${response.statusText}\n${errorText}`);
    }

    const { prompt } = await response.json();

    // Update run state to executing
    await logTransport.updateRunState('executing');

    // Start heartbeat manager
    heartbeatManager = new HeartbeatManager(API_BASE_URL, credentials.clerkToken, runId);
    heartbeatManager.start();
    console.log('[Log Streaming] Heartbeat started');

    // Set up log buffer for non-blocking transmission
    logBuffer = new LogBuffer(logTransport);
    logBuffer.start();

    console.log('Spawning Claude for execution...\n');

    const claudeResult = await executeClaude({
      prompt,
      cwd: workspacePath,
      authToken: credentials.clerkToken,
      ...(options?.model ? { model: options.model } : {}),
      onLogEvent: (event) => {
        logBuffer!.push(event);
      },
    });

    // Update run state based on execution result
    if (claudeResult.exitCode === 0) {
      await logTransport.finishRun('success', {
        exitCode: claudeResult.exitCode,
        cost: claudeResult.cost,
        usage: claudeResult.usage,
      });
      console.log('\n✅ Execution complete');
    } else {
      await logTransport.finishRun('error', {
        exitCode: claudeResult.exitCode,
        errorMessage: `Claude execution failed with exit code ${claudeResult.exitCode}`,
      });
      throw new Error(`Claude execution failed with exit code ${claudeResult.exitCode}`);
    }

  } catch (error) {
    // Update run state to failed if we have a run
    if (runId) {
      try {
        await logTransport.finishRun('error', {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      } catch (stateError) {
        console.error('[Log Streaming] Failed to update run state:', stateError);
      }
    }
    throw error;

  } finally {
    // Cleanup: stop heartbeat and flush remaining logs
    if (heartbeatManager) {
      heartbeatManager.stop();
      console.log('[Log Streaming] Heartbeat stopped');
    }

    if (logBuffer) {
      await logBuffer.stop();
      console.log('[Log Streaming] Logs flushed');
    }

    // Cleanup workspace if we created it
    if (cleanup) {
      await cleanup();
    }
  }
}
