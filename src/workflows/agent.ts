import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ApiClient } from '../api-client.js';
import type { ActionNode } from '../types/actions.js';
import { findNextLeaf } from '../next-action.js';
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

async function getNextAction(
  apiClient: ApiClient,
  rootId: string
): Promise<ActionNode | null> {
  const tree = await apiClient.fetchTree(rootId, false);

  if (tree.done) {
    console.log('✅ Root action is already complete');
    return null;
  }

  // Use local findNextLeaf to traverse tree and find next action
  return findNextLeaf(tree);
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

    // Prepare workspace if action has a repository
    const repoUrl = nextAction.resolved_repository_url || nextAction.repository_url;
    const branch = nextAction.resolved_branch || nextAction.branch;

    let workspacePath = process.cwd();
    let cleanup: (() => Promise<void>) | undefined;

    try {
      if (repoUrl) {
        console.log(`\n📦 Cloning ${repoUrl}${branch ? ` (branch: ${branch})` : ''}...`);
        const workspace = await prepareWorkspace(repoUrl, {
          branch: branch || undefined,
          authToken: credentials.clerkToken,
        });
        workspacePath = workspace.path;
        cleanup = workspace.cleanup;
        console.log(`📂 Working in: ${workspacePath}`);
      }

      if (!isPrepared) {
        console.log(`\n📋 Preparing action: ${nextAction.title} (${nextAction.id})`);
        await runPrepare(nextAction.id, { cwd: workspacePath });
        console.log('\n✅ Preparation complete. Moving to next iteration...');
        continue;
      }

      console.log(`\n🎯 Executing action: ${nextAction.title} (${nextAction.id})`);

      const actionDetail = await apiClient.getActionDetail(nextAction.id);
      console.log(`\nAction context:`);
      console.log(`  Title: ${actionDetail.title}`);
      console.log(`  Description: ${actionDetail.description || 'N/A'}`);
      console.log(`  Vision: ${actionDetail.vision || 'N/A'}`);

      if (actionDetail.siblings && actionDetail.siblings.length > 0) {
        console.log(`\nSiblings (${actionDetail.siblings.length}):`);
        actionDetail.siblings.forEach((sibling: { done: boolean; title: string }) => {
          const status = sibling.done ? '✅' : '⏳';
          console.log(`  ${status} ${sibling.title}`);
        });
      }

      if (actionDetail.dependencies && actionDetail.dependencies.length > 0) {
        console.log(`\nDependencies (${actionDetail.dependencies.length}):`);
        actionDetail.dependencies.forEach((dep: { done: boolean; title: string }) => {
          const status = dep.done ? '✅' : '⏳';
          console.log(`  ${status} ${dep.title}`);
        });
      }

      if (actionDetail.children && actionDetail.children.length > 0) {
        console.log(`\nChildren (${actionDetail.children.length}):`);
        actionDetail.children.forEach((child: { done: boolean; title: string }) => {
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

