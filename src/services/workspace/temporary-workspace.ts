import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Represents a temporary workspace for repository operations.
 * The workspace is automatically cleaned up when disposed.
 */
export interface TempWorkspace {
  /** Absolute path to the temporary workspace directory */
  path: string;
  /** Cleanup function that removes the workspace directory */
  cleanup: () => Promise<void>;
}

/**
 * Options for creating a temporary workspace with a cloned repository.
 */
export interface CloneOptions {
  /** Repository URL to clone (e.g., 'https://github.com/user/repo.git') */
  repositoryUrl: string;
  /** Optional git environment variables (e.g., for authentication) */
  gitEnv?: NodeJS.ProcessEnv;
  /** Optional branch to checkout after cloning */
  branch?: string;
}

/**
 * Creates a temporary workspace directory in the OS tmp directory.
 *
 * The directory is created with a unique name to avoid conflicts.
 * Use the returned cleanup function to remove the workspace when done.
 *
 * @returns TempWorkspace object with path and cleanup function
 * @throws Error if directory creation fails
 *
 * @example
 * const workspace = await createTempWorkspace();
 * try {
 *   // Use workspace.path for operations
 *   console.log('Working in:', workspace.path);
 * } finally {
 *   await workspace.cleanup();
 * }
 */
export async function createTempWorkspace(): Promise<TempWorkspace> {
  // Create a unique temporary directory with prefix 'workspace-'
  const workspacePath = await mkdtemp(join(tmpdir(), 'workspace-'));

  const cleanup = async () => {
    try {
      // Remove the entire workspace directory recursively
      await rm(workspacePath, { recursive: true, force: true });
    } catch (error) {
      // Log cleanup errors but don't throw to avoid masking original errors
      console.error('Failed to cleanup workspace:', error);
    }
  };

  return {
    path: workspacePath,
    cleanup
  };
}

/**
 * Creates a temporary workspace and clones a repository into it.
 *
 * This function combines workspace creation with git clone operation.
 * The repository is cloned into the workspace directory, and cleanup
 * will remove both the repository and workspace.
 *
 * @param options - Clone options including repository URL and git environment
 * @returns TempWorkspace object with path and cleanup function
 * @throws Error if workspace creation or git clone fails
 *
 * @example
 * // Basic clone
 * const workspace = await createTempWorkspaceWithClone({
 *   repositoryUrl: 'https://github.com/user/repo.git'
 * });
 *
 * @example
 * // Clone with authentication
 * import { withGitCredentials } from '../../git-auth-helper.js';
 *
 * await withGitCredentials(token, async (gitEnv) => {
 *   const workspace = await createTempWorkspaceWithClone({
 *     repositoryUrl: 'https://github.com/user/private-repo.git',
 *     gitEnv
 *   });
 *   try {
 *     // Work with the cloned repository
 *   } finally {
 *     await workspace.cleanup();
 *   }
 * });
 *
 * @example
 * // Clone specific branch
 * const workspace = await createTempWorkspaceWithClone({
 *   repositoryUrl: 'https://github.com/user/repo.git',
 *   branch: 'develop'
 * });
 */
export async function createTempWorkspaceWithClone(
  options: CloneOptions
): Promise<TempWorkspace> {
  const { repositoryUrl, gitEnv, branch } = options;

  // Create the temporary workspace
  const workspace = await createTempWorkspace();

  try {
    // Clone the repository into the workspace
    const cloneArgs = ['clone', repositoryUrl, workspace.path];

    // Add branch option if specified
    if (branch) {
      cloneArgs.push('--branch', branch);
    }

    await execFileAsync('git', cloneArgs, {
      env: gitEnv || process.env
    });

    return workspace;
  } catch (error) {
    // If clone fails, cleanup the workspace before re-throwing
    await workspace.cleanup();
    throw error;
  }
}

/**
 * Executes an operation in a temporary workspace with automatic cleanup.
 *
 * This is a high-level helper that handles the complete lifecycle:
 * 1. Creates temporary workspace
 * 2. Executes the provided operation
 * 3. Ensures cleanup happens even if operation fails
 *
 * @param operation - Async function that receives the workspace path
 * @returns The result of the operation
 * @throws Any error from the operation (after cleanup)
 *
 * @example
 * const result = await withTempWorkspace(async (workspacePath) => {
 *   // Perform operations in workspace
 *   const files = await readdir(workspacePath);
 *   return files.length;
 * });
 * console.log('File count:', result);
 */
export async function withTempWorkspace<T>(
  operation: (workspacePath: string) => Promise<T>
): Promise<T> {
  const workspace = await createTempWorkspace();

  try {
    return await operation(workspace.path);
  } finally {
    await workspace.cleanup();
  }
}

/**
 * Clones a repository into a temporary workspace, executes an operation, and cleans up.
 *
 * This is the highest-level helper combining clone and workspace management.
 * Perfect for one-off repository operations that don't need persistent storage.
 *
 * @param options - Clone options including repository URL and git environment
 * @param operation - Async function that receives the workspace path
 * @returns The result of the operation
 * @throws Any error from clone or operation (after cleanup)
 *
 * @example
 * // Read package.json from a repository
 * const packageJson = await withTempWorkspaceClone(
 *   { repositoryUrl: 'https://github.com/user/repo.git' },
 *   async (workspacePath) => {
 *     const content = await readFile(
 *       join(workspacePath, 'package.json'),
 *       'utf-8'
 *     );
 *     return JSON.parse(content);
 *   }
 * );
 *
 * @example
 * // Execute tests in a cloned repository
 * await withTempWorkspaceClone(
 *   { repositoryUrl: 'https://github.com/user/repo.git', branch: 'develop' },
 *   async (workspacePath) => {
 *     await execFile('npm', ['install'], { cwd: workspacePath });
 *     await execFile('npm', ['test'], { cwd: workspacePath });
 *   }
 * );
 */
export async function withTempWorkspaceClone<T>(
  options: CloneOptions,
  operation: (workspacePath: string) => Promise<T>
): Promise<T> {
  const workspace = await createTempWorkspaceWithClone(options);

  try {
    return await operation(workspace.path);
  } finally {
    await workspace.cleanup();
  }
}

/**
 * Cleans up a workspace by removing its directory.
 *
 * This is a standalone cleanup function for manual workspace management.
 * Prefer using the cleanup function from TempWorkspace or the with* helpers.
 *
 * @param workspacePath - Path to the workspace directory to remove
 * @throws Error if cleanup fails
 */
export async function cleanupWorkspace(workspacePath: string): Promise<void> {
  try {
    await rm(workspacePath, { recursive: true, force: true });
  } catch (error) {
    console.error('Failed to cleanup workspace:', error);
    throw error;
  }
}
