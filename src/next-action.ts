import type { ActionNode } from './types/actions.js';

type TreeNode = ActionNode & {
  children?: TreeNode[];
  prepared?: boolean;
  hasChildren?: boolean; // True if action has children beyond max depth limit
};

export type FindNextLeafResult = {
  action: ActionNode | null;
  truncatedAt?: string; // ID of action with children beyond depth limit
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
 * Handles truncated trees where hasChildren=true but children array is empty due to depth limits.
 *
 * @param node - Root node of the subtree to search
 * @returns Result containing next action to work on, or truncatedAt ID if children were beyond depth limit
 */
export function findNextLeaf(node: TreeNode): FindNextLeafResult {
  // Skip completed actions
  if (node.done) {
    return { action: null };
  }

  // Skip actions blocked by incomplete dependencies
  if (isBlockedByDependencies(node)) {
    return { action: null };
  }

  // Check if this node has children - either loaded in array OR indicated by hasChildren flag
  // The hasChildren flag is set when children exist but weren't loaded due to depth limits
  const loadedChildrenCount = node.children?.length ?? 0;
  const hasChildren = loadedChildrenCount > 0 || node.hasChildren === true;

  // If node has children but has explicitly prepared=false, return it for preparation
  // (Parent must be prepared before we can work on children)
  // Note: undefined/missing prepared field allows descending (backward compat)
  if (hasChildren && node.prepared === false) {
    return { action: node };
  }

  // Handle truncated tree case: hasChildren=true but children array is empty
  // This means children exist but weren't loaded due to depth limits
  // Return the truncatedAt ID so the caller can re-fetch with this action as root
  if (node.hasChildren === true && loadedChildrenCount === 0) {
    return { action: null, truncatedAt: node.id };
  }

  // Check if this node has any non-done children (prepared or unprepared)
  const hasNonDoneChildren = node.children?.some(
    child => !child.done
  ) ?? false;

  // If no non-done children, this is a leaf - return it (whether prepared or not)
  if (!hasNonDoneChildren) {
    return { action: node };
  }

  // Parent has non-done children - recurse into children (depth-first)
  for (const child of node.children || []) {
    const result = findNextLeaf(child);
    // If we found an action or hit a truncation point, return it
    if (result.action || result.truncatedAt) {
      return result;
    }
  }

  return { action: null };
}

/**
 * Get next action to work on from MCP server
 */
export async function getNextAction(
  mcpClient: unknown,
  rootActionId: string
): Promise<FindNextLeafResult> {
  // Fetch the subtree from MCP
  const tree = await (mcpClient as { fetch_tree: (options: { root_id: string; include_completed: boolean; max_depth: number }) => Promise<TreeNode> }).fetch_tree({
    root_id: rootActionId,
    include_completed: false,
    max_depth: 10 // Reasonable default
  });

  // Find next leaf using depth-first traversal
  return findNextLeaf(tree);
}
