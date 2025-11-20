import { mkdir, rm, access } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';

const execFileAsync = promisify(execFile);

/**
 * Base directory for all persistent workspaces.
 * Located at ~/.contextgraph/workspaces/
 */
const WORKSPACE_BASE_DIR = join(homedir(), '.contextgraph', 'workspaces');

/**
 * Represents a persistent workspace for repository operations.
 * Unlike temporary workspaces, these persist across executions.
 */
export interface PersistentWorkspace {
  /** Absolute path to the persistent workspace directory */
  path: string;
  /** Whether the workspace was newly created (true) or already existed (false) */
  isNew: boolean;
}

/**
 * Options for getting or creating a persistent workspace with a cloned repository.
 */
export interface PersistentCloneOptions {
  /** Repository URL to clone (e.g., 'https://github.com/user/repo.git') */
  repositoryUrl: string;
  /** Optional git environment variables (e.g., for authentication) */
  gitEnv?: NodeJS.ProcessEnv;
  /** Optional branch to checkout after cloning */
  branch?: string;
}

/**
 * Computes a stable workspace path from a repository URL.
 *
 * The path is derived from a hash of the repository URL to ensure:
 * - Same repository always maps to same workspace directory
 * - No filesystem-unsafe characters
 * - Reasonable collision resistance
 *
 * @param repositoryUrl - Repository URL to compute path for
 * @returns Absolute path to workspace directory
 *
 * @example
 * const path = getWorkspacePath('https://github.com/user/repo.git');
 * // Returns: ~/.contextgraph/workspaces/a3f2b1c4...
 */
export function getWorkspacePath(repositoryUrl: string): string {
  // Create a hash of the repository URL for a stable, filesystem-safe directory name
  const hash = createHash('sha256').update(repositoryUrl).digest('hex');
  // Use first 16 characters for reasonable uniqueness while keeping paths readable
  const dirName = hash.substring(0, 16);
  return join(WORKSPACE_BASE_DIR, dirName);
}

/**
 * Checks if a directory exists and is accessible.
 *
 * @param dirPath - Path to check
 * @returns true if directory exists and is accessible, false otherwise
 */
async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    await access(dirPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if a directory is a valid git repository.
 *
 * @param dirPath - Path to check
 * @returns true if directory is a git repository, false otherwise
 */
async function isGitRepository(dirPath: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: dirPath });
    return true;
  } catch {
    return false;
  }
}

/**
 * Updates a persistent workspace by running git pull.
 *
 * This ensures the workspace has the latest changes from the remote repository.
 * If the pull fails (e.g., due to corruption or conflicts), this function throws.
 *
 * @param workspacePath - Path to the workspace directory
 * @param gitEnv - Optional git environment variables
 * @throws Error if git pull fails
 *
 * @example
 * await updateWorkspace('/path/to/workspace');
 */
export async function updateWorkspace(
  workspacePath: string,
  gitEnv?: NodeJS.ProcessEnv
): Promise<void> {
  try {
    await execFileAsync('git', ['pull'], {
      cwd: workspacePath,
      env: gitEnv || process.env
    });
  } catch (error) {
    throw new Error(`Failed to update workspace: ${error}`);
  }
}

/**
 * Gets an existing persistent workspace or creates a new one with a cloned repository.
 *
 * This function implements the core persistent workspace pattern:
 * 1. Compute stable path from repository URL
 * 2. If workspace exists and is valid, update it with git pull
 * 3. If workspace doesn't exist or is corrupted, (re)clone the repository
 *
 * Corruption recovery: If update fails or directory isn't a valid git repo,
 * the workspace is removed and re-cloned from scratch.
 *
 * @param options - Clone options including repository URL and git environment
 * @returns PersistentWorkspace object with path and isNew flag
 * @throws Error if workspace creation or git operations fail
 *
 * @example
 * // First access - clones repository
 * const workspace = await getOrCreateWorkspace({
 *   repositoryUrl: 'https://github.com/user/repo.git'
 * });
 * console.log('Workspace path:', workspace.path);
 * console.log('Is new:', workspace.isNew); // true
 *
 * @example
 * // Subsequent access - updates existing workspace
 * const workspace = await getOrCreateWorkspace({
 *   repositoryUrl: 'https://github.com/user/repo.git'
 * });
 * console.log('Is new:', workspace.isNew); // false
 *
 * @example
 * // With authentication
 * import { withGitCredentials } from '../../git-auth-helper.js';
 *
 * await withGitCredentials(token, async (gitEnv) => {
 *   const workspace = await getOrCreateWorkspace({
 *     repositoryUrl: 'https://github.com/user/private-repo.git',
 *     gitEnv
 *   });
 *   // Work with the workspace
 * });
 *
 * @example
 * // Clone specific branch
 * const workspace = await getOrCreateWorkspace({
 *   repositoryUrl: 'https://github.com/user/repo.git',
 *   branch: 'develop'
 * });
 */
export async function getOrCreateWorkspace(
  options: PersistentCloneOptions
): Promise<PersistentWorkspace> {
  const { repositoryUrl, gitEnv, branch } = options;
  const workspacePath = getWorkspacePath(repositoryUrl);

  // Ensure base directory exists
  await mkdir(WORKSPACE_BASE_DIR, { recursive: true });

  // Check if workspace already exists
  const exists = await directoryExists(workspacePath);

  if (exists) {
    // Verify it's a valid git repository
    const isValid = await isGitRepository(workspacePath);

    if (isValid) {
      try {
        // Try to update the existing workspace
        await updateWorkspace(workspacePath, gitEnv);
        return { path: workspacePath, isNew: false };
      } catch (error) {
        // Update failed - likely corrupted, remove and re-clone
        console.warn('Workspace update failed, re-cloning:', error);
        await rm(workspacePath, { recursive: true, force: true });
      }
    } else {
      // Not a valid git repository - remove and re-clone
      console.warn('Invalid git repository found, removing:', workspacePath);
      await rm(workspacePath, { recursive: true, force: true });
    }
  }

  // Clone the repository into the workspace
  const cloneArgs = ['clone', repositoryUrl, workspacePath];

  // Add branch option if specified
  if (branch) {
    cloneArgs.push('--branch', branch);
  }

  try {
    await execFileAsync('git', cloneArgs, {
      env: gitEnv || process.env
    });

    return { path: workspacePath, isNew: true };
  } catch (error) {
    // If clone fails, cleanup any partial directory before re-throwing
    await rm(workspacePath, { recursive: true, force: true }).catch(() => {
      // Ignore cleanup errors
    });
    throw error;
  }
}

/**
 * Executes an operation in a persistent workspace with automatic management.
 *
 * This is a high-level helper that handles the complete lifecycle:
 * 1. Gets or creates the workspace (cloning or updating as needed)
 * 2. Executes the provided operation
 * 3. Returns the result (workspace persists after operation completes)
 *
 * @param options - Clone options including repository URL and git environment
 * @param operation - Async function that receives the workspace path and isNew flag
 * @returns The result of the operation
 * @throws Any error from workspace creation or operation
 *
 * @example
 * // Read package.json from a repository
 * const packageJson = await withPersistentWorkspace(
 *   { repositoryUrl: 'https://github.com/user/repo.git' },
 *   async (workspacePath, isNew) => {
 *     console.log(isNew ? 'Cloned repository' : 'Using existing workspace');
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
 * await withPersistentWorkspace(
 *   { repositoryUrl: 'https://github.com/user/repo.git', branch: 'develop' },
 *   async (workspacePath) => {
 *     await execFile('npm', ['install'], { cwd: workspacePath });
 *     await execFile('npm', ['test'], { cwd: workspacePath });
 *   }
 * );
 */
export async function withPersistentWorkspace<T>(
  options: PersistentCloneOptions,
  operation: (workspacePath: string, isNew: boolean) => Promise<T>
): Promise<T> {
  const workspace = await getOrCreateWorkspace(options);
  return await operation(workspace.path, workspace.isNew);
}
