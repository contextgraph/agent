import simpleGit, { SimpleGit, GitError } from 'simple-git';
import { withGitCredentials } from '../../git-auth-helper.js';
import { GitCredentials } from '../../types/actions.js';

/**
 * Clones a git repository to a target directory with optional authentication.
 *
 * Supports both HTTPS and SSH URLs. For HTTPS URLs with credentials, uses GIT_ASKPASS
 * mechanism via withGitCredentials wrapper for secure authentication.
 *
 * @param url - Repository URL (HTTPS or SSH)
 * @param targetDir - Local directory path where repository will be cloned
 * @param branch - Optional branch to checkout during clone (uses -b flag)
 * @param credentials - Optional git credentials for authentication
 * @throws Error if clone fails with context about the failure
 *
 * @example
 * // Clone public repository
 * await cloneRepository('https://github.com/user/repo.git', '/path/to/dir');
 *
 * @example
 * // Clone private repository with credentials
 * await cloneRepository(
 *   'https://github.com/user/private-repo.git',
 *   '/path/to/dir',
 *   'main',
 *   { githubToken: 'ghp_...', provider: 'github', acquiredAt: '...', source: 'manual' }
 * );
 */
export async function cloneRepository(
  url: string,
  targetDir: string,
  branch?: string,
  credentials?: GitCredentials
): Promise<void> {
  try {
    // Build clone options
    const cloneOptions: string[] = [];
    if (branch) {
      cloneOptions.push('-b', branch);
    }

    // If credentials provided, use GIT_ASKPASS wrapper
    if (credentials && (credentials.githubToken || credentials.gitlabToken)) {
      const token = credentials.githubToken || credentials.gitlabToken!;

      await withGitCredentials(token, async (env) => {
        const git: SimpleGit = simpleGit()
          .env(env);

        await git.clone(url, targetDir, cloneOptions);
      });
    } else {
      // No credentials - clone directly (public repo or SSH)
      const git: SimpleGit = simpleGit();
      await git.clone(url, targetDir, cloneOptions);
    }
  } catch (error) {
    const gitError = error as GitError;
    throw new Error(
      `Failed to clone repository from ${url} to ${targetDir}: ${gitError.message}`
    );
  }
}

/**
 * Checks out an existing branch in a git repository.
 *
 * Validates that the branch exists (locally or remotely) before attempting checkout.
 * Handles detached HEAD state by creating a new branch if needed.
 *
 * @param dir - Path to the git repository
 * @param branch - Branch name to checkout
 * @throws Error if branch doesn't exist or checkout fails
 *
 * @example
 * await checkoutBranch('/path/to/repo', 'feature/new-feature');
 */
export async function checkoutBranch(
  dir: string,
  branch: string
): Promise<void> {
  try {
    const git: SimpleGit = simpleGit(dir);

    // Validate branch exists
    const exists = await validateBranch(dir, branch);
    if (!exists) {
      throw new Error(`Branch '${branch}' does not exist locally or remotely`);
    }

    // Check if we're in detached HEAD state
    const status = await git.status();
    const isDetached = status.detached;

    if (isDetached) {
      // In detached HEAD state - need to handle carefully
      // Check if branch exists locally
      const branches = await git.branchLocal();
      const localExists = branches.all.includes(branch);

      if (localExists) {
        // Branch exists locally, just checkout
        await git.checkout(branch);
      } else {
        // Branch doesn't exist locally, check if it's remote
        const allBranches = await git.branch(['-a']);
        const remoteBranch = allBranches.all.find(
          b => b === `remotes/origin/${branch}` || b === `origin/${branch}`
        );

        if (remoteBranch) {
          // Create local branch tracking remote
          await git.checkout(['-b', branch, `origin/${branch}`]);
        } else {
          throw new Error(`Cannot find branch '${branch}' locally or remotely`);
        }
      }
    } else {
      // Not in detached HEAD, normal checkout
      const branches = await git.branchLocal();
      if (branches.all.includes(branch)) {
        await git.checkout(branch);
      } else {
        // Try to checkout remote branch
        await git.checkout(['-b', branch, `origin/${branch}`]);
      }
    }
  } catch (error) {
    const gitError = error as GitError;
    throw new Error(
      `Failed to checkout branch '${branch}' in ${dir}: ${gitError.message}`
    );
  }
}

/**
 * Validates whether a branch exists in a git repository.
 *
 * Checks both local and remote branches using `git branch -a`.
 *
 * @param dir - Path to the git repository
 * @param branch - Branch name to validate
 * @returns true if branch exists locally or remotely, false otherwise
 *
 * @example
 * const exists = await validateBranch('/path/to/repo', 'main');
 * if (exists) {
 *   console.log('Branch exists');
 * }
 */
export async function validateBranch(
  dir: string,
  branch: string
): Promise<boolean> {
  try {
    const git: SimpleGit = simpleGit(dir);

    // Get all branches (local and remote)
    const branches = await git.branch(['-a']);

    // Check if branch exists in any form:
    // - Local: 'feature-branch'
    // - Remote: 'remotes/origin/feature-branch'
    return branches.all.some(
      b => b === branch ||
           b === `remotes/origin/${branch}` ||
           b === `origin/${branch}`
    );
  } catch (error) {
    const gitError = error as GitError;
    throw new Error(
      `Failed to validate branch '${branch}' in ${dir}: ${gitError.message}`
    );
  }
}
