import type { ActionNode } from './types/actions.js';

type TreeNode = ActionNode & {
  children?: TreeNode[];
  prepared?: boolean;
};

/**
 * Check if an action is blocked by incomplete dependencies.
 * An action is blocked if it has any dependencies that are not done.
 *
 * @param node - The action node to check
 * @returns true if the action has incomplete dependencies, false otherwise
 */
function isBlockedByDependencies(node: TreeNode): boolean {
  return (node.dependencies || []).some(dep => !dep.done);
}

/**
 * Find the next leaf action to work on in a subtree using depth-first traversal.
 * Returns unprepared actions (for preparation) or prepared actions (for execution).
 * Respects dependency constraints - will not return actions blocked by incomplete dependencies.
 * Enforces parent preparation - children are only considered if parent is prepared.
 *
 * @param node - Root node of the subtree to search
 * @returns Next action to work on (unprepared for prep, prepared for exec), or null if subtree is complete or all leaves are blocked
 */
export function findNextLeaf(node: TreeNode): ActionNode | null {
  // Skip completed actions
  if (node.done) {
    return null;
  }

  // Skip actions blocked by incomplete dependencies
  if (isBlockedByDependencies(node)) {
    return null;
  }

  // Check if this node has children
  const hasChildren = (node.children?.length ?? 0) > 0;

  // If node has children but has explicitly prepared=false, return it for preparation
  // (Parent must be prepared before we can work on children)
  // Note: undefined/missing prepared field allows descending (backward compat)
  if (hasChildren && node.prepared === false) {
    return node;
  }

  // Check if this node has any non-done children (prepared or unprepared)
  const hasNonDoneChildren = node.children?.some(
    child => !child.done
  ) ?? false;

  // If no non-done children, this is a leaf - return it (whether prepared or not)
  if (!hasNonDoneChildren) {
    return node;
  }

  // Parent has non-done children - recurse into children (depth-first)
  for (const child of node.children || []) {
    const result = findNextLeaf(child);
    if (result) return result;
  }

  return null;
}

/**
 * Get next action to work on from MCP server
 */
export async function getNextAction(
  mcpClient: unknown,
  rootActionId: string
): Promise<ActionNode | null> {
  // Fetch the subtree from MCP
  const tree = await (mcpClient as { fetch_tree: (options: { root_id: string; include_completed: boolean; max_depth: number }) => Promise<TreeNode> }).fetch_tree({
    root_id: rootActionId,
    include_completed: false,
    max_depth: 10 // Reasonable default
  });

  // Find next leaf using depth-first traversal
  return findNextLeaf(tree);
}
