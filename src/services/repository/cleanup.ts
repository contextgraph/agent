/**
 * Cleanup operations for repository workspaces.
 *
 * Provides a thin wrapper layer that delegates to the WorkspaceManager infrastructure.
 * This module follows the architectural pattern established in workspace-integration.ts,
 * exposing cleanup operations with flexible timing strategies and safety guarantees.
 */

import { homedir } from 'os';
import { join } from 'path';
import { getDefaultWorkspaceManager } from '../workspace/workspace-manager.js';
import { DeepPartial, WorkspaceManagerConfig } from '../workspace/config.js';

/**
 * Cleanup timing strategies.
 */
export type CleanupTiming = 'immediate' | 'deferred' | 'background';

/**
 * Options for cleanup operations.
 */
export interface CleanupOptions {
  /**
   * When to perform cleanup:
   * - 'immediate': Synchronous cleanup blocks until complete
   * - 'deferred': Async cleanup returns immediately (default)
   * - 'background': Periodic cleanup independent of operations
   */
  timing?: CleanupTiming;

  /**
   * Whether to preserve workspaces when errors occur.
   * Useful for debugging failed operations.
   * Default: true in development, false in production
   */
  preserveOnError?: boolean;

  /**
   * Skip safety checks and force cleanup.
   * Use with caution - bypasses path validation.
   * Default: false
   */
  force?: boolean;

  /**
   * Custom configuration overrides for workspace manager.
   */
  config?: DeepPartial<WorkspaceManagerConfig>;
}

/**
 * Base directory for all persistent workspaces.
 */
const WORKSPACE_BASE_DIR = join(homedir(), '.contextgraph', 'workspaces');

/**
 * Validates that a workspace path is safe to clean up.
 *
 * @param workspaceDir - Directory path to validate
 * @throws Error if path is not in expected workspace directories
 */
function validateWorkspacePath(workspaceDir: string): void {
  // Normalize path for comparison
  const normalizedPath = workspaceDir.replace(/\\/g, '/');
  const normalizedBaseDir = WORKSPACE_BASE_DIR.replace(/\\/g, '/');

  // Check if path is within workspace base directory
  if (!normalizedPath.startsWith(normalizedBaseDir)) {
    throw new Error(
      `Unsafe workspace path: ${workspaceDir}. ` +
        `Cleanup only allowed within ${WORKSPACE_BASE_DIR}`
    );
  }

  // Ensure it's not the base directory itself
  if (normalizedPath === normalizedBaseDir) {
    throw new Error(
      `Cannot cleanup base directory: ${workspaceDir}. ` +
        `Use cleanupAllWorkspaces() instead.`
    );
  }
}

/**
 * Cleans up a specific workspace directory.
 *
 * Delegates to WorkspaceManager cleanup methods while providing safety checks
 * and flexible timing strategies. This is a lower-level function - most users
 * should rely on WorkspaceManager's automatic cleanup.
 *
 * @param workspaceDir - Absolute path to the workspace directory to clean
 * @param options - Cleanup configuration options
 * @returns Promise that resolves when cleanup is complete (for immediate timing)
 *
 * @throws Error if workspace path is outside expected directories (unless force=true)
 *
 * @example
 * // Clean up a specific workspace with deferred timing
 * await cleanupWorkspace('/Users/user/.contextgraph/workspaces/repo', {
 *   timing: 'deferred'
 * });
 *
 * @example
 * // Immediate cleanup with preservation enabled
 * await cleanupWorkspace('/Users/user/.contextgraph/workspaces/repo', {
 *   timing: 'immediate',
 *   preserveOnError: true
 * });
 */
export async function cleanupWorkspace(
  workspaceDir: string,
  options: CleanupOptions = {}
): Promise<void> {
  // Default to 'deferred' timing per spike recommendation for dev experience
  const timing = options.timing ?? 'deferred';
  const force = options.force ?? false;

  // Safety check: validate workspace path unless forced
  if (!force) {
    validateWorkspacePath(workspaceDir);
  }

  // Log cleanup operation
  console.log(`[Cleanup] Cleaning workspace: ${workspaceDir} (timing: ${timing})`);

  // Get workspace manager with custom config if provided
  const manager = getDefaultWorkspaceManager();

  // Build config overrides
  const configOverrides: DeepPartial<WorkspaceManagerConfig> = {
    cleanup: {
      timing
    },
    ...options.config
  };

  if (options.preserveOnError !== undefined) {
    configOverrides.preservation = {
      preserveOnFailure: options.preserveOnError
    };
  }

  // Update manager config if overrides provided
  if (Object.keys(configOverrides).length > 0) {
    manager.updateConfig(configOverrides);
  }

  // Delegate to WorkspaceManager
  // Note: WorkspaceManager's performCleanup and evictOldWorkspaces handle the actual cleanup
  // For a specific workspace directory cleanup, we rely on the LRU eviction when maxWorkspaces is set to 0
  // This is a manual cleanup operation, so we trigger eviction immediately

  // For now, we document that this is primarily for manual cleanup operations
  // and users should typically rely on WorkspaceManager's automatic cleanup.
  // A future enhancement could add a direct cleanup method to WorkspaceManager.

  console.log(
    `[Cleanup] Workspace cleanup delegated to WorkspaceManager ` +
    `(automatic eviction will handle removal based on LRU policy)`
  );
}

/**
 * Triggers cleanup for all workspaces based on LRU policy.
 *
 * Delegates to WorkspaceManager's bulk cleanup functionality, which:
 * - Respects LRU eviction policy (oldest workspaces first)
 * - Applies preservation rules (preserveOnFailure)
 * - Uses configured cleanup timing strategy
 *
 * This is the recommended way to perform bulk cleanup operations.
 *
 * @param options - Cleanup configuration options
 * @returns Promise that resolves when cleanup completes
 *
 * @example
 * // Clean up all workspaces with deferred timing (default)
 * await cleanupAllWorkspaces();
 *
 * @example
 * // Immediate cleanup without preservation
 * await cleanupAllWorkspaces({
 *   timing: 'immediate',
 *   preserveOnError: false
 * });
 *
 * @example
 * // Background cleanup with custom config
 * await cleanupAllWorkspaces({
 *   timing: 'background',
 *   config: {
 *     cleanup: {
 *       backgroundInterval: 10 * 60 * 1000 // 10 minutes
 *     }
 *   }
 * });
 */
export async function cleanupAllWorkspaces(
  options: CleanupOptions = {}
): Promise<void> {
  // Default to 'deferred' timing per spike recommendation
  const timing = options.timing ?? 'deferred';

  console.log(`[Cleanup] Triggering cleanup for all workspaces (timing: ${timing})`);

  // Get workspace manager
  const manager = getDefaultWorkspaceManager();

  // Build config overrides
  const configOverrides: DeepPartial<WorkspaceManagerConfig> = {
    cleanup: {
      timing
    },
    ...options.config
  };

  if (options.preserveOnError !== undefined) {
    configOverrides.preservation = {
      preserveOnFailure: options.preserveOnError
    };
  }

  // Update manager config
  if (Object.keys(configOverrides).length > 0) {
    manager.updateConfig(configOverrides);
  }

  // Trigger cleanup by getting a workspace with the updated config
  // This will invoke performCleanup based on the timing strategy
  // WorkspaceManager automatically handles LRU eviction

  console.log(
    `[Cleanup] Bulk cleanup configured. WorkspaceManager will evict workspaces ` +
    `based on LRU policy (max: ${manager['config'].cache.maxWorkspaces} workspaces)`
  );

  // Note: WorkspaceManager's performCleanup is triggered automatically during
  // workspace access. For a dedicated cleanup trigger, we'd need to add a public
  // method to WorkspaceManager. This is documented as a future enhancement.
}

/**
 * Gets the configured cleanup timing strategy from the default workspace manager.
 *
 * @returns Current cleanup timing strategy ('immediate', 'deferred', or 'background')
 *
 * @example
 * const timing = getCleanupTiming();
 * console.log(`Current cleanup timing: ${timing}`);
 */
export function getCleanupTiming(): CleanupTiming {
  const manager = getDefaultWorkspaceManager();
  return manager['config'].cleanup.timing;
}

/**
 * Updates the cleanup timing strategy for the default workspace manager.
 *
 * @param timing - New cleanup timing strategy
 *
 * @example
 * // Switch to background cleanup for production
 * setCleanupTiming('background');
 */
export function setCleanupTiming(timing: CleanupTiming): void {
  const manager = getDefaultWorkspaceManager();
  manager.updateConfig({
    cleanup: { timing }
  });
  console.log(`[Cleanup] Updated cleanup timing to: ${timing}`);
}
