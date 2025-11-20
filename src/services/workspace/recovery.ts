/**
 * Recovery mechanisms for interrupted workspace operations.
 *
 * Handles cleanup and recovery from partial or interrupted operations
 * such as incomplete clones, failed updates, or process termination.
 */

import { rm, access, readdir } from 'fs/promises';
import { join } from 'path';
import { InterruptedOperationError, CorruptedWorkspaceError } from './errors.js';
import { isValidGitRepository, getGitStatus } from './git-status.js';

/**
 * Lock file name for tracking in-progress operations.
 */
const LOCK_FILE_NAME = '.workspace-lock';

/**
 * Lock file contents.
 */
interface LockFileData {
  /**
   * Operation that created the lock.
   */
  operation: string;

  /**
   * Timestamp when operation started (ISO 8601).
   */
  startedAt: string;

  /**
   * Process ID that created the lock.
   */
  pid: number;
}

/**
 * Checks if a lock file exists for a workspace.
 *
 * @param workspacePath - Path to workspace directory
 * @returns true if lock file exists
 */
export async function hasLockFile(workspacePath: string): Promise<boolean> {
  try {
    await access(join(workspacePath, LOCK_FILE_NAME));
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates a lock file for an operation.
 *
 * @param workspacePath - Path to workspace directory
 * @param operation - Name of the operation
 *
 * @example
 * await createLockFile('/path/to/workspace', 'clone');
 * try {
 *   await performClone();
 * } finally {
 *   await removeLockFile('/path/to/workspace');
 * }
 */
export async function createLockFile(
  workspacePath: string,
  operation: string
): Promise<void> {
  const lockData: LockFileData = {
    operation,
    startedAt: new Date().toISOString(),
    pid: process.pid,
  };

  const lockPath = join(workspacePath, LOCK_FILE_NAME);
  await require('fs/promises').writeFile(
    lockPath,
    JSON.stringify(lockData, null, 2)
  );
}

/**
 * Removes a lock file.
 *
 * @param workspacePath - Path to workspace directory
 */
export async function removeLockFile(workspacePath: string): Promise<void> {
  try {
    await rm(join(workspacePath, LOCK_FILE_NAME), { force: true });
  } catch {
    // Ignore errors if lock file doesn't exist
  }
}

/**
 * Checks if a workspace has been partially cloned or is in an incomplete state.
 *
 * Detection criteria:
 * - Lock file exists (interrupted operation)
 * - .git directory exists but is incomplete
 * - Directory exists but is empty or has no .git
 *
 * @param workspacePath - Path to workspace directory
 * @returns true if workspace appears to be incomplete
 */
export async function isIncompleteWorkspace(
  workspacePath: string
): Promise<boolean> {
  try {
    // Check if directory exists
    await access(workspacePath);

    // Check for lock file (clear sign of interruption)
    if (await hasLockFile(workspacePath)) {
      return true;
    }

    // Check if it's a valid git repository
    const isValid = await isValidGitRepository(workspacePath);
    if (!isValid) {
      // Directory exists but isn't a valid git repo
      return true;
    }

    // Check if .git directory is complete
    const gitDir = join(workspacePath, '.git');
    const gitContents = await readdir(gitDir);

    // A complete git repository should have these critical components
    const requiredItems = ['HEAD', 'refs', 'objects', 'config'];
    const hasAllRequired = requiredItems.every((item) =>
      gitContents.includes(item)
    );

    if (!hasAllRequired) {
      return true; // Missing critical git components
    }

    return false; // Workspace appears complete
  } catch {
    // Directory doesn't exist or can't be accessed
    return false;
  }
}

/**
 * Recovers from an interrupted operation by cleaning up partial state.
 *
 * This function handles:
 * - Removing incomplete clone attempts
 * - Cleaning up lock files
 * - Validating and repairing workspace state
 *
 * @param workspacePath - Path to workspace directory
 * @returns true if recovery was needed and performed
 *
 * @example
 * if (await recoverFromInterruption('/path/to/workspace')) {
 *   console.log('Recovered from interrupted operation');
 * }
 */
export async function recoverFromInterruption(
  workspacePath: string
): Promise<boolean> {
  const isIncomplete = await isIncompleteWorkspace(workspacePath);

  if (!isIncomplete) {
    return false; // No recovery needed
  }

  // Remove the incomplete workspace
  await rm(workspacePath, { recursive: true, force: true });

  return true;
}

/**
 * Wraps an operation with lock file management and automatic recovery.
 *
 * Creates a lock file before the operation and removes it on completion.
 * If the operation fails, the lock file remains for later recovery detection.
 *
 * @param workspacePath - Path to workspace directory
 * @param operation - Name of the operation
 * @param fn - Async function to execute
 * @returns Result of the operation
 * @throws InterruptedOperationError if operation is interrupted
 *
 * @example
 * await withOperationLock(
 *   '/path/to/workspace',
 *   'clone',
 *   async () => {
 *     await cloneRepository(url, path);
 *   }
 * );
 */
export async function withOperationLock<T>(
  workspacePath: string,
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  // Check for and recover from previous interruptions
  await recoverFromInterruption(workspacePath);

  // Create lock file
  await createLockFile(workspacePath, operation);

  try {
    // Execute the operation
    const result = await fn();

    // Remove lock file on success
    await removeLockFile(workspacePath);

    return result;
  } catch (error) {
    // Leave lock file in place for recovery detection
    throw new InterruptedOperationError(
      operation,
      workspacePath,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Validates workspace integrity after an operation.
 *
 * Performs comprehensive checks to ensure workspace is in valid state:
 * - Git repository is valid
 * - No lock files present
 * - Working directory is accessible
 *
 * @param workspacePath - Path to workspace directory
 * @throws CorruptedWorkspaceError if validation fails
 *
 * @example
 * await validateWorkspaceIntegrity('/path/to/workspace');
 * console.log('Workspace is valid');
 */
export async function validateWorkspaceIntegrity(
  workspacePath: string
): Promise<void> {
  // Check for lock files (shouldn't be present after successful operation)
  if (await hasLockFile(workspacePath)) {
    throw new CorruptedWorkspaceError(
      workspacePath,
      'Lock file present, indicating incomplete operation'
    );
  }

  // Validate git repository
  const isValid = await isValidGitRepository(workspacePath);
  if (!isValid) {
    throw new CorruptedWorkspaceError(
      workspacePath,
      'Directory is not a valid git repository'
    );
  }

  // Try to get status (this will fail if repo is corrupted)
  try {
    await getGitStatus(workspacePath);
  } catch (error) {
    throw new CorruptedWorkspaceError(
      workspacePath,
      'Git status check failed',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Performs a full workspace cleanup and recovery.
 *
 * This is a more aggressive recovery that:
 * 1. Checks for incomplete state
 * 2. Removes the workspace entirely if corrupted
 * 3. Prepares for a fresh clone
 *
 * @param workspacePath - Path to workspace directory
 * @returns true if cleanup was needed and performed
 *
 * @example
 * if (await cleanupAndRecover('/path/to/workspace')) {
 *   console.log('Workspace was cleaned up, needs re-cloning');
 * }
 */
export async function cleanupAndRecover(workspacePath: string): Promise<boolean> {
  try {
    // First try to recover from interruption
    const recovered = await recoverFromInterruption(workspacePath);
    if (recovered) {
      return true;
    }

    // Try to validate integrity
    await validateWorkspaceIntegrity(workspacePath);

    // Workspace is valid, no cleanup needed
    return false;
  } catch (error) {
    // Validation failed, remove workspace for re-cloning
    await rm(workspacePath, { recursive: true, force: true });
    return true;
  }
}
