/**
 * Workspace integration layer for repository operations.
 *
 * Provides a thin integration layer between git operations and workspace management.
 * This module exposes a clean API for preparing workspaces that delegates to the
 * WorkspaceManager for actual workspace lifecycle management.
 */

import { cwd } from 'process';
import { getWorkspace, WorkspaceOptions } from '../workspace/workspace-manager.js';
import { GitCredentials } from '../../types/actions.js';

/**
 * Prepares a workspace for executing operations.
 *
 * If a repository URL is provided, delegates to WorkspaceManager to get or create
 * a workspace. Otherwise, returns the current working directory.
 *
 * @param repositoryUrl - Optional repository URL to clone/fetch
 * @param branch - Optional branch to checkout
 * @param credentials - Optional git credentials for authentication
 * @returns Absolute path to the workspace directory for execution
 *
 * @example
 * // No repository - use current directory
 * const workspace = await prepareWorkspace();
 * console.log(workspace); // '/Users/user/code/my-project'
 *
 * @example
 * // With repository - get managed workspace
 * const workspace = await prepareWorkspace(
 *   'https://github.com/user/repo.git',
 *   'main',
 *   { githubToken: 'ghp_...', provider: 'github', acquiredAt: '...', source: 'manual' }
 * );
 * console.log(workspace); // '/Users/user/.contextgraph/workspaces/github-com-user-repo'
 */
export async function prepareWorkspace(
  repositoryUrl?: string | null,
  branch?: string,
  _credentials?: GitCredentials
): Promise<string> {
  // If no repository URL, return current working directory
  if (!repositoryUrl) {
    return cwd();
  }

  // Delegate to WorkspaceManager
  // Note: credentials are handled internally by git-operations via withGitCredentials
  // when WorkspaceManager calls cloneRepository or other git operations
  const options: WorkspaceOptions = {
    repositoryUrl,
    branch
  };

  const result = await getWorkspace(options);
  return result.path;
}

/**
 * Gets a workspace for a repository with metadata about the workspace state.
 *
 * Always requires a repository URL. Returns both the workspace path and
 * whether it was newly created or retrieved from cache.
 *
 * @param repositoryUrl - Repository URL to clone/fetch
 * @param branch - Optional branch to checkout
 * @param credentials - Optional git credentials for authentication
 * @returns Object with workspace path and isNew flag
 *
 * @example
 * const { path, isNew } = await getWorkspaceForRepository(
 *   'https://github.com/user/repo.git',
 *   'main'
 * );
 * if (isNew) {
 *   console.log(`Created new workspace at ${path}`);
 * } else {
 *   console.log(`Using cached workspace at ${path}`);
 * }
 */
export async function getWorkspaceForRepository(
  repositoryUrl: string,
  branch?: string,
  _credentials?: GitCredentials
): Promise<{ path: string; isNew: boolean }> {
  // Build workspace options
  // Note: credentials are handled internally by git-operations via withGitCredentials
  const options: WorkspaceOptions = {
    repositoryUrl,
    branch
  };

  // Delegate to WorkspaceManager
  const result = await getWorkspace(options);

  return {
    path: result.path,
    isNew: result.isNew ?? false
  };
}
