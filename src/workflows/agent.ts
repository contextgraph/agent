import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ApiClient } from '../api-client.js';
import type { ActionNode, ActionMetadata } from '../types/actions.js';
import { findNextLeaf, type FindNextLeafResult } from '../next-action.js';
import { runExecute } from './execute.js';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { setupWorkspaceForAction } from '../workspace-setup.js';
import type { AgentProvider } from '../runners/index.js';
import type { RunnerExecutionMode } from '../runners/types.js';
import chalk from 'chalk';

const API_BASE_URL = 'https://www.contextgraph.dev';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// When built, this file is in dist/, so package.json is one level up
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf-8')
);

// Polling configuration from environment variables
const INITIAL_POLL_INTERVAL = parseInt(process.env.WORKER_INITIAL_POLL_INTERVAL || '2000', 10);  // 2 seconds default
const MAX_POLL_INTERVAL = parseInt(process.env.WORKER_MAX_POLL_INTERVAL || '5000', 10);          // 5 seconds default
const BACKOFF_MULTIPLIER = 1.5;
const STATUS_INTERVAL_MS = 30000; // Show status every 30 seconds when idle

// Retry configuration for transient API errors
// For extended outages, we wait indefinitely with a ceiling on delay
const MAX_API_RETRIES = Infinity;  // Never give up on transient errors
const INITIAL_RETRY_DELAY = 1000;  // 1 second
const MAX_RETRY_DELAY = 60000;     // 1 minute ceiling
const OUTAGE_WARNING_THRESHOLD = 5;  // Warn user after this many retries

// Module-scope state for graceful shutdown
let running = true;
let currentClaim: { actionId: string; claimId: string; workerId: string } | null = null;
let apiClient: ApiClient | null = null;

// Stats tracking
const stats = {
  startTime: Date.now(),
  executed: 0,
  errors: 0,
};

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function printStatus(): void {
  const uptime = formatDuration(Date.now() - stats.startTime);
  const total = stats.executed;
  console.log(chalk.dim(`Status: ${total} actions (${stats.executed} executed, ${stats.errors} errors) | Uptime: ${uptime}`));
}

/**
 * Get the next action to work on, handling tree depth truncation.
 * If the tree is truncated (children exist beyond depth limit), this function
 * will recursively re-fetch the tree starting from the truncated node.
 */
async function getNextAction(
  apiClient: ApiClient,
  rootId: string,
  depth: number = 0
): Promise<ActionNode | null> {
  // Prevent infinite recursion in case of malformed data
  const maxDepth = 20;
  if (depth >= maxDepth) {
    console.error(chalk.red(`Tree traversal exceeded maximum depth (${maxDepth}). Possible cycle or malformed data.`));
    return null;
  }

  const tree = await apiClient.fetchTree(rootId, false);

  if (tree.done) {
    if (depth === 0) {
      console.log(chalk.green('Root action is already complete'));
    }
    return null;
  }

  // Use local findNextLeaf to traverse tree and find next action
  const result = findNextLeaf(tree);

  // If we found an action, return it
  if (result.action) {
    return result.action;
  }

  // If tree was truncated, re-fetch starting from the truncated node
  if (result.truncatedAt) {
    console.log(chalk.dim(`Tree depth limit reached at action ${result.truncatedAt}. Fetching deeper...`));
    return getNextAction(apiClient, result.truncatedAt, depth + 1);
  }

  // No action found and no truncation - tree is complete or blocked
  return null;
}

/**
 * Clean up any claimed work and exit gracefully
 */
async function cleanupAndExit(): Promise<void> {
  if (currentClaim && apiClient) {
    try {
      console.log(chalk.dim(`\nReleasing claim on action ${currentClaim.actionId}...`));
      await apiClient.releaseClaim({
        action_id: currentClaim.actionId,
        worker_id: currentClaim.workerId,
        claim_id: currentClaim.claimId,
      });
      console.log(chalk.dim('Claim released successfully'));
    } catch (error) {
      console.error(chalk.yellow('Failed to release claim:'), (error as Error).message);
    }
  }
  console.log('Shutdown complete');
  process.exit(0);
}

/**
 * Set up signal handlers for graceful shutdown
 */
function setupSignalHandlers(): void {
  process.on('SIGINT', async () => {
    console.log(chalk.yellow('\n\nReceived SIGINT (Ctrl+C). Shutting down gracefully...'));
    running = false;
    await cleanupAndExit();
  });

  process.on('SIGTERM', async () => {
    console.log(chalk.yellow('\n\nReceived SIGTERM. Shutting down gracefully...'));
    running = false;
    await cleanupAndExit();
  });
}

/**
 * Sleep for the specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if an error is likely transient and worth retrying
 */
function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();
  // Retry on server errors (5xx), network errors, and timeouts
  return (
    message.includes('api error 5') ||
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504') ||
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('socket hang up') ||
    message.includes('failed query')  // Database query failures
  );
}

export async function runLocalAgent(options?: {
  forceModel?: string;
  skipSkills?: boolean;
  provider?: AgentProvider;
  executionMode?: RunnerExecutionMode;
}): Promise<void> {
  // Initialize module-scope apiClient for signal handlers
  apiClient = new ApiClient();

  // Set up graceful shutdown handlers
  setupSignalHandlers();

  // Load and validate credentials upfront
  const credentials = await loadCredentials();
  if (!credentials) {
    console.error(chalk.red('Not authenticated.'));
    console.error(`   Set CONTEXTGRAPH_API_TOKEN environment variable or run ${chalk.cyan('contextgraph-agent auth')}`);
    process.exit(1);
  }
  if (isExpired(credentials) || isTokenExpired(credentials.clerkToken)) {
    console.error(chalk.red('Token expired.'), `Run ${chalk.cyan('contextgraph-agent auth')} to re-authenticate.`);
    process.exit(1);
  }

  // Show authentication method
  const usingApiToken = !!process.env.CONTEXTGRAPH_API_TOKEN;
  if (usingApiToken) {
    console.log(chalk.dim('Authenticated via CONTEXTGRAPH_API_TOKEN'));
  }

  // Generate unique worker ID for this session
  const workerId = randomUUID();

  console.log(`${chalk.bold('Contextgraph Agent')} ${chalk.dim(`v${packageJson.version}`)}`);
  console.log(chalk.dim(`Worker ID: ${workerId}`));
  console.log(chalk.dim(`Provider: ${options?.provider || 'claude'}`));
  if (options?.executionMode) {
    console.log(chalk.dim(`Execution mode: ${options.executionMode}`));
  }
  console.log('Starting continuous worker loop...\n');
  console.log(chalk.dim('Press Ctrl+C to gracefully shutdown and release any claimed work\n'));

  let currentPollInterval = INITIAL_POLL_INTERVAL;
  let lastStatusTime = Date.now();
  let consecutiveApiErrors = 0;
  let apiRetryDelay = INITIAL_RETRY_DELAY;

  while (running) {

    // Claim next action from worker queue with retry logic
    let actionDetail;
    try {
      actionDetail = await apiClient.claimNextAction(workerId);
      // Reset error tracking on success
      consecutiveApiErrors = 0;
      apiRetryDelay = INITIAL_RETRY_DELAY;
    } catch (error) {
      const err = error as Error;

      if (isRetryableError(err)) {
        consecutiveApiErrors++;

        // Show extended outage warning once
        if (consecutiveApiErrors === OUTAGE_WARNING_THRESHOLD) {
          console.warn(chalk.yellow(`\nAPI appears to be experiencing an outage.`));
          console.warn(chalk.yellow(`   Will continue retrying indefinitely (every ${MAX_RETRY_DELAY / 1000}s max).`));
          console.warn(chalk.yellow(`   Press Ctrl+C to stop.\n`));
        }

        if (consecutiveApiErrors < OUTAGE_WARNING_THRESHOLD) {
          console.warn(chalk.yellow(`API error (attempt ${consecutiveApiErrors}):`), err.message);
        } else if (consecutiveApiErrors % 10 === 0) {
          // Only log every 10th retry during extended outage to reduce noise
          console.warn(chalk.yellow(`Still retrying... (attempt ${consecutiveApiErrors}, last error: ${err.message})`));
        }

        const delaySeconds = Math.round(apiRetryDelay / 1000);
        if (consecutiveApiErrors < OUTAGE_WARNING_THRESHOLD) {
          console.warn(chalk.dim(`   Retrying in ${delaySeconds}s...`));
        }

        await sleep(apiRetryDelay);
        apiRetryDelay = Math.min(apiRetryDelay * 2, MAX_RETRY_DELAY);
        continue;
      }

      // Non-retryable error - re-throw
      throw err;
    }

    if (!actionDetail) {
      // Show periodic status while waiting
      if (Date.now() - lastStatusTime >= STATUS_INTERVAL_MS) {
        printStatus();
        lastStatusTime = Date.now();
      }
      await sleep(currentPollInterval);
      currentPollInterval = Math.min(currentPollInterval * BACKOFF_MULTIPLIER, MAX_POLL_INTERVAL);
      continue;
    }

    // Reset poll interval on successful claim
    currentPollInterval = INITIAL_POLL_INTERVAL;

    // Track current claim for graceful shutdown
    if (actionDetail.claim_id) {
      currentClaim = {
        actionId: actionDetail.id,
        claimId: actionDetail.claim_id,
        workerId,
      };
    }

    if (actionDetail.done) {
      // Action is already done - nothing to do
      console.log(chalk.dim(`Skipping action "${actionDetail.title}" - already completed`));
      if (currentClaim && apiClient) {
        try {
          await apiClient.releaseClaim({
            action_id: currentClaim.actionId,
            worker_id: currentClaim.workerId,
            claim_id: currentClaim.claimId,
          });
        } catch (releaseError) {
          console.error(chalk.yellow('Failed to release claim:'), (releaseError as Error).message);
        }
      }
      currentClaim = null;
      continue;
    }

    // Only print "Working" once we've determined there's actual work to do
    console.log(`${chalk.bold('Working:')} ${chalk.cyan(actionDetail.title)}`);

    // Set up workspace using shared function
    let workspacePath: string;
    let cleanup: (() => Promise<void>) | undefined;
    let startingCommit: string | undefined;
    let runId: string | undefined;

    try {
      // Use shared workspace setup that handles:
      // - Creating run FIRST (for skill tracking)
      // - Cloning repo and injecting skills (if repo configured)
      // - Creating blank workspace (if no repo)
      const setup = await setupWorkspaceForAction(actionDetail.id, {
        authToken: credentials.clerkToken,
        phase: 'execute',
        actionDetail, // Pass pre-fetched action detail to avoid redundant API call
        skipSkills: options?.skipSkills,
        provider: options?.provider,
      });
      workspacePath = setup.workspacePath;
      cleanup = setup.cleanup;
      startingCommit = setup.startingCommit;
      runId = setup.runId;

      let promptPrefix: string | undefined;
      if (setup.repos && setup.repos.length > 1) {
        const repoLines = setup.repos.map(r => {
          const branchInfo = r.branch ? `, branch: ${r.branch}` : '';
          return `- ${r.name}/ (${r.url}${branchInfo})`;
        }).join('\n');
        promptPrefix = `## Workspace Layout\nThis workspace contains multiple repositories:\n${repoLines}\n\nYour working directory is the workspace root. Use relative paths to navigate between repos.\nWhen committing changes, cd into each repo directory and commit/push separately.\nCreate separate PRs per repository if needed.`;
      } else if (setup.branch) {
        promptPrefix = `## Workspace Branch\nThe workspace has been checked out to branch \`${setup.branch}\`. You MUST use this exact branch name for all git operations (checkout, push, PR creation). Do NOT create a different branch name.`;
      }

      try {
        await runExecute(actionDetail.id, {
          cwd: workspacePath,
          startingCommit,
          model: options?.forceModel,
          provider: options?.provider,
          executionMode: options?.executionMode,
          runId,
          promptPrefix,
          prompt: actionDetail.prompt,
        });
        stats.executed++;
        console.log(`${chalk.bold.green('Completed:')} ${chalk.cyan(actionDetail.title)}`);
      } catch (executeError) {
        stats.errors++;
        console.error(chalk.red('Error:'), `${(executeError as Error).message}. Continuing...`);
      } finally {
        // Release claim after execution completes (success or failure)
        if (currentClaim && apiClient) {
          try {
            await apiClient.releaseClaim({
              action_id: currentClaim.actionId,
              worker_id: currentClaim.workerId,
              claim_id: currentClaim.claimId,
            });
          } catch (releaseError) {
            console.error(chalk.yellow('Failed to release claim:'), (releaseError as Error).message);
          }
        }
        currentClaim = null;
      }
    } catch (workspaceError) {
      // Handle workspace preparation or other errors
      stats.errors++;
      console.error(chalk.red('Error preparing workspace:'), `${(workspaceError as Error).message}. Continuing...`);

      // Release claim on workspace/preparation failure
      if (currentClaim && apiClient) {
        try {
          console.log(chalk.dim('Releasing claim due to workspace error...'));
          await apiClient.releaseClaim({
            action_id: currentClaim.actionId,
            worker_id: currentClaim.workerId,
            claim_id: currentClaim.claimId,
          });
          console.log(chalk.dim('Claim released'));
        } catch (releaseError) {
          console.error(chalk.yellow('Failed to release claim:'), (releaseError as Error).message);
        }
      }
      currentClaim = null;
    } finally {
      if (cleanup) {
        await cleanup();
      }
    }
  }

}
