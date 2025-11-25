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

export async function runLocalAgent(rootActionId: string): Promise<void> {
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

  console.log(`🤖 ContextGraph Agent v${packageJson.version}`);
  console.log(`🎯 Starting local agent for action: ${rootActionId}\n`);

  let iterations = 0;
  const maxIterations = 100;

  while (iterations < maxIterations) {
    iterations++;
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Iteration ${iterations}`);
    console.log('='.repeat(80));

    const nextAction = await getNextAction(apiClient, rootActionId);

    if (!nextAction) {
      console.log('\n✅ No more actions to execute. Agent complete!');
      break;
    }

    const isPrepared = nextAction.prepared !== false;

    // Fetch full action details to get resolved_repository_url (tree API strips this field)
    const actionDetail = await apiClient.getActionDetail(nextAction.id);

    // Prepare workspace - repository URL is required
    const repoUrl = actionDetail.resolved_repository_url || actionDetail.repository_url;
    const branch = actionDetail.resolved_branch || actionDetail.branch;

    if (!repoUrl) {
      console.error(`\n❌ Action "${nextAction.title}" has no repository_url set.`);
      console.error(`   Actions must have a repository_url (directly or inherited from parent).`);
      console.error(`   Action ID: ${nextAction.id}`);
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
        console.log(`\n📋 Preparing action: ${nextAction.title} (${nextAction.id})`);
        await runPrepare(nextAction.id, { cwd: workspacePath });
        console.log('\n✅ Preparation complete. Moving to next iteration...');
        continue;
      }

      console.log(`\n🎯 Executing action: ${nextAction.title} (${nextAction.id})`);

      // actionDetail already fetched above for repo URL
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

      await runExecute(nextAction.id, { cwd: workspacePath });

      console.log('\n✅ Execution complete. Moving to next iteration...');
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

