import { randomUUID } from 'crypto';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { createAgentRunner } from '../runners/index.js';
import { fetchWithRetry } from '../fetch-with-retry.js';
import { LogTransportService } from '../log-transport.js';
import { LogBuffer } from '../log-buffer.js';
import { HeartbeatManager } from '../heartbeat-manager.js';
import { setupWorkspaceForAction } from '../workspace-setup.js';
import chalk from 'chalk';
import type { WorkflowOptions } from './types.js';
import { assertRunnerCapabilities, resolveExecutionMode } from './execution-policy.js';

export type { WorkflowOptions };

const API_BASE_URL = 'https://www.contextgraph.dev';

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
  let logTransport!: LogTransportService;
  let runFinalized = false;
  let claimToRelease: { actionId: string; workerId: string; claimId: string } | null = null;

  try {
    // If no pre-created runId, set up workspace from scratch using shared function
    // This matches the behavior of the agent loop
    if (!runId) {
      // Standalone execute should use the same worker queue payload path as loop mode.
      // Claim the requested action so we receive the canonical prompt and claim metadata.
      const standaloneWorkerId = randomUUID();
      let claimedActionDetail: any = null;
      if (!options?.prompt) {
        const claimResponse = await fetchWithRetry(
          `${API_BASE_URL}/api/worker/next`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${credentials.clerkToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              worker_id: standaloneWorkerId,
              action_id: actionId,
            }),
          }
        );
        if (!claimResponse.ok) {
          const errorText = await claimResponse.text();
          throw new Error(`Failed to claim action from worker queue: ${claimResponse.statusText}\n${errorText}`);
        }
        const claimResult = (await claimResponse.json()) as { success: boolean; data: any; error?: string };
        if (!claimResult.success) {
          throw new Error(claimResult.error || 'Worker queue returned unsuccessful response');
        }
        claimedActionDetail = claimResult.data;
      }
      if (!claimedActionDetail && !options?.prompt) {
        throw new Error(`Action ${actionId} is not currently claimable via worker queue`);
      }
      if (claimedActionDetail?.id && claimedActionDetail.id !== actionId) {
        throw new Error(`Worker queue claimed unexpected action ${claimedActionDetail.id} while targeting ${actionId}`);
      }
      if (claimedActionDetail?.claim_id) {
        claimToRelease = {
          actionId,
          workerId: standaloneWorkerId,
          claimId: claimedActionDetail.claim_id,
        };
      }

      const setup = await setupWorkspaceForAction(actionId, {
        authToken: credentials.clerkToken,
        phase: 'execute',
        actionDetail: claimedActionDetail || undefined,
        startingCommit: options?.startingCommit,
        skipSkills: options?.skipSkills,
        provider: options?.provider,
      });
      workspacePath = setup.workspacePath;
      cleanup = setup.cleanup;
      runId = setup.runId;
      logTransport = setup.logTransport;

      if (!options?.promptPrefix && setup.branch) {
        options = {
          ...options,
          promptPrefix: `## Workspace Branch\nThe workspace has been checked out to branch \`${setup.branch}\`. You MUST use this exact branch name for all git operations (checkout, push, PR creation). Do NOT create a different branch name.`,
        };
      }
      if (!options?.prompt && claimedActionDetail?.prompt) {
        options = {
          ...options,
          prompt: claimedActionDetail.prompt,
        };
      }
      // Log prompt version for observability in standalone execution mode
      if (claimedActionDetail?.prompt_version) {
        console.log(chalk.dim(`Prompt version: ${claimedActionDetail.prompt_version}`));
      }
    } else {
      // runId was pre-provided, use the provided cwd (agent loop already set up workspace)
      console.log(chalk.dim(`[Log Streaming] Using pre-created run: ${runId}`));
      workspacePath = options?.cwd || process.cwd();
      // Create log transport with existing runId
      logTransport = new LogTransportService(API_BASE_URL, credentials.clerkToken, runId, undefined, options?.provider);
    }

    let serverPrompt = options?.prompt;
    if (serverPrompt) {
      console.log(chalk.dim(`Using queue-provided execution instructions for action ${actionId}...\n`));
    } else {
      // TEMPORARY: Backward-compatible fallback for edge cases where worker/next
      // doesn't return a prompt. This is kept for robustness during the transition
      // period, but should be removed once we're confident all execution paths
      // go through worker/next with prompt embedding.
      //
      // The server-side change to embed prompts in worker/next responses was
      // deployed in contextgraph/actions PR #1260. This fallback can be removed
      // after confirming no telemetry shows this code path being hit.
      //
      // TODO(contextgraph/actions#1260): Remove this fallback when these signals
      // confirm it's no longer needed:
      //
      // Removal criteria (all must be true for 7+ days):
      // 1. Zero hits on /api/prompts/execute endpoint in Vercel request logs
      // 2. No "Fetching execution instructions" console output in agent logs
      //    (this message below indicates fallback usage)
      // 3. PR #1260 has been deployed to production for at least 7 days
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

      const result = (await response.json()) as { prompt: string };
      serverPrompt = result.prompt;
    }

    const prompt = options?.promptPrefix ? `${options.promptPrefix}\n\n${serverPrompt}` : serverPrompt;

    // Update run state to executing
    await logTransport.updateRunState('executing');

    // Start heartbeat manager
    heartbeatManager = new HeartbeatManager(API_BASE_URL, credentials.clerkToken, runId);
    heartbeatManager.start();
    console.log(chalk.dim('[Log Streaming] Heartbeat started'));

    // Set up log buffer for non-blocking transmission
    logBuffer = new LogBuffer(logTransport);
    logBuffer.start();

    const runner = createAgentRunner(options?.provider);
    const providerName = runner.provider === 'codex' ? 'Codex' : 'Claude';
    const executionMode = resolveExecutionMode(options, runner.provider);
    assertRunnerCapabilities(runner, executionMode, 'Execution workflow');
    console.log(`Spawning ${providerName} for execution...\n`);

    const runResult = await runner.execute({
      prompt,
      cwd: workspacePath,
      authToken: credentials.clerkToken,
      executionActionId: actionId,
      executionMode,
      ...(options?.model ? { model: options.model } : {}),
      ...(options?.loopRunSessionId ? { loopRunSessionId: options.loopRunSessionId } : {}),
      onLogEvent: (event) => {
        logBuffer!.push(event);
      },
    });

    // Update run state based on execution result
    if (runResult.exitCode === 0) {
      await logTransport.finishRun('success', {
        exitCode: runResult.exitCode,
        cost: runResult.cost,
        usage: runResult.usage,
      });
      runFinalized = true;
      console.log('\n' + chalk.green('Execution complete'));
    } else {
      await logTransport.finishRun('error', {
        exitCode: runResult.exitCode,
        errorMessage: `${providerName} execution failed with exit code ${runResult.exitCode}`,
      });
      runFinalized = true;
      throw new Error(`${providerName} execution failed with exit code ${runResult.exitCode}`);
    }

  } catch (error) {
    // Update run state to failed if we have a run
    if (runId && !runFinalized) {
      try {
        await logTransport.finishRun('error', {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        runFinalized = true;
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

    if (claimToRelease) {
      try {
        const releaseResponse = await fetchWithRetry(
          `${API_BASE_URL}/api/worker/release`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${credentials.clerkToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              action_id: claimToRelease.actionId,
              worker_id: claimToRelease.workerId,
              claim_id: claimToRelease.claimId,
            }),
          }
        );
        if (!releaseResponse.ok) {
          const errorText = await releaseResponse.text();
          throw new Error(`Failed to release claim: ${releaseResponse.statusText}\n${errorText}`);
        }
      } catch (releaseError) {
        console.error(chalk.yellow('Failed to release standalone execute claim:'), (releaseError as Error).message);
      }
    }
  }
}
