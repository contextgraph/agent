import { mkdtemp, writeFile, rm, chmod } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  CloneError,
  DirtyWorkspaceError,
  InsufficientDiskSpaceError,
  PermissionError,
  InterruptedOperationError,
  isWorkspaceError,
  isRecoverable,
} from '../../src/services/workspace/errors.js';
import {
  getGitStatus,
  hasUncommittedChanges,
  ensureCleanWorkspace,
  isValidGitRepository,
  resetToCleanState,
} from '../../src/services/workspace/git-status.js';
import {
  withRetry,
  isTransientError,
} from '../../src/services/workspace/retry.js';
import {
  hasLockFile,
  createLockFile,
  removeLockFile,
  isIncompleteWorkspace,
  recoverFromInterruption,
  withOperationLock,
} from '../../src/services/workspace/recovery.js';
import {
  hasSufficientDiskSpace,
  isWritable,
  ensureWritable,
} from '../../src/services/workspace/filesystem-checks.js';

const execFileAsync = promisify(execFile);

/**
 * Integration tests for workspace error handling.
 */
describe('Workspace Error Handling', () => {
  let testWorkspacePath: string;

  beforeEach(async () => {
    testWorkspacePath = await mkdtemp(join(tmpdir(), 'test-error-handling-'));
  });

  afterEach(async () => {
    try {
      await rm(testWorkspacePath, { recursive: true, force: true });
    } catch (error) {
      console.error('Failed to cleanup test workspace:', error);
    }
  });

  async function initGitRepo(): Promise<void> {
    await execFileAsync('git', ['init'], { cwd: testWorkspacePath });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: testWorkspacePath,
    });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], {
      cwd: testWorkspacePath,
    });
  }

  describe('Error Type System', () => {
    test('CloneError has correct properties', () => {
      const error = new CloneError(
        'https://github.com/test/repo.git',
        'Network timeout'
      );

      expect(error.name).toBe('CloneError');
      expect(error.repositoryUrl).toBe('https://github.com/test/repo.git');
      expect(error.recoverable).toBe(true);
      expect(error.category).toBe('git');
      expect(error.suggestion).toContain('retry');
      expect(isWorkspaceError(error)).toBe(true);
      expect(isRecoverable(error)).toBe(true);
    });

    test('DirtyWorkspaceError has correct properties', () => {
      const error = new DirtyWorkspaceError('/path/to/workspace', [
        'file1.txt',
        'file2.txt',
      ]);

      expect(error.name).toBe('DirtyWorkspaceError');
      expect(error.workspacePath).toBe('/path/to/workspace');
      expect(error.modifiedFiles).toEqual(['file1.txt', 'file2.txt']);
      expect(error.recoverable).toBe(false);
      expect(error.category).toBe('state');
      expect(isWorkspaceError(error)).toBe(true);
      expect(isRecoverable(error)).toBe(false);
    });

    test('InsufficientDiskSpaceError has correct properties', () => {
      const error = new InsufficientDiskSpaceError(
        1000000,
        500000,
        '/path/to/workspace'
      );

      expect(error.name).toBe('InsufficientDiskSpaceError');
      expect(error.requiredBytes).toBe(1000000);
      expect(error.availableBytes).toBe(500000);
      expect(error.recoverable).toBe(false);
      expect(error.category).toBe('resource');
    });

    test('PermissionError has correct properties', () => {
      const error = new PermissionError('/path', 'write');

      expect(error.name).toBe('PermissionError');
      expect(error.path).toBe('/path');
      expect(error.operation).toBe('write');
      expect(error.recoverable).toBe(false);
      expect(error.category).toBe('permission');
    });

    test('InterruptedOperationError has correct properties', () => {
      const error = new InterruptedOperationError('clone', '/path/to/workspace');

      expect(error.name).toBe('InterruptedOperationError');
      expect(error.operation).toBe('clone');
      expect(error.workspacePath).toBe('/path/to/workspace');
      expect(error.recoverable).toBe(true);
      expect(error.category).toBe('state');
    });
  });

  describe('Git Status Detection', () => {
    test('detects clean repository', async () => {
      await initGitRepo();

      const filePath = join(testWorkspacePath, 'test.txt');
      await writeFile(filePath, 'content');
      await execFileAsync('git', ['add', 'test.txt'], { cwd: testWorkspacePath });
      await execFileAsync('git', ['commit', '-m', 'Initial'], {
        cwd: testWorkspacePath,
      });

      const status = await getGitStatus(testWorkspacePath);
      expect(status.isClean).toBe(true);
      expect(status.hasUncommittedChanges).toBe(false);
      expect(status.modifiedFiles).toHaveLength(0);
    });

    test('detects uncommitted changes', async () => {
      await initGitRepo();

      const filePath = join(testWorkspacePath, 'test.txt');
      await writeFile(filePath, 'content');

      const status = await getGitStatus(testWorkspacePath);
      expect(status.isClean).toBe(false);
      expect(status.hasUncommittedChanges).toBe(true);
      expect(status.untrackedFiles).toContain('test.txt');
    });

    test('throws DirtyWorkspaceError when ensuring clean workspace with changes', async () => {
      await initGitRepo();

      const filePath = join(testWorkspacePath, 'test.txt');
      await writeFile(filePath, 'content');
      await execFileAsync('git', ['add', 'test.txt'], { cwd: testWorkspacePath });
      await execFileAsync('git', ['commit', '-m', 'Initial'], {
        cwd: testWorkspacePath,
      });

      // Now modify it to create dirty state
      await writeFile(filePath, 'modified');

      await expect(ensureCleanWorkspace(testWorkspacePath, false)).rejects.toThrow(
        DirtyWorkspaceError
      );
    });

    test('validates git repository correctly', async () => {
      await initGitRepo();

      const isValid = await isValidGitRepository(testWorkspacePath);
      expect(isValid).toBe(true);
    });

    test('detects non-git directory', async () => {
      // testWorkspacePath exists but is not a git repo
      const isValid = await isValidGitRepository(testWorkspacePath);
      expect(isValid).toBe(false);
    });

    test('resets workspace to clean state', async () => {
      await initGitRepo();

      const filePath = join(testWorkspacePath, 'test.txt');
      await writeFile(filePath, 'initial');
      await execFileAsync('git', ['add', 'test.txt'], { cwd: testWorkspacePath });
      await execFileAsync('git', ['commit', '-m', 'Initial'], {
        cwd: testWorkspacePath,
      });

      // Make changes
      await writeFile(filePath, 'modified');
      await writeFile(join(testWorkspacePath, 'untracked.txt'), 'untracked');

      expect(await hasUncommittedChanges(testWorkspacePath)).toBe(true);

      // Reset to clean state
      await resetToCleanState(testWorkspacePath);

      expect(await hasUncommittedChanges(testWorkspacePath)).toBe(false);
    });
  });

  describe('Retry Mechanism', () => {
    test('retries failing operation', async () => {
      let attemptCount = 0;

      const result = await withRetry(
        async () => {
          attemptCount++;
          if (attemptCount < 3) {
            throw new CloneError('https://test.git', 'Network error');
          }
          return 'success';
        },
        { maxAttempts: 3, initialDelay: 10 }
      );

      expect(result).toBe('success');
      expect(attemptCount).toBe(3);
    });

    test('stops retrying on non-recoverable error', async () => {
      let attemptCount = 0;

      await expect(
        withRetry(
          async () => {
            attemptCount++;
            throw new DirtyWorkspaceError('/path', ['file.txt']);
          },
          { maxAttempts: 3, initialDelay: 10 }
        )
      ).rejects.toThrow(DirtyWorkspaceError);

      expect(attemptCount).toBe(1); // Should not retry
    });

    test('identifies transient errors', () => {
      const networkError = new Error('ECONNREFUSED');
      const timeoutError = new Error('Operation timed out');
      const otherError = new Error('Something else');

      expect(isTransientError(networkError)).toBe(true);
      expect(isTransientError(timeoutError)).toBe(true);
      expect(isTransientError(otherError)).toBe(false);
    });
  });

  describe('Interruption Recovery', () => {
    test('creates and removes lock file', async () => {
      await initGitRepo();

      expect(await hasLockFile(testWorkspacePath)).toBe(false);

      await createLockFile(testWorkspacePath, 'test-operation');
      expect(await hasLockFile(testWorkspacePath)).toBe(true);

      await removeLockFile(testWorkspacePath);
      expect(await hasLockFile(testWorkspacePath)).toBe(false);
    });

    test('detects incomplete workspace with lock file', async () => {
      await initGitRepo();
      await createLockFile(testWorkspacePath, 'clone');

      const isIncomplete = await isIncompleteWorkspace(testWorkspacePath);
      expect(isIncomplete).toBe(true);
    });

    test('detects incomplete workspace without git directory', async () => {
      // Directory exists but no .git
      const isIncomplete = await isIncompleteWorkspace(testWorkspacePath);
      // A directory without .git is considered incomplete since it should be a git repo
      expect(isIncomplete).toBe(true);
    });

    test('recovers from interrupted operation', async () => {
      await initGitRepo();
      await createLockFile(testWorkspacePath, 'clone');

      const recovered = await recoverFromInterruption(testWorkspacePath);
      expect(recovered).toBe(true);

      // Workspace should be removed
      const stillExists = await isIncompleteWorkspace(testWorkspacePath);
      expect(stillExists).toBe(false);
    });

    test('withOperationLock manages lock file lifecycle', async () => {
      await initGitRepo();

      const result = await withOperationLock(
        testWorkspacePath,
        'test',
        async () => {
          // Lock should exist during operation
          expect(await hasLockFile(testWorkspacePath)).toBe(true);
          return 'success';
        }
      );

      expect(result).toBe('success');
      // Lock should be removed after success
      expect(await hasLockFile(testWorkspacePath)).toBe(false);
    });

    test('withOperationLock leaves lock file on failure', async () => {
      await initGitRepo();

      await expect(
        withOperationLock(testWorkspacePath, 'test', async () => {
          throw new Error('Operation failed');
        })
      ).rejects.toThrow(InterruptedOperationError);

      // Lock should remain for recovery
      expect(await hasLockFile(testWorkspacePath)).toBe(true);
    });
  });

  describe('Filesystem Checks', () => {
    test('checks disk space availability', async () => {
      const hasSpace = await hasSufficientDiskSpace(testWorkspacePath, 1024);
      expect(typeof hasSpace).toBe('boolean');
      // Should have at least 1KB available in temp
      expect(hasSpace).toBe(true);
    });

    test('checks writability', async () => {
      const writable = await isWritable(testWorkspacePath);
      expect(writable).toBe(true);
    });

    test('detects non-writable path', async () => {
      if (process.platform === 'win32') {
        // Skip on Windows (chmod behaves differently)
        return;
      }

      const testFile = join(testWorkspacePath, 'readonly.txt');
      await writeFile(testFile, 'content');
      await chmod(testFile, 0o444); // Read-only

      const writable = await isWritable(testFile);
      expect(writable).toBe(false);

      await expect(
        ensureWritable(testFile, 'test operation')
      ).rejects.toThrow(PermissionError);
    });
  });

  describe('Integration: Complete Error Handling Flow', () => {
    test('handles complete workflow with errors', async () => {
      await initGitRepo();

      // Create initial state
      const filePath = join(testWorkspacePath, 'test.txt');
      await writeFile(filePath, 'initial');
      await execFileAsync('git', ['add', 'test.txt'], { cwd: testWorkspacePath });
      await execFileAsync('git', ['commit', '-m', 'Initial'], {
        cwd: testWorkspacePath,
      });

      // Simulate dirty workspace
      await writeFile(filePath, 'modified');

      // Detect dirty state
      const isDirty = await hasUncommittedChanges(testWorkspacePath);
      expect(isDirty).toBe(true);

      // Attempt to ensure clean workspace - should throw
      await expect(ensureCleanWorkspace(testWorkspacePath)).rejects.toThrow(
        DirtyWorkspaceError
      );

      // Recover by resetting
      await resetToCleanState(testWorkspacePath);

      // Verify clean
      const isCleanAfter = await hasUncommittedChanges(testWorkspacePath);
      expect(isCleanAfter).toBe(false);
    });
  });
});
