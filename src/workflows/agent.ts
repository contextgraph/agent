import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ApiClient } from '../api-client.js';
import type { ActionNode, ActionMetadata } from '../types/actions.js';
import { findNextLeaf, type FindNextLeafResult } from '../next-action.js';
import { runPrepare } from './prepare.js';
import { runExecute } from './execute.js';
import { prepareWorkspace } from '../workspace-prep.js';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';

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

// Module-scope state for graceful shutdown
let running = true;
let currentClaim: { actionId: string; claimId: string; workerId: string } | null = null;
let apiClient: ApiClient | null = null;

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
    console.error(`❌ Tree traversal exceeded maximum depth (${maxDepth}). Possible cycle or malformed data.`);
    return null;
  }

  const tree = await apiClient.fetchTree(rootId, false);

  if (tree.done) {
    if (depth === 0) {
      console.log('✅ Root action is already complete');
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
    console.log(`📊 Tree depth limit reached at action ${result.truncatedAt}. Fetching deeper...`);
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
      console.log(`\n🧹 Releasing claim on action ${currentClaim.actionId}...`);
      await apiClient.releaseClaim({
        action_id: currentClaim.actionId,
        worker_id: currentClaim.workerId,
        claim_id: currentClaim.claimId,
      });
      console.log('✅ Claim released successfully');
    } catch (error) {
      console.error('⚠️  Failed to release claim:', (error as Error).message);
    }
  }
  console.log('👋 Shutdown complete');
  process.exit(0);
}

/**
 * Set up signal handlers for graceful shutdown
 */
function setupSignalHandlers(): void {
  process.on('SIGINT', async () => {
    console.log('\n\n⚠️  Received SIGINT (Ctrl+C). Shutting down gracefully...');
    running = false;
    await cleanupAndExit();
  });

  process.on('SIGTERM', async () => {
    console.log('\n\n⚠️  Received SIGTERM. Shutting down gracefully...');
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

export async function runLocalAgent(): Promise<void> {
  // Initialize module-scope apiClient for signal handlers
  apiClient = new ApiClient();

  // Set up graceful shutdown handlers
  setupSignalHandlers();

  // Load and validate credentials upfront
  const credentials = await loadCredentials();
  if (!credentials) {
    console.error('❌ Not authenticated. Run `contextgraph auth` first.');
    process.exit(1);
  }
  if (isExpired(credentials) || isTokenExpired(credentials.clerkToken)) {
    console.error('❌ Token expired. Run `contextgraph auth` to re-authenticate.');
    process.exit(1);
  }

  // Generate unique worker ID for this session
  const workerId = randomUUID();

  console.log(`🤖 ContextGraph Agent v${packageJson.version}`);
  console.log(`👷 Worker ID: ${workerId}`);
  console.log(`🔄 Starting continuous worker loop...\n`);
  console.log(`💡 Press Ctrl+C to gracefully shutdown and release any claimed work\n`);

  let currentPollInterval = INITIAL_POLL_INTERVAL;
  let wasWaiting = false;

  while (running) {

    // Claim next action from worker queue
    const actionDetail = await apiClient.claimNextAction(workerId);

    if (!actionDetail) {
      if (!wasWaiting) {
        console.log(`Waiting for work...`);
        wasWaiting = true;
      }
      await sleep(currentPollInterval);
      currentPollInterval = Math.min(currentPollInterval * BACKOFF_MULTIPLIER, MAX_POLL_INTERVAL);
      continue;
    }

    wasWaiting = false;

    // Reset poll interval on successful claim
    currentPollInterval = INITIAL_POLL_INTERVAL;

    console.log(`Working: ${actionDetail.title}`);

    // Track current claim for graceful shutdown
    if (actionDetail.claim_id) {
      currentClaim = {
        actionId: actionDetail.id,
        claimId: actionDetail.claim_id,
        workerId,
      };
    }

    const isPrepared = actionDetail.prepared !== false;

    // Prepare workspace - repository URL is required
    const repoUrl = actionDetail.resolved_repository_url || actionDetail.repository_url;
    const branch = actionDetail.resolved_branch || actionDetail.branch;

    if (!repoUrl) {
      console.error(`\n❌ Action "${actionDetail.title}" has no repository_url set.`);
      console.error(`   Actions must have a repository_url (directly or inherited from parent).`);
      console.error(`   Action ID: ${actionDetail.id}`);
      console.error(`   resolved_repository_url: ${actionDetail.resolved_repository_url}`);
      console.error(`   repository_url: ${actionDetail.repository_url}`);
      process.exit(1);
    }

    let workspacePath: string;
    let cleanup: (() => Promise<void>) | undefined;

    try {
      const workspace = await prepareWorkspace(repoUrl, {
        branch: branch || undefined,
        authToken: credentials.clerkToken,
      });
      workspacePath = workspace.path;
      cleanup = workspace.cleanup;

      if (!isPrepared) {
        await runPrepare(actionDetail.id, { cwd: workspacePath });
        // Claim is automatically released server-side when prepared=true is set
        currentClaim = null;
        continue;
      }

      try {
        await runExecute(actionDetail.id, { cwd: workspacePath });
        console.log(`Completed: ${actionDetail.title}`);
      } catch (executeError) {
        console.error(`Error: ${(executeError as Error).message}. Continuing...`);
      } finally {
        // Clear current claim after execution completes (success or failure)
        currentClaim = null;
      }
    } finally {
      if (cleanup) {
        await cleanup();
      }
    }
  }

}

