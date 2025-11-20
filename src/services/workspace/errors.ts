/**
 * Custom error types for workspace operations.
 *
 * This module defines structured error classes with recovery strategies
 * for different failure scenarios in workspace management.
 */

/**
 * Base class for all workspace-related errors.
 * Provides common properties and recovery context.
 */
export abstract class WorkspaceError extends Error {
  /**
   * Whether this error is recoverable through automatic retry or fallback.
   */
  abstract readonly recoverable: boolean;

  /**
   * Human-readable suggestion for how to resolve this error.
   */
  abstract readonly suggestion: string;

  /**
   * Error category for logging and monitoring.
   */
  abstract readonly category: ErrorCategory;

  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = this.constructor.name;

    // Capture stack trace properly
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error categories for classification and monitoring.
 */
export type ErrorCategory =
  | 'network'
  | 'filesystem'
  | 'git'
  | 'permission'
  | 'resource'
  | 'state'
  | 'corruption';

/**
 * Error thrown when git clone operation fails.
 * Common causes: network issues, authentication, invalid URL.
 */
export class CloneError extends WorkspaceError {
  readonly recoverable = true;
  readonly category: ErrorCategory = 'git';
  readonly suggestion = 'Check network connection, repository URL, and authentication credentials. Will retry automatically.';

  constructor(
    public readonly repositoryUrl: string,
    message: string,
    cause?: Error
  ) {
    super(`Failed to clone repository ${repositoryUrl}: ${message}`, cause);
  }
}

/**
 * Error thrown when git pull operation fails.
 * Common causes: network issues, merge conflicts, detached HEAD.
 */
export class UpdateError extends WorkspaceError {
  readonly recoverable = true;
  readonly category: ErrorCategory = 'git';
  readonly suggestion = 'Check network connection. If conflicts exist, workspace will be re-cloned.';

  constructor(
    public readonly workspacePath: string,
    message: string,
    cause?: Error
  ) {
    super(`Failed to update workspace at ${workspacePath}: ${message}`, cause);
  }
}

/**
 * Error thrown when workspace has uncommitted changes.
 * Prevents data loss by detecting dirty working directory.
 */
export class DirtyWorkspaceError extends WorkspaceError {
  readonly recoverable = false;
  readonly category: ErrorCategory = 'state';
  readonly suggestion = 'Commit or stash changes before proceeding, or use a clean workspace.';

  constructor(
    public readonly workspacePath: string,
    public readonly modifiedFiles: string[]
  ) {
    super(
      `Workspace has ${modifiedFiles.length} uncommitted changes: ${modifiedFiles.slice(0, 3).join(', ')}${modifiedFiles.length > 3 ? '...' : ''}`,
    );
  }
}

/**
 * Error thrown when workspace directory is corrupted or invalid.
 * Common causes: interrupted operations, filesystem errors, manual deletion.
 */
export class CorruptedWorkspaceError extends WorkspaceError {
  readonly recoverable = true;
  readonly category: ErrorCategory = 'corruption';
  readonly suggestion = 'Workspace will be removed and re-cloned automatically.';

  constructor(
    public readonly workspacePath: string,
    public readonly reason: string,
    cause?: Error
  ) {
    super(`Workspace corrupted at ${workspacePath}: ${reason}`, cause);
  }
}

/**
 * Error thrown when insufficient disk space is available.
 */
export class InsufficientDiskSpaceError extends WorkspaceError {
  readonly recoverable = false;
  readonly category: ErrorCategory = 'resource';
  readonly suggestion = 'Free up disk space or clean old workspace caches.';

  constructor(
    public readonly requiredBytes: number,
    public readonly availableBytes: number,
    public readonly path: string
  ) {
    super(
      `Insufficient disk space at ${path}: need ${formatBytes(requiredBytes)}, have ${formatBytes(availableBytes)}`
    );
  }
}

/**
 * Error thrown when filesystem permission is denied.
 */
export class PermissionError extends WorkspaceError {
  readonly recoverable = false;
  readonly category: ErrorCategory = 'permission';
  readonly suggestion = 'Check filesystem permissions or run with appropriate privileges.';

  constructor(
    public readonly path: string,
    public readonly operation: string,
    cause?: Error
  ) {
    super(`Permission denied for ${operation} at ${path}`, cause);
  }
}

/**
 * Error thrown when workspace operation is interrupted.
 * Common causes: process termination, timeout, user cancellation.
 */
export class InterruptedOperationError extends WorkspaceError {
  readonly recoverable = true;
  readonly category: ErrorCategory = 'state';
  readonly suggestion = 'Operation can be retried. Partial state will be cleaned up.';

  constructor(
    public readonly operation: string,
    public readonly workspacePath: string,
    cause?: Error
  ) {
    super(`Operation '${operation}' was interrupted at ${workspacePath}`, cause);
  }
}

/**
 * Error thrown when network-related operation fails.
 */
export class NetworkError extends WorkspaceError {
  readonly recoverable = true;
  readonly category: ErrorCategory = 'network';
  readonly suggestion = 'Check network connection and firewall settings. Will retry automatically.';

  constructor(
    public readonly url: string,
    message: string,
    cause?: Error
  ) {
    super(`Network error accessing ${url}: ${message}`, cause);
  }
}

/**
 * Formats bytes into human-readable string.
 */
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Type guard to check if an error is a workspace error.
 */
export function isWorkspaceError(error: unknown): error is WorkspaceError {
  return error instanceof WorkspaceError;
}

/**
 * Extracts error category from any error.
 */
export function getErrorCategory(error: unknown): ErrorCategory {
  if (isWorkspaceError(error)) {
    return error.category;
  }
  return 'filesystem';
}

/**
 * Checks if an error is recoverable.
 */
export function isRecoverable(error: unknown): boolean {
  if (isWorkspaceError(error)) {
    return error.recoverable;
  }
  return false;
}
