/**
 * Filesystem checks for workspace operations.
 *
 * Validates disk space availability, permissions, and filesystem access
 * before performing expensive workspace operations.
 */

import { statfs, access, constants, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { InsufficientDiskSpaceError, PermissionError } from './errors.js';

/**
 * Minimum free disk space required for workspace operations (in bytes).
 * Default: 500MB to account for repository size + workspace overhead.
 */
export const MIN_FREE_SPACE = 500 * 1024 * 1024;

/**
 * Filesystem information.
 */
export interface FilesystemInfo {
  /**
   * Total size of filesystem in bytes.
   */
  totalBytes: number;

  /**
   * Available space in bytes.
   */
  availableBytes: number;

  /**
   * Used space in bytes.
   */
  usedBytes: number;

  /**
   * Percentage of space used (0-100).
   */
  usedPercentage: number;
}

/**
 * Gets filesystem information for a path.
 *
 * @param path - Path to check (file or directory)
 * @returns Filesystem information
 *
 * @example
 * const info = await getFilesystemInfo('/path/to/workspace');
 * console.log(`Available: ${info.availableBytes} bytes`);
 */
export async function getFilesystemInfo(path: string): Promise<FilesystemInfo> {
  try {
    const stats = await statfs(path);

    // Calculate space (values differ by platform)
    const totalBytes = stats.blocks * stats.bsize;
    const availableBytes = stats.bavail * stats.bsize;
    const usedBytes = totalBytes - availableBytes;
    const usedPercentage = (usedBytes / totalBytes) * 100;

    return {
      totalBytes,
      availableBytes,
      usedBytes,
      usedPercentage,
    };
  } catch (error) {
    // If path doesn't exist, check parent directory
    const parentDir = dirname(path);
    if (parentDir === path) {
      // Reached root, re-throw error
      throw error;
    }
    return getFilesystemInfo(parentDir);
  }
}

/**
 * Checks if sufficient disk space is available.
 *
 * @param path - Path where space is needed
 * @param requiredBytes - Required space in bytes
 * @returns true if sufficient space is available
 *
 * @example
 * if (!await hasSufficientDiskSpace('/path', 1024 * 1024 * 100)) {
 *   console.error('Need 100MB free space');
 * }
 */
export async function hasSufficientDiskSpace(
  path: string,
  requiredBytes: number = MIN_FREE_SPACE
): Promise<boolean> {
  const info = await getFilesystemInfo(path);
  return info.availableBytes >= requiredBytes;
}

/**
 * Ensures sufficient disk space is available, throwing if not.
 *
 * @param path - Path where space is needed
 * @param requiredBytes - Required space in bytes
 * @throws InsufficientDiskSpaceError if not enough space
 *
 * @example
 * await ensureSufficientDiskSpace('/path/to/workspace', 1024 * 1024 * 500);
 */
export async function ensureSufficientDiskSpace(
  path: string,
  requiredBytes: number = MIN_FREE_SPACE
): Promise<void> {
  const info = await getFilesystemInfo(path);

  if (info.availableBytes < requiredBytes) {
    throw new InsufficientDiskSpaceError(
      requiredBytes,
      info.availableBytes,
      path
    );
  }
}

/**
 * Checks if a path is writable.
 *
 * @param path - Path to check
 * @returns true if path is writable
 *
 * @example
 * if (await isWritable('/path/to/dir')) {
 *   console.log('Can write to directory');
 * }
 */
export async function isWritable(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if a path is readable.
 *
 * @param path - Path to check
 * @returns true if path is readable
 *
 * @example
 * if (await isReadable('/path/to/file')) {
 *   console.log('Can read file');
 * }
 */
export async function isReadable(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if a path exists and is accessible.
 *
 * @param path - Path to check
 * @returns true if path exists and is accessible
 */
export async function isAccessible(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensures a path is writable, throwing if not.
 *
 * @param path - Path to check
 * @param operation - Description of operation requiring write access
 * @throws PermissionError if path is not writable
 *
 * @example
 * await ensureWritable('/path/to/workspace', 'clone repository');
 */
export async function ensureWritable(
  path: string,
  operation: string
): Promise<void> {
  if (!(await isWritable(path))) {
    throw new PermissionError(path, operation);
  }
}

/**
 * Ensures a path is readable, throwing if not.
 *
 * @param path - Path to check
 * @param operation - Description of operation requiring read access
 * @throws PermissionError if path is not readable
 *
 * @example
 * await ensureReadable('/path/to/workspace', 'read repository');
 */
export async function ensureReadable(
  path: string,
  operation: string
): Promise<void> {
  if (!(await isReadable(path))) {
    throw new PermissionError(path, operation);
  }
}

/**
 * Ensures a directory exists and is writable.
 *
 * Creates the directory if it doesn't exist, then verifies write access.
 *
 * @param dirPath - Directory path to check/create
 * @param operation - Description of operation requiring the directory
 * @throws PermissionError if directory cannot be created or is not writable
 *
 * @example
 * await ensureDirectoryWritable('/path/to/workspaces', 'create workspace');
 */
export async function ensureDirectoryWritable(
  dirPath: string,
  operation: string
): Promise<void> {
  try {
    // Create directory if it doesn't exist
    await mkdir(dirPath, { recursive: true });

    // Verify it's writable
    await ensureWritable(dirPath, operation);
  } catch (error) {
    if (error instanceof PermissionError) {
      throw error;
    }
    throw new PermissionError(
      dirPath,
      operation,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Performs comprehensive pre-flight checks before workspace operations.
 *
 * Validates:
 * - Sufficient disk space
 * - Parent directory exists and is writable
 * - No permission issues
 *
 * @param workspacePath - Path where workspace will be created
 * @param requiredBytes - Required disk space in bytes
 * @throws InsufficientDiskSpaceError if not enough space
 * @throws PermissionError if permissions are insufficient
 *
 * @example
 * await performPreFlightChecks('/path/to/workspace', 1024 * 1024 * 500);
 * console.log('Pre-flight checks passed');
 */
export async function performPreFlightChecks(
  workspacePath: string,
  requiredBytes: number = MIN_FREE_SPACE
): Promise<void> {
  // Check disk space
  await ensureSufficientDiskSpace(workspacePath, requiredBytes);

  // Ensure parent directory is writable
  const parentDir = dirname(workspacePath);
  await ensureDirectoryWritable(parentDir, 'create workspace');
}

/**
 * Formats bytes into human-readable string.
 *
 * @param bytes - Number of bytes
 * @returns Formatted string (e.g., "1.5 GB")
 */
export function formatBytes(bytes: number): string {
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
 * Estimates repository size from URL (placeholder for future enhancement).
 *
 * Currently returns a conservative default estimate.
 * Future implementation could query GitHub API or parse git metadata.
 *
 * @param _repositoryUrl - Repository URL (unused in current implementation)
 * @returns Estimated size in bytes
 *
 * @example
 * const estimatedSize = await estimateRepositorySize('https://github.com/user/repo.git');
 * console.log(`Estimated size: ${formatBytes(estimatedSize)}`);
 */
export async function estimateRepositorySize(
  _repositoryUrl: string
): Promise<number> {
  // TODO: Implement actual size estimation
  // Could use GitHub API: GET /repos/:owner/:repo
  // Or parse git ls-remote output
  // For now, return conservative estimate of 500MB
  return MIN_FREE_SPACE;
}
