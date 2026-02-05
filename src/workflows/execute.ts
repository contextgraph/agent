import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { executeClaude } from '../claude-sdk.js';
import { fetchWithRetry } from '../fetch-with-retry.js';
import { LogTransportService } from '../log-transport.js';
import { LogBuffer } from '../log-buffer.js';
import { HeartbeatManager } from '../heartbeat-manager.js';
import { setupWorkspaceForAction } from '../workspace-setup.js';
import chalk from 'chalk';

const API_BASE_URL = 'https://www.contextgraph.dev';

export interface WorkflowOptions {
  cwd?: string;
  startingCommit?: string;
  model?: string;
  runId?: string; // Pre-created runId (skips run creation and workspace setup if provided)
  skipSkills?: boolean; // Skip skill injection (for testing)
}

export async function runExecute(actionId: string, options?: WorkflowOptions): Promise<void> {
  const credentials = await loadCredentials();

  if (!credentials) {
    console.error(chalk.red('Not authenticated.'), 'Run authentication first.');
    process.exit(1);
  }

  if (isExpired(credentials) || isTokenExpired(credentials.clerkToken)) {
    console.error(chalk.red('Token expired.'), 'Re-authenticate to continue.');
    process.exit(1);
  }

  let runId: string | undefined = options?.runId;
  let heartbeatManager: HeartbeatManager | undefined;
  let logBuffer: LogBuffer | undefined;
  let workspacePath: string | undefined;
  let cleanup: (() => Promise<void>) | undefined;
  let logTransport: LogTransportService;

  try {
    // If no pre-created runId, set up workspace from scratch using shared function
    // This matches the behavior of the agent loop
    if (!runId) {
      const setup = await setupWorkspaceForAction(actionId, {
        authToken: credentials.clerkToken,
        phase: 'execute',
        startingCommit: options?.startingCommit,
        skipSkills: options?.skipSkills,
      });
      workspacePath = setup.workspacePath;
      cleanup = setup.cleanup;
      runId = setup.runId;
      logTransport = setup.logTransport;
    } else {
      // runId was pre-provided, use the provided cwd (agent loop already set up workspace)
      console.log(chalk.dim(`[Log Streaming] Using pre-created run: ${runId}`));
      workspacePath = options?.cwd || process.cwd();
      // Create log transport with existing runId
      logTransport = new LogTransportService(API_BASE_URL, credentials.clerkToken, runId);
    }

    // Now fetch execution instructions with runId included
    console.log(chalk.dim(`Fetching execution instructions for action ${actionId}...\n`));

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
    console.log(chalk.dim('[Log Streaming] Heartbeat started'));

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
      console.log('\n' + chalk.green('Execution complete'));
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
        console.error(chalk.dim('[Log Streaming] Failed to update run state:'), stateError);
      }
    }
    throw error;

  } finally {
    // Cleanup: stop heartbeat and flush remaining logs
    if (heartbeatManager) {
      heartbeatManager.stop();
      console.log(chalk.dim('[Log Streaming] Heartbeat stopped'));
    }

    if (logBuffer) {
      await logBuffer.stop();
      console.log(chalk.dim('[Log Streaming] Logs flushed'));
    }

    // Cleanup workspace if we created it
    if (cleanup) {
      await cleanup();
    }
  }
}
