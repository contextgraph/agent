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

export async function runLocalAgent(): Promise<void> {
  const apiClient = new ApiClient();

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

  let iterations = 0;
  const maxIterations = 100;

  while (iterations < maxIterations) {
    iterations++;
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Iteration ${iterations}`);
    console.log('='.repeat(80));

    // Claim next action from worker queue
    console.log('\n🔍 Claiming next action from queue...');
    const actionDetail = await apiClient.claimNextAction(workerId);

    if (!actionDetail) {
      console.log('💤 No work available');
      break;
    }

    console.log(`✅ Claimed action: ${actionDetail.title} (${actionDetail.id})`);

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
      console.log(`\n📂 Cloning ${repoUrl}${branch ? ` (branch: ${branch})` : ''}...`);
      const workspace = await prepareWorkspace(repoUrl, {
        branch: branch || undefined,
        authToken: credentials.clerkToken,
      });
      workspacePath = workspace.path;
      cleanup = workspace.cleanup;
      console.log(`📂 Working in: ${workspacePath}`);

      if (!isPrepared) {
        console.log(`\n📋 Preparing action: ${actionDetail.title} (${actionDetail.id})`);
        await runPrepare(actionDetail.id, { cwd: workspacePath });
        console.log('\n✅ Preparation complete. Moving to next iteration...');
        continue;
      }

      console.log(`\n🎯 Executing action: ${actionDetail.title} (${actionDetail.id})`);

      console.log(`\nAction context:`);
      console.log(`  Title: ${actionDetail.title}`);
      console.log(`  Description: ${actionDetail.description || 'N/A'}`);
      console.log(`  Vision: ${actionDetail.vision || 'N/A'}`);

      if (actionDetail.siblings && actionDetail.siblings.length > 0) {
        console.log(`\nSiblings (${actionDetail.siblings.length}):`);
        actionDetail.siblings.forEach((sibling) => {
          const status = sibling.done ? '✅' : '⏳';
          console.log(`  ${status} ${sibling.title}`);
        });
      }

      if (actionDetail.dependencies && actionDetail.dependencies.length > 0) {
        console.log(`\nDependencies (${actionDetail.dependencies.length}):`);
        actionDetail.dependencies.forEach((dep) => {
          const status = dep.done ? '✅' : '⏳';
          console.log(`  ${status} ${dep.title}`);
        });
      }

      if (actionDetail.children && actionDetail.children.length > 0) {
        console.log(`\nChildren (${actionDetail.children.length}):`);
        actionDetail.children.forEach((child) => {
          const status = child.done ? '✅' : '⏳';
          console.log(`  ${status} ${child.title}`);
        });
      }

      try {
        await runExecute(actionDetail.id, { cwd: workspacePath });

        console.log('\n✅ Execution complete');
        console.log('📝 Action completion handled by Claude SDK (via MCP tool)');
        console.log('🧹 Claim fields cleared automatically by backend');
        console.log('\n⏭️  Moving to next iteration...');
      } catch (executeError) {
        console.error('\n❌ Execution failed:', (executeError as Error).message);
        console.error('⚠️  Action may not be marked as complete. Manual intervention may be required.');
        console.log('\n⏭️  Continuing to next iteration...');
      }
    } finally {
      if (cleanup) {
        console.log('🧹 Cleaning up workspace...');
        await cleanup();
      }
    }
  }

  if (iterations >= maxIterations) {
    console.log(`\n⚠️  Reached maximum iterations (${maxIterations}). Stopping.`);
  }
}

