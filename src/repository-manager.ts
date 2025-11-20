/**
 * Repository Manager - Unified API for Git Operations and Workspace Management
 *
 * This module provides a comprehensive API for working with git repositories, including:
 * - Core git operations (clone, checkout, branch validation)
 * - Repository URL utilities (parsing, validation, normalization)
 * - Workspace lifecycle management (prepare, cleanup)
 * - Integrated cleanup strategies (immediate, deferred, background)
 *
 * ## Architecture
 *
 * The repository manager follows a modular architecture with clear separation of concerns:
 * - `git-operations.ts`: Core git commands (clone, checkout, validate)
 * - `utils.ts`: URL parsing and validation utilities
 * - `workspace-integration.ts`: Workspace preparation and retrieval
 * - `cleanup.ts`: Cleanup operations with flexible timing strategies
 *
 * ## Workspace Strategy
 *
 * This module implements the workspace strategy recommendations from the spike analysis:
 * - Persistent workspaces in `~/.contextgraph/workspaces/`
 * - LRU eviction policy for automatic cleanup
 * - Deferred cleanup by default for better developer experience
 * - Preservation of failed workspaces for debugging
 *
 * For detailed strategy rationale, see: docs/spikes/workspace-strategy.md
 *
 * @module repository-manager
 */

// Re-export git operations
export {
  cloneRepository,
  checkoutBranch,
  validateBranch,
} from './services/repository/git-operations.js';

// Re-export repository utilities
export {
  isGitRepository,
  extractRepoInfo,
  normalizeRepoUrl,
} from './services/repository/utils.js';

// Re-export types from utilities
export type { GitProtocol, RepoInfo } from './services/repository/utils.js';

// Re-export workspace integration
export {
  prepareWorkspace,
  getWorkspaceForRepository,
} from './services/repository/workspace-integration.js';

// Re-export cleanup operations
export {
  cleanupWorkspace,
  cleanupAllWorkspaces,
  getCleanupTiming,
  setCleanupTiming,
} from './services/repository/cleanup.js';

// Re-export types from cleanup
export type {
  CleanupTiming,
  CleanupOptions,
} from './services/repository/cleanup.js';

// Re-export GitCredentials type from actions types
export type { GitCredentials } from './types/actions.js';

/**
 * Result of preparing a repository workspace with cleanup lifecycle.
 */
export interface WorkspaceResult {
  /** Absolute path to the workspace directory */
  workspacePath: string;
  /** Cleanup function to call when done with the workspace */
  cleanup: () => Promise<void>;
}

/**
 * Prepares a repository workspace with integrated cleanup lifecycle.
 *
 * This is a convenience wrapper that combines `prepareWorkspace()` with automatic
 * cleanup functionality. It returns both the workspace path and a cleanup function
 * that should be called when you're done with the workspace.
 *
 * ## Cleanup Strategy
 *
 * By default, cleanup uses the 'deferred' timing strategy, which:
 * - Returns immediately without blocking
 * - Performs cleanup asynchronously in the background
 * - Provides better developer experience for interactive workflows
 *
 * You can customize the cleanup behavior by passing a `CleanupOptions` object.
 *
 * ## Usage Patterns
 *
 * ### Basic Usage (Recommended)
 * ```typescript
 * const { workspacePath, cleanup } = await prepareRepositoryWorkspace(
 *   'https://github.com/user/repo.git'
 * );
 *
 * try {
 *   // Do work in the workspace
 *   await runTests(workspacePath);
 * } finally {
 *   // Clean up when done
 *   await cleanup();
 * }
 * ```
 *
 * ### With Branch Selection
 * ```typescript
 * const { workspacePath, cleanup } = await prepareRepositoryWorkspace(
 *   'https://github.com/user/repo.git',
 *   'feature/new-feature'
 * );
 * ```
 *
 * ### With Authentication
 * ```typescript
 * const { workspacePath, cleanup } = await prepareRepositoryWorkspace(
 *   'https://github.com/user/private-repo.git',
 *   'main',
 *   { githubToken: 'ghp_...', provider: 'github', acquiredAt: '...', source: 'manual' }
 * );
 * ```
 *
 * ### With Custom Cleanup Options
 * ```typescript
 * const { workspacePath, cleanup } = await prepareRepositoryWorkspace(
 *   'https://github.com/user/repo.git',
 *   'main',
 *   undefined,
 *   {
 *     timing: 'immediate',  // Block until cleanup completes
 *     preserveOnError: true // Keep workspace if errors occur
 *   }
 * );
 * ```
 *
 * ### No Repository (Use Current Directory)
 * ```typescript
 * const { workspacePath, cleanup } = await prepareRepositoryWorkspace();
 * console.log(workspacePath); // Current working directory
 * ```
 *
 * @param repositoryUrl - Optional repository URL to clone/fetch
 * @param branch - Optional branch to checkout
 * @param credentials - Optional git credentials for authentication
 * @param cleanupOptions - Optional cleanup configuration
 * @returns Object with workspace path and cleanup function
 *
 * @example
 * // Typical workflow with error handling
 * const { workspacePath, cleanup } = await prepareRepositoryWorkspace(
 *   'https://github.com/user/repo.git',
 *   'main'
 * );
 *
 * try {
 *   // Execute operations in the workspace
 *   const result = await buildProject(workspacePath);
 *   console.log('Build succeeded:', result);
 * } catch (error) {
 *   console.error('Build failed:', error);
 *   throw error;
 * } finally {
 *   // Always clean up, even if operations fail
 *   await cleanup();
 * }
 */
export async function prepareRepositoryWorkspace(
  repositoryUrl?: string | null,
  branch?: string,
  credentials?: import('./types/actions.js').GitCredentials,
  cleanupOptions?: import('./services/repository/cleanup.js').CleanupOptions
): Promise<WorkspaceResult> {
  // Import dependencies
  const { prepareWorkspace } = await import('./services/repository/workspace-integration.js');
  const { cleanupWorkspace } = await import('./services/repository/cleanup.js');

  // Prepare the workspace
  const workspacePath = await prepareWorkspace(repositoryUrl, branch, credentials);

  // Create cleanup function that wraps cleanupWorkspace
  const cleanup = async () => {
    await cleanupWorkspace(workspacePath, cleanupOptions);
  };

  return {
    workspacePath,
    cleanup,
  };
}
