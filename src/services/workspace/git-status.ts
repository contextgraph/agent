/**
 * Git status utilities for workspace validation.
 *
 * Provides functions to check workspace state, detect uncommitted changes,
 * and validate git repository integrity.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { DirtyWorkspaceError, CorruptedWorkspaceError } from './errors.js';

const execFileAsync = promisify(execFile);

/**
 * Git repository status information.
 */
export interface GitStatus {
  /**
   * Whether the repository is clean (no uncommitted changes).
   */
  isClean: boolean;

  /**
   * List of modified files (staged and unstaged).
   */
  modifiedFiles: string[];

  /**
   * List of untracked files.
   */
  untrackedFiles: string[];

  /**
   * Whether the repository has uncommitted changes.
   */
  hasUncommittedChanges: boolean;

  /**
   * Current branch name.
   */
  branch: string | null;

  /**
   * Whether HEAD is detached.
   */
  isDetached: boolean;
}

/**
 * Checks if a directory is a valid git repository.
 *
 * @param workspacePath - Path to check
 * @returns true if directory is a valid git repository
 * @throws CorruptedWorkspaceError if git directory is corrupted
 */
export async function isValidGitRepository(workspacePath: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['rev-parse', '--git-dir'], {
      cwd: workspacePath,
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Check if error is due to corruption vs. missing repository
    if (message.includes('not a git repository')) {
      return false;
    }

    // Other errors suggest corruption
    throw new CorruptedWorkspaceError(
      workspacePath,
      'Git repository validation failed',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Gets the git status of a workspace.
 *
 * @param workspacePath - Path to workspace directory
 * @returns Git status information
 * @throws CorruptedWorkspaceError if repository is invalid
 *
 * @example
 * const status = await getGitStatus('/path/to/workspace');
 * if (!status.isClean) {
 *   console.log('Modified files:', status.modifiedFiles);
 * }
 */
export async function getGitStatus(workspacePath: string): Promise<GitStatus> {
  try {
    // Get porcelain status for easy parsing
    const { stdout } = await execFileAsync(
      'git',
      ['status', '--porcelain', '--branch'],
      { cwd: workspacePath }
    );

    const lines = stdout.split('\n').filter((line) => line.trim());
    const modifiedFiles: string[] = [];
    const untrackedFiles: string[] = [];
    let branch: string | null = null;
    let isDetached = false;

    for (const line of lines) {
      if (line.startsWith('##')) {
        // Branch information
        const branchMatch = line.match(/## ([^.]+)/);
        if (branchMatch) {
          branch = branchMatch[1];
          isDetached = branch.includes('HEAD (no branch)') || branch.includes('detached');
        }
      } else if (line.startsWith('??')) {
        // Untracked file
        untrackedFiles.push(line.slice(3));
      } else {
        // Modified, staged, or deleted file
        modifiedFiles.push(line.slice(3));
      }
    }

    const hasUncommittedChanges = modifiedFiles.length > 0 || untrackedFiles.length > 0;
    const isClean = !hasUncommittedChanges;

    return {
      isClean,
      modifiedFiles,
      untrackedFiles,
      hasUncommittedChanges,
      branch,
      isDetached,
    };
  } catch (error) {
    throw new CorruptedWorkspaceError(
      workspacePath,
      'Failed to get git status',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Checks if a workspace has uncommitted changes.
 *
 * @param workspacePath - Path to workspace directory
 * @returns true if workspace has uncommitted changes
 *
 * @example
 * const isDirty = await hasUncommittedChanges('/path/to/workspace');
 * if (isDirty) {
 *   console.warn('Workspace has uncommitted changes');
 * }
 */
export async function hasUncommittedChanges(workspacePath: string): Promise<boolean> {
  const status = await getGitStatus(workspacePath);
  return status.hasUncommittedChanges;
}

/**
 * Ensures a workspace is clean before proceeding with operations.
 *
 * @param workspacePath - Path to workspace directory
 * @param allowUntracked - Whether to allow untracked files (default: true)
 * @throws DirtyWorkspaceError if workspace has uncommitted changes
 *
 * @example
 * await ensureCleanWorkspace('/path/to/workspace');
 * // Continues only if workspace is clean
 */
export async function ensureCleanWorkspace(
  workspacePath: string,
  allowUntracked = true
): Promise<void> {
  const status = await getGitStatus(workspacePath);

  const problematicFiles = allowUntracked
    ? status.modifiedFiles
    : [...status.modifiedFiles, ...status.untrackedFiles];

  if (problematicFiles.length > 0) {
    throw new DirtyWorkspaceError(workspacePath, problematicFiles);
  }
}

/**
 * Checks if the working directory matches the index (no staged changes).
 *
 * @param workspacePath - Path to workspace directory
 * @returns true if there are staged changes
 */
export async function hasStagedChanges(workspacePath: string): Promise<boolean> {
  try {
    await execFileAsync(
      'git',
      ['diff', '--cached', '--quiet'],
      { cwd: workspacePath }
    );
    return false; // No output means no staged changes
  } catch (error) {
    // Non-zero exit code means there are staged changes
    return true;
  }
}

/**
 * Checks if the working directory has unstaged changes.
 *
 * @param workspacePath - Path to workspace directory
 * @returns true if there are unstaged changes
 */
export async function hasUnstagedChanges(workspacePath: string): Promise<boolean> {
  try {
    await execFileAsync(
      'git',
      ['diff', '--quiet'],
      { cwd: workspacePath }
    );
    return false; // No output means no unstaged changes
  } catch (error) {
    // Non-zero exit code means there are unstaged changes
    return true;
  }
}

/**
 * Gets the current branch name.
 *
 * @param workspacePath - Path to workspace directory
 * @returns Branch name or null if detached HEAD
 */
export async function getCurrentBranch(workspacePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: workspacePath }
    );
    const branch = stdout.trim();
    return branch === 'HEAD' ? null : branch;
  } catch (error) {
    throw new CorruptedWorkspaceError(
      workspacePath,
      'Failed to get current branch',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Resets workspace to clean state (discards all changes).
 *
 * WARNING: This is destructive and will lose uncommitted work.
 * Use with caution and only when explicitly intended.
 *
 * @param workspacePath - Path to workspace directory
 *
 * @example
 * // Only use when you're sure you want to discard changes
 * await resetToCleanState('/path/to/workspace');
 */
export async function resetToCleanState(workspacePath: string): Promise<void> {
  try {
    // Reset all changes
    await execFileAsync('git', ['reset', '--hard', 'HEAD'], {
      cwd: workspacePath,
    });

    // Remove untracked files and directories
    await execFileAsync('git', ['clean', '-fd'], {
      cwd: workspacePath,
    });
  } catch (error) {
    throw new CorruptedWorkspaceError(
      workspacePath,
      'Failed to reset workspace to clean state',
      error instanceof Error ? error : undefined
    );
  }
}
