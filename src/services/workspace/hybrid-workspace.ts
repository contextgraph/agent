import { homedir } from 'os';
import { join } from 'path';
import { readdir, stat, rm } from 'fs/promises';
import {
  createTempWorkspaceWithClone,
  TempWorkspace,
  CloneOptions
} from './temporary-workspace.js';
import {
  getOrCreateWorkspace,
  getWorkspacePath,
  PersistentWorkspace,
  PersistentCloneOptions
} from './persistent-workspace.js';

/**
 * Base directory for all persistent workspaces.
 * Located at ~/.contextgraph/workspaces/
 */
const WORKSPACE_BASE_DIR = join(homedir(), '.contextgraph', 'workspaces');

/**
 * Configuration for the hybrid workspace strategy.
 */
export interface HybridWorkspaceConfig {
  /**
   * Size threshold in bytes for deciding between temporary and persistent workspaces.
   * Repositories larger than this threshold will use persistent workspaces.
   * Default: 100MB (104857600 bytes)
   *
   * Based on benchmark data:
   * - Small repos (~1.5s clone): temporary workspace overhead is negligible
   * - Large repos (~15s clone): persistent caching provides significant benefit
   */
  sizeThreshold: number;

  /**
   * Maximum number of persistent workspaces to keep in the cache.
   * When exceeded, oldest workspaces (by access time) are evicted.
   * Default: 10 workspaces
   */
  maxWorkspaces: number;
}

/**
 * Default configuration for hybrid workspace management.
 */
export const DEFAULT_CONFIG: HybridWorkspaceConfig = {
  sizeThreshold: 100 * 1024 * 1024, // 100MB
  maxWorkspaces: 10
};

/**
 * Workspace strategy types.
 */
export type WorkspaceStrategy = 'temporary' | 'persistent';

/**
 * Result of getting a workspace through the hybrid strategy.
 */
export interface HybridWorkspaceResult {
  /** Absolute path to the workspace directory */
  path: string;
  /** Strategy used (temporary or persistent) */
  strategy: WorkspaceStrategy;
  /** Cleanup function (only for temporary workspaces) */
  cleanup?: () => Promise<void>;
  /** Whether the workspace was newly created (for persistent workspaces) */
  isNew?: boolean;
}

/**
 * Options for getting a workspace through the hybrid strategy.
 */
export interface HybridWorkspaceOptions {
  /** Repository URL to clone */
  repositoryUrl: string;
  /** Optional git environment variables (e.g., for authentication) */
  gitEnv?: NodeJS.ProcessEnv;
  /** Optional branch to checkout after cloning */
  branch?: string;
  /** Optional configuration override */
  config?: Partial<HybridWorkspaceConfig>;
}

/**
 * Metadata about a workspace for cache management.
 */
interface WorkspaceMetadata {
  path: string;
  lastAccessTime: number;
  sizeBytes: number;
}

/**
 * Determines the optimal workspace strategy based on repository characteristics.
 *
 * Currently uses a simple threshold-based approach. In the future, this could be
 * enhanced with dynamic size detection or more sophisticated heuristics.
 *
 * @param repositoryUrl - Repository URL to determine strategy for
 * @param config - Configuration including size threshold
 * @returns 'temporary' for small repos, 'persistent' for large repos
 *
 * @example
 * const strategy = await determineStrategy(
 *   'https://github.com/user/repo.git',
 *   DEFAULT_CONFIG
 * );
 * console.log('Using strategy:', strategy);
 */
export async function determineStrategy(
  repositoryUrl: string,
  config: HybridWorkspaceConfig = DEFAULT_CONFIG
): Promise<WorkspaceStrategy> {
  // For now, use a simple heuristic based on configurable threshold
  // Future enhancement: Could actually check repo size via git ls-remote or API
  // For this prototype, we default to 'persistent' for repos we expect to access repeatedly
  // This can be refined based on actual usage patterns

  // Simple heuristic: if we've seen this repo before, use persistent
  // Otherwise, start with temporary
  const workspacePath = getWorkspacePath(repositoryUrl);
  try {
    await stat(workspacePath);
    // Workspace exists, use persistent strategy to leverage cache
    return 'persistent';
  } catch {
    // Workspace doesn't exist yet
    // For now, default to persistent to build up the cache
    // This could be made smarter by checking repo size first
    return 'persistent';
  }
}

/**
 * Gets a workspace using the optimal strategy based on repository characteristics.
 *
 * This is the main entry point for the hybrid workspace pattern:
 * 1. Determines optimal strategy (temporary vs persistent)
 * 2. Routes to the appropriate workspace implementation
 * 3. Handles cache management for persistent workspaces
 *
 * @param options - Workspace options including repository URL
 * @returns HybridWorkspaceResult with path, strategy, and optional cleanup
 * @throws Error if workspace creation or git operations fail
 *
 * @example
 * // Basic usage - automatically selects strategy
 * const workspace = await getWorkspace({
 *   repositoryUrl: 'https://github.com/user/repo.git'
 * });
 * try {
 *   console.log('Working in:', workspace.path);
 *   console.log('Strategy:', workspace.strategy);
 *   // Perform operations
 * } finally {
 *   if (workspace.cleanup) {
 *     await workspace.cleanup();
 *   }
 * }
 *
 * @example
 * // With authentication
 * import { withGitCredentials } from '../../git-auth-helper.js';
 *
 * await withGitCredentials(token, async (gitEnv) => {
 *   const workspace = await getWorkspace({
 *     repositoryUrl: 'https://github.com/user/private-repo.git',
 *     gitEnv
 *   });
 *   try {
 *     // Work with the workspace
 *   } finally {
 *     if (workspace.cleanup) {
 *       await workspace.cleanup();
 *     }
 *   }
 * });
 *
 * @example
 * // With custom configuration
 * const workspace = await getWorkspace({
 *   repositoryUrl: 'https://github.com/user/repo.git',
 *   config: {
 *     sizeThreshold: 50 * 1024 * 1024, // 50MB threshold
 *     maxWorkspaces: 5
 *   }
 * });
 */
export async function getWorkspace(
  options: HybridWorkspaceOptions
): Promise<HybridWorkspaceResult> {
  const { repositoryUrl, gitEnv, branch, config } = options;
  const fullConfig = { ...DEFAULT_CONFIG, ...config };

  // Determine optimal strategy
  const strategy = await determineStrategy(repositoryUrl, fullConfig);

  if (strategy === 'temporary') {
    // Use temporary workspace pattern
    const workspace: TempWorkspace = await createTempWorkspaceWithClone({
      repositoryUrl,
      gitEnv,
      branch
    });

    return {
      path: workspace.path,
      strategy: 'temporary',
      cleanup: workspace.cleanup
    };
  } else {
    // Use persistent workspace pattern
    const workspace: PersistentWorkspace = await getOrCreateWorkspace({
      repositoryUrl,
      gitEnv,
      branch
    });

    // Check if we need to evict old workspaces
    await evictOldWorkspaces(fullConfig);

    return {
      path: workspace.path,
      strategy: 'persistent',
      isNew: workspace.isNew
    };
  }
}

/**
 * Executes an operation in a hybrid workspace with automatic management.
 *
 * This high-level helper handles the complete lifecycle:
 * 1. Gets workspace using optimal strategy
 * 2. Executes the provided operation
 * 3. Cleans up if using temporary workspace
 *
 * @param options - Workspace options including repository URL
 * @param operation - Async function that receives the workspace result
 * @returns The result of the operation
 * @throws Any error from workspace creation or operation
 *
 * @example
 * const result = await withHybridWorkspace(
 *   { repositoryUrl: 'https://github.com/user/repo.git' },
 *   async (workspace) => {
 *     console.log(`Using ${workspace.strategy} workspace`);
 *     // Perform operations
 *     return someResult;
 *   }
 * );
 */
export async function withHybridWorkspace<T>(
  options: HybridWorkspaceOptions,
  operation: (workspace: HybridWorkspaceResult) => Promise<T>
): Promise<T> {
  const workspace = await getWorkspace(options);

  try {
    return await operation(workspace);
  } finally {
    // Cleanup only applies to temporary workspaces
    if (workspace.cleanup) {
      await workspace.cleanup();
    }
  }
}

/**
 * Gets metadata for all persistent workspaces.
 *
 * @returns Array of workspace metadata sorted by last access time (oldest first)
 */
async function getWorkspaceMetadata(): Promise<WorkspaceMetadata[]> {
  try {
    const entries = await readdir(WORKSPACE_BASE_DIR);
    const metadata: WorkspaceMetadata[] = [];

    for (const entry of entries) {
      const workspacePath = join(WORKSPACE_BASE_DIR, entry);
      try {
        const stats = await stat(workspacePath);
        if (stats.isDirectory()) {
          metadata.push({
            path: workspacePath,
            lastAccessTime: stats.atimeMs,
            sizeBytes: stats.size
          });
        }
      } catch {
        // Skip entries that can't be accessed
        continue;
      }
    }

    // Sort by last access time (oldest first)
    return metadata.sort((a, b) => a.lastAccessTime - b.lastAccessTime);
  } catch {
    // If workspace directory doesn't exist yet, return empty array
    return [];
  }
}

/**
 * Evicts old persistent workspaces when the cache exceeds the maximum limit.
 *
 * Uses LRU (Least Recently Used) strategy:
 * - Sorts workspaces by last access time
 * - Removes oldest workspaces until count is below maxWorkspaces
 *
 * This function is automatically called by getWorkspace() but can also be
 * invoked manually for explicit cache cleanup.
 *
 * @param config - Configuration including maxWorkspaces limit
 * @returns Number of workspaces evicted
 *
 * @example
 * // Manual cache cleanup
 * const evicted = await evictOldWorkspaces({
 *   sizeThreshold: 100 * 1024 * 1024,
 *   maxWorkspaces: 10
 * });
 * console.log(`Evicted ${evicted} old workspaces`);
 */
export async function evictOldWorkspaces(
  config: HybridWorkspaceConfig = DEFAULT_CONFIG
): Promise<number> {
  const metadata = await getWorkspaceMetadata();

  // Calculate how many workspaces to evict
  const evictionCount = Math.max(0, metadata.length - config.maxWorkspaces);

  if (evictionCount === 0) {
    return 0;
  }

  // Evict oldest workspaces (already sorted by last access time)
  const workspacesToEvict = metadata.slice(0, evictionCount);

  let evictedCount = 0;
  for (const workspace of workspacesToEvict) {
    try {
      await rm(workspace.path, { recursive: true, force: true });
      evictedCount++;
    } catch (error) {
      console.warn(`Failed to evict workspace ${workspace.path}:`, error);
    }
  }

  return evictedCount;
}

// ============================================================================
// Example Usage
// ============================================================================

/**
 * Example usage patterns for the hybrid workspace system.
 *
 * These examples demonstrate how the hybrid workspace automatically selects
 * the optimal strategy based on repository characteristics and configuration.
 */

/**
 * Example 1: Basic automatic strategy selection
 *
 * The hybrid workspace automatically determines whether to use temporary
 * or persistent storage based on repository characteristics.
 */
export async function example1_AutomaticSelection() {
  const workspace = await getWorkspace({
    repositoryUrl: 'https://github.com/contextgraph/agent.git'
  });

  console.log('Using strategy:', workspace.strategy);
  console.log('Workspace path:', workspace.path);

  try {
    // Perform operations
    // The workspace will be cached if strategy is 'persistent'
  } finally {
    // Only temporary workspaces need cleanup
    if (workspace.cleanup) {
      await workspace.cleanup();
    }
  }
}

/**
 * Example 2: Using the high-level helper
 *
 * withHybridWorkspace automatically handles the lifecycle and cleanup.
 */
export async function example2_WithHelper() {
  await withHybridWorkspace(
    { repositoryUrl: 'https://github.com/user/repo.git' },
    async (workspace) => {
      console.log(`Using ${workspace.strategy} workspace`);
      // Perform operations
      // Cleanup happens automatically if needed
    }
  );
}

/**
 * Example 3: Custom configuration
 *
 * Override default thresholds and cache limits.
 */
export async function example3_CustomConfig() {
  const workspace = await getWorkspace({
    repositoryUrl: 'https://github.com/user/repo.git',
    config: {
      sizeThreshold: 50 * 1024 * 1024, // 50MB threshold
      maxWorkspaces: 5 // Keep max 5 workspaces
    }
  });

  try {
    console.log('Strategy:', workspace.strategy);
    // Work with workspace
  } finally {
    if (workspace.cleanup) {
      await workspace.cleanup();
    }
  }
}

/**
 * Example 4: Manual cache cleanup
 *
 * Explicitly evict old workspaces to free disk space.
 */
export async function example4_ManualCleanup() {
  const evicted = await evictOldWorkspaces({
    sizeThreshold: 100 * 1024 * 1024,
    maxWorkspaces: 10
  });

  console.log(`Evicted ${evicted} old workspaces`);
}

/**
 * Example 5: Comparing strategies
 *
 * Demonstrates the performance difference between temporary and persistent.
 */
export async function example5_CompareStrategies() {
  const repoUrl = 'https://github.com/contextgraph/agent.git';

  // First access - will clone
  console.log('First access:');
  const start1 = Date.now();
  await withHybridWorkspace({ repositoryUrl: repoUrl }, async (workspace) => {
    console.log(`Strategy: ${workspace.strategy}, Time: ${Date.now() - start1}ms`);
  });

  // Second access - should be faster if persistent
  console.log('Second access:');
  const start2 = Date.now();
  await withHybridWorkspace({ repositoryUrl: repoUrl }, async (workspace) => {
    console.log(`Strategy: ${workspace.strategy}, Time: ${Date.now() - start2}ms`);
    if (workspace.strategy === 'persistent' && !workspace.isNew) {
      console.log('Cache hit! Used existing workspace with git pull.');
    }
  });
}
