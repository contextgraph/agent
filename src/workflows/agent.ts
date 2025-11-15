import { ApiClient } from '../api-client.js';
import type { ActionNode } from '../types/actions.js';
import { runPrepare } from './prepare.js';
import { runExecute } from './execute.js';

function hasIncompleteChildren(node: ActionNode): boolean {
  if (!node.children || node.children.length === 0) {
    return false;
  }

  return node.children.some((child) => {
    if (!child.done) {
      return true;
    }
    return hasIncompleteChildren(child);
  });
}

async function getNextAction(
  apiClient: ApiClient,
  rootId: string
): Promise<ActionNode | null> {
  const tree = await apiClient.fetchTree(rootId, false);

  if (tree.done) {
    console.log('✅ Root action is already complete');
    return null;
  }

  if (hasIncompleteChildren(tree)) {
    const nextAction = await apiClient.findNextLeaf(rootId);
    return nextAction;
  }

  return tree;
}

export async function runLocalAgent(rootActionId: string): Promise<void> {
  const apiClient = new ApiClient();

  console.log(`🤖 Starting local agent for action: ${rootActionId}\n`);

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

    if (!isPrepared) {
      console.log(`\n📋 Preparing action: ${nextAction.title} (${nextAction.id})`);
      await runPrepare(nextAction.id);
      console.log('\n✅ Preparation complete. Moving to next iteration...');
      continue;
    }

    console.log(`\n🎯 Executing action: ${nextAction.title} (${nextAction.id})`);

    const actionDetail = await apiClient.getActionDetail(nextAction.id);
    console.log(`\nAction context:`);
    console.log(`  Title: ${actionDetail.title}`);
    console.log(`  Description: ${actionDetail.description || 'N/A'}`);
    console.log(`  Vision: ${actionDetail.vision || 'N/A'}`);

    if (actionDetail.relationships) {
      if (actionDetail.relationships.siblings && actionDetail.relationships.siblings.length > 0) {
        console.log(`\nSiblings (${actionDetail.relationships.siblings.length}):`);
        actionDetail.relationships.siblings.forEach((sibling) => {
          const status = sibling.done ? '✅' : '⏳';
          console.log(`  ${status} ${sibling.title}`);
        });
      }

      if (actionDetail.relationships.dependencies && actionDetail.relationships.dependencies.length > 0) {
        console.log(`\nDependencies (${actionDetail.relationships.dependencies.length}):`);
        actionDetail.relationships.dependencies.forEach((dep) => {
          const status = dep.done ? '✅' : '⏳';
          console.log(`  ${status} ${dep.title}`);
        });
      }

      if (actionDetail.relationships.children && actionDetail.relationships.children.length > 0) {
        console.log(`\nChildren (${actionDetail.relationships.children.length}):`);
        actionDetail.relationships.children.forEach((child) => {
          const status = child.done ? '✅' : '⏳';
          console.log(`  ${status} ${child.title}`);
        });
      }
    }

    await runExecute(nextAction.id);

    console.log('\n✅ Execution complete. Moving to next iteration...');
  }

  if (iterations >= maxIterations) {
    console.log(`\n⚠️  Reached maximum iterations (${maxIterations}). Stopping.`);
  }
}

