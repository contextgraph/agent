import { mkdtemp, writeFile, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Test suite for dirty working directory handling.
 *
 * These tests validate workspace behavior when dealing with uncommitted changes,
 * including detection, cleanup strategies, and error handling.
 */
describe('Dirty Working Directory Handling', () => {
  let testWorkspacePath: string;

  beforeEach(async () => {
    // Create a unique temporary directory for each test
    testWorkspacePath = await mkdtemp(join(tmpdir(), 'test-workspace-'));
  });

  afterEach(async () => {
    // Clean up the test workspace after each test
    try {
      await rm(testWorkspacePath, { recursive: true, force: true });
    } catch (error) {
      console.error('Failed to cleanup test workspace:', error);
    }
  });

  /**
   * Helper function to initialize a git repository in the test workspace.
   */
  async function initGitRepo(): Promise<void> {
    await execFileAsync('git', ['init'], { cwd: testWorkspacePath });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: testWorkspacePath,
    });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], {
      cwd: testWorkspacePath,
    });
  }

  /**
   * Helper function to check if working directory is dirty (has uncommitted changes).
   */
  async function isWorkingDirectoryDirty(workspacePath: string): Promise<boolean> {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: workspacePath,
    });
    return stdout.trim().length > 0;
  }

  /**
   * Helper function to get detailed git status information.
   */
  async function getGitStatus(workspacePath: string): Promise<string> {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: workspacePath,
    });
    return stdout;
  }

  /**
   * Test Case 1: Action modifies files but doesn't commit
   *
   * Validates that we can detect when files are modified without being committed.
   */
  test('detects modified files without commit', async () => {
    // Initialize git repository
    await initGitRepo();

    // Create and commit an initial file
    const filePath = join(testWorkspacePath, 'test.txt');
    await writeFile(filePath, 'initial content');
    await execFileAsync('git', ['add', 'test.txt'], { cwd: testWorkspacePath });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], {
      cwd: testWorkspacePath,
    });

    // Verify directory is clean after commit
    expect(await isWorkingDirectoryDirty(testWorkspacePath)).toBe(false);

    // Modify the file without committing
    await writeFile(filePath, 'modified content');

    // Verify directory is now dirty
    expect(await isWorkingDirectoryDirty(testWorkspacePath)).toBe(true);

    // Verify git status shows the modified file
    const status = await getGitStatus(testWorkspacePath);
    expect(status).toContain('test.txt');
    expect(status).toContain('M'); // Modified indicator
  });

  /**
   * Test Case 2: Subsequent action tries to use same workspace
   *
   * Validates detection of dirty state when reusing a workspace.
   */
  test('detects dirty state when reusing workspace', async () => {
    // Initialize git repository
    await initGitRepo();

    // Simulate first action: create and commit a file
    const file1Path = join(testWorkspacePath, 'action1.txt');
    await writeFile(file1Path, 'action 1 content');
    await execFileAsync('git', ['add', 'action1.txt'], { cwd: testWorkspacePath });
    await execFileAsync('git', ['commit', '-m', 'Action 1'], {
      cwd: testWorkspacePath,
    });

    // Simulate first action leaving uncommitted changes
    const file2Path = join(testWorkspacePath, 'action1-temp.txt');
    await writeFile(file2Path, 'temporary changes');
    await execFileAsync('git', ['add', 'action1-temp.txt'], {
      cwd: testWorkspacePath,
    });

    // Verify directory is dirty after first action
    expect(await isWorkingDirectoryDirty(testWorkspacePath)).toBe(true);

    // Simulate second action attempting to use the same workspace
    // Should detect dirty state before starting work
    const isDirtyBeforeStart = await isWorkingDirectoryDirty(testWorkspacePath);
    expect(isDirtyBeforeStart).toBe(true);

    // In a real scenario, this would trigger cleanup or error handling
    const status = await getGitStatus(testWorkspacePath);
    expect(status).toContain('action1-temp.txt');
  });

  /**
   * Test Case 3: Detecting dirty state before starting work
   *
   * Validates reliable detection of various types of uncommitted changes.
   */
  test('detects various types of uncommitted changes', async () => {
    // Initialize git repository
    await initGitRepo();

    // Create initial committed file
    const committedFile = join(testWorkspacePath, 'committed.txt');
    await writeFile(committedFile, 'committed content');
    await execFileAsync('git', ['add', 'committed.txt'], { cwd: testWorkspacePath });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], {
      cwd: testWorkspacePath,
    });

    // Clean state check
    expect(await isWorkingDirectoryDirty(testWorkspacePath)).toBe(false);

    // Test 1: Untracked file
    const untrackedFile = join(testWorkspacePath, 'untracked.txt');
    await writeFile(untrackedFile, 'untracked content');
    expect(await isWorkingDirectoryDirty(testWorkspacePath)).toBe(true);

    // Clean up untracked file
    await rm(untrackedFile);

    // Test 2: Modified tracked file
    await writeFile(committedFile, 'modified content');
    expect(await isWorkingDirectoryDirty(testWorkspacePath)).toBe(true);

    // Clean up modification
    await execFileAsync('git', ['restore', 'committed.txt'], {
      cwd: testWorkspacePath,
    });

    // Test 3: Staged changes
    const stagedFile = join(testWorkspacePath, 'staged.txt');
    await writeFile(stagedFile, 'staged content');
    await execFileAsync('git', ['add', 'staged.txt'], { cwd: testWorkspacePath });
    expect(await isWorkingDirectoryDirty(testWorkspacePath)).toBe(true);

    // Test 4: Deleted tracked file
    await rm(committedFile);
    expect(await isWorkingDirectoryDirty(testWorkspacePath)).toBe(true);
  });

  /**
   * Test Case 4: Cleaning up uncommitted changes
   *
   * Validates different cleanup strategies work correctly.
   */
  test('cleans up uncommitted changes using git reset --hard', async () => {
    // Initialize git repository
    await initGitRepo();

    // Create and commit initial file
    const filePath = join(testWorkspacePath, 'test.txt');
    await writeFile(filePath, 'initial content');
    await execFileAsync('git', ['add', 'test.txt'], { cwd: testWorkspacePath });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], {
      cwd: testWorkspacePath,
    });

    // Create dirty state with multiple types of changes
    await writeFile(filePath, 'modified content'); // Modified file
    const untrackedFile = join(testWorkspacePath, 'untracked.txt');
    await writeFile(untrackedFile, 'untracked'); // Untracked file

    // Verify dirty state
    expect(await isWorkingDirectoryDirty(testWorkspacePath)).toBe(true);

    // Clean up using git reset --hard
    await execFileAsync('git', ['reset', '--hard', 'HEAD'], {
      cwd: testWorkspacePath,
    });

    // Verify tracked files are restored
    const content = await readFile(filePath, 'utf-8');
    expect(content).toBe('initial content');

    // Note: git reset --hard doesn't remove untracked files
    // Still dirty due to untracked file
    expect(await isWorkingDirectoryDirty(testWorkspacePath)).toBe(true);

    // Clean up untracked files
    await execFileAsync('git', ['clean', '-fd'], { cwd: testWorkspacePath });

    // Now workspace should be completely clean
    expect(await isWorkingDirectoryDirty(testWorkspacePath)).toBe(false);
  });

  test('cleans up uncommitted changes using git stash', async () => {
    // Initialize git repository
    await initGitRepo();

    // Create and commit initial file
    const filePath = join(testWorkspacePath, 'test.txt');
    await writeFile(filePath, 'initial content');
    await execFileAsync('git', ['add', 'test.txt'], { cwd: testWorkspacePath });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], {
      cwd: testWorkspacePath,
    });

    // Create dirty state
    await writeFile(filePath, 'modified content');
    expect(await isWorkingDirectoryDirty(testWorkspacePath)).toBe(true);

    // Stash changes
    await execFileAsync('git', ['stash', 'push', '-m', 'Temporary stash'], {
      cwd: testWorkspacePath,
    });

    // Verify workspace is clean
    expect(await isWorkingDirectoryDirty(testWorkspacePath)).toBe(false);

    // Verify content is restored
    const content = await readFile(filePath, 'utf-8');
    expect(content).toBe('initial content');

    // Verify stash exists (could be recovered if needed)
    const { stdout } = await execFileAsync('git', ['stash', 'list'], {
      cwd: testWorkspacePath,
    });
    expect(stdout).toContain('Temporary stash');
  });

  /**
   * Test Case 5: Preserving intentional modifications vs cleanup
   *
   * Validates the ability to distinguish between changes that should be
   * preserved vs. cleaned up.
   */
  test('preserves specific files while cleaning up others', async () => {
    // Initialize git repository
    await initGitRepo();

    // Create and commit initial files
    const keepFile = join(testWorkspacePath, 'keep.txt');
    const cleanFile = join(testWorkspacePath, 'clean.txt');

    await writeFile(keepFile, 'initial keep content');
    await writeFile(cleanFile, 'initial clean content');

    await execFileAsync('git', ['add', '.'], { cwd: testWorkspacePath });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], {
      cwd: testWorkspacePath,
    });

    // Modify both files
    await writeFile(keepFile, 'modified keep content');
    await writeFile(cleanFile, 'modified clean content');

    expect(await isWorkingDirectoryDirty(testWorkspacePath)).toBe(true);

    // Selectively restore only the clean file
    await execFileAsync('git', ['restore', 'clean.txt'], {
      cwd: testWorkspacePath,
    });

    // Verify keep.txt still has modifications
    const keepContent = await readFile(keepFile, 'utf-8');
    expect(keepContent).toBe('modified keep content');

    // Verify clean.txt was restored
    const cleanContent = await readFile(cleanFile, 'utf-8');
    expect(cleanContent).toBe('initial clean content');

    // Workspace is still dirty due to keep.txt
    expect(await isWorkingDirectoryDirty(testWorkspacePath)).toBe(true);
  });

  /**
   * Performance test: Measure cleanup operation time
   */
  test('measures cleanup performance', async () => {
    // Initialize git repository
    await initGitRepo();

    // Create multiple files to simulate realistic workload
    const fileCount = 100;
    const files: string[] = [];

    for (let i = 0; i < fileCount; i++) {
      const filePath = join(testWorkspacePath, `file${i}.txt`);
      await writeFile(filePath, `content ${i}`);
      files.push(filePath);
    }

    // Commit all files
    await execFileAsync('git', ['add', '.'], { cwd: testWorkspacePath });
    await execFileAsync('git', ['commit', '-m', 'Add test files'], {
      cwd: testWorkspacePath,
    });

    // Modify all files to create dirty state
    for (let i = 0; i < fileCount; i++) {
      const filePath = join(testWorkspacePath, `file${i}.txt`);
      await writeFile(filePath, `modified ${i}`);
    }

    expect(await isWorkingDirectoryDirty(testWorkspacePath)).toBe(true);

    // Measure cleanup time
    const startTime = Date.now();

    await execFileAsync('git', ['reset', '--hard', 'HEAD'], {
      cwd: testWorkspacePath,
    });
    await execFileAsync('git', ['clean', '-fd'], {
      cwd: testWorkspacePath,
    });

    const cleanupTime = Date.now() - startTime;

    // Verify cleanup was successful
    expect(await isWorkingDirectoryDirty(testWorkspacePath)).toBe(false);

    // Log performance data (not an assertion, just documentation)
    console.log(`Cleanup time for ${fileCount} files: ${cleanupTime}ms`);

    // Sanity check: cleanup should be reasonably fast (< 5 seconds)
    expect(cleanupTime).toBeLessThan(5000);
  });

  /**
   * Error handling: Test cleanup failure scenarios
   */
  test('handles cleanup errors gracefully', async () => {
    // Initialize git repository
    await initGitRepo();

    // Create and commit a file
    const filePath = join(testWorkspacePath, 'test.txt');
    await writeFile(filePath, 'content');
    await execFileAsync('git', ['add', 'test.txt'], { cwd: testWorkspacePath });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], {
      cwd: testWorkspacePath,
    });

    // Try to reset to a non-existent commit
    await expect(
      execFileAsync('git', ['reset', '--hard', 'nonexistent-commit'], {
        cwd: testWorkspacePath,
      })
    ).rejects.toThrow();

    // Workspace should still be in a valid state
    const isDirty = await isWorkingDirectoryDirty(testWorkspacePath);
    expect(typeof isDirty).toBe('boolean'); // Should not throw
  });

  /**
   * Integration test: Complete workflow simulation
   */
  test('complete workflow: detect, clean, verify', async () => {
    // Initialize git repository
    await initGitRepo();

    // Setup: Create initial committed state
    const filePath = join(testWorkspacePath, 'workflow.txt');
    await writeFile(filePath, 'initial');
    await execFileAsync('git', ['add', 'workflow.txt'], { cwd: testWorkspacePath });
    await execFileAsync('git', ['commit', '-m', 'Initial'], {
      cwd: testWorkspacePath,
    });

    // Step 1: Action leaves workspace dirty
    await writeFile(filePath, 'dirty');
    const dirtyFile = join(testWorkspacePath, 'temp.txt');
    await writeFile(dirtyFile, 'temporary');

    // Step 2: Detect dirty state
    const isDirtyBefore = await isWorkingDirectoryDirty(testWorkspacePath);
    expect(isDirtyBefore).toBe(true);

    // Step 3: Clean workspace
    await execFileAsync('git', ['reset', '--hard', 'HEAD'], {
      cwd: testWorkspacePath,
    });
    await execFileAsync('git', ['clean', '-fd'], {
      cwd: testWorkspacePath,
    });

    // Step 4: Verify clean state
    const isDirtyAfter = await isWorkingDirectoryDirty(testWorkspacePath);
    expect(isDirtyAfter).toBe(false);

    // Step 5: Verify content is restored
    const content = await readFile(filePath, 'utf-8');
    expect(content).toBe('initial');

    // Step 6: Verify temp file is removed
    await expect(readFile(dirtyFile, 'utf-8')).rejects.toThrow();
  });
});
