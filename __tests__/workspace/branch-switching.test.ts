import { mkdtemp, writeFile, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Test suite for branch switching scenarios.
 *
 * These tests validate workspace behavior when switching between branches,
 * including isolation, error handling, and recovery mechanisms.
 */
describe('Branch Switching Scenarios', () => {
  let testWorkspacePath: string;

  beforeEach(async () => {
    // Create a unique temporary directory for each test
    testWorkspacePath = await mkdtemp(join(tmpdir(), 'test-branch-workspace-'));
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
   * Helper function to create a new branch.
   */
  async function createBranch(
    branchName: string,
    switchToBranch = false
  ): Promise<void> {
    const args = switchToBranch ? ['-b', branchName] : [branchName];
    await execFileAsync('git', ['checkout', ...args], {
      cwd: testWorkspacePath,
    });
  }

  /**
   * Helper function to switch to an existing branch.
   */
  async function switchBranch(branchName: string): Promise<void> {
    await execFileAsync('git', ['checkout', branchName], {
      cwd: testWorkspacePath,
    });
  }

  /**
   * Helper function to get current branch name.
   */
  async function getCurrentBranch(): Promise<string> {
    const { stdout } = await execFileAsync('git', ['branch', '--show-current'], {
      cwd: testWorkspacePath,
    });
    return stdout.trim();
  }

  /**
   * Helper function to commit current changes.
   */
  async function commitChanges(message: string): Promise<void> {
    await execFileAsync('git', ['add', '.'], { cwd: testWorkspacePath });
    await execFileAsync('git', ['commit', '-m', message], {
      cwd: testWorkspacePath,
    });
  }

  /**
   * Helper function to check if a file exists.
   */
  async function fileExists(fileName: string): Promise<boolean> {
    try {
      await readFile(join(testWorkspacePath, fileName));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Test Case 1: Multiple actions on different branches of same repository
   *
   * Validates that switching between branches properly isolates changes.
   */
  test('isolates changes across different branches', async () => {
    // Initialize git repository
    await initGitRepo();

    // Create initial commit on main branch
    const mainFile = join(testWorkspacePath, 'main.txt');
    await writeFile(mainFile, 'main branch content');
    await commitChanges('Initial commit on main');

    // Verify we're on main branch
    expect(await getCurrentBranch()).toBe('main');

    // Create and switch to feature branch
    await createBranch('feature/action-1', true);
    expect(await getCurrentBranch()).toBe('feature/action-1');

    // Create a feature-specific file
    const featureFile = join(testWorkspacePath, 'feature1.txt');
    await writeFile(featureFile, 'feature 1 content');
    await commitChanges('Add feature 1 file');

    // Verify feature file exists on feature branch
    expect(await fileExists('feature1.txt')).toBe(true);

    // Switch back to main branch
    await switchBranch('main');
    expect(await getCurrentBranch()).toBe('main');

    // Verify feature file doesn't exist on main branch
    expect(await fileExists('feature1.txt')).toBe(false);

    // Verify main file still exists
    expect(await fileExists('main.txt')).toBe(true);

    // Create second feature branch
    await createBranch('feature/action-2', true);
    expect(await getCurrentBranch()).toBe('feature/action-2');

    // Create a different feature-specific file
    const feature2File = join(testWorkspacePath, 'feature2.txt');
    await writeFile(feature2File, 'feature 2 content');
    await commitChanges('Add feature 2 file');

    // Verify feature2 file exists but feature1 file doesn't
    expect(await fileExists('feature2.txt')).toBe(true);
    expect(await fileExists('feature1.txt')).toBe(false);

    // Switch to feature/action-1 branch
    await switchBranch('feature/action-1');

    // Verify feature1 file exists but feature2 file doesn't
    expect(await fileExists('feature1.txt')).toBe(true);
    expect(await fileExists('feature2.txt')).toBe(false);
  });

  /**
   * Test Case 2: Switching branches in a persistent workspace
   *
   * Validates workspace state management when reusing a workspace across branches.
   */
  test('maintains consistent state when reusing workspace across branches', async () => {
    // Initialize git repository
    await initGitRepo();

    // Create initial commit
    const sharedFile = join(testWorkspacePath, 'shared.txt');
    await writeFile(sharedFile, 'version 0');
    await commitChanges('Initial commit');

    // Create branch1 and modify shared file
    await createBranch('branch1', true);
    await writeFile(sharedFile, 'version 1');
    await commitChanges('Update to version 1');

    // Create branch2 from main (before branch1 changes)
    await switchBranch('main');
    await createBranch('branch2', true);
    await writeFile(sharedFile, 'version 2');
    await commitChanges('Update to version 2');

    // Switch to branch1 and verify content
    await switchBranch('branch1');
    const branch1Content = await readFile(sharedFile, 'utf-8');
    expect(branch1Content).toBe('version 1');

    // Switch to branch2 and verify content
    await switchBranch('branch2');
    const branch2Content = await readFile(sharedFile, 'utf-8');
    expect(branch2Content).toBe('version 2');

    // Switch to main and verify original content
    await switchBranch('main');
    const mainContent = await readFile(sharedFile, 'utf-8');
    expect(mainContent).toBe('version 0');

    // Rapid switching test: verify no state bleed
    await switchBranch('branch1');
    expect(await readFile(sharedFile, 'utf-8')).toBe('version 1');

    await switchBranch('branch2');
    expect(await readFile(sharedFile, 'utf-8')).toBe('version 2');

    await switchBranch('main');
    expect(await readFile(sharedFile, 'utf-8')).toBe('version 0');
  });

  /**
   * Test Case 3: Handling branch conflicts (divergent histories)
   *
   * Validates behavior when branches have divergent histories.
   */
  test('handles divergent branch histories', async () => {
    // Initialize git repository
    await initGitRepo();

    // Create initial commit
    const conflictFile = join(testWorkspacePath, 'conflict.txt');
    await writeFile(conflictFile, 'initial content\n');
    await commitChanges('Initial commit');

    // Create branch1 and add changes
    await createBranch('branch1', true);
    await writeFile(conflictFile, 'initial content\nbranch1 changes\n');
    await commitChanges('Branch1 changes');

    // Switch back to main and create divergent history
    await switchBranch('main');
    await writeFile(conflictFile, 'initial content\nmain changes\n');
    await commitChanges('Main changes');

    // Create branch2 from this divergent main
    await createBranch('branch2', true);
    await writeFile(conflictFile, 'initial content\nmain changes\nbranch2 changes\n');
    await commitChanges('Branch2 changes');

    // Verify branch isolation - switching should work cleanly
    await switchBranch('branch1');
    const branch1Content = await readFile(conflictFile, 'utf-8');
    expect(branch1Content).toBe('initial content\nbranch1 changes\n');

    await switchBranch('branch2');
    const branch2Content = await readFile(conflictFile, 'utf-8');
    expect(branch2Content).toBe(
      'initial content\nmain changes\nbranch2 changes\n'
    );

    await switchBranch('main');
    const mainContent = await readFile(conflictFile, 'utf-8');
    expect(mainContent).toBe('initial content\nmain changes\n');

    // Verify we can switch between divergent branches without issues
    await switchBranch('branch1');
    expect(await getCurrentBranch()).toBe('branch1');

    await switchBranch('branch2');
    expect(await getCurrentBranch()).toBe('branch2');
  });

  /**
   * Test Case 4: Checkout failures and recovery mechanisms
   *
   * Validates error handling for failed branch switches.
   */
  test('handles checkout failures gracefully', async () => {
    // Initialize git repository
    await initGitRepo();

    // Create initial commit
    const testFile = join(testWorkspacePath, 'test.txt');
    await writeFile(testFile, 'initial content');
    await commitChanges('Initial commit');

    // Verify we're on main branch
    const currentBranch = await getCurrentBranch();
    expect(currentBranch).toBe('main');

    // Test 1: Attempt to checkout non-existent branch
    await expect(
      switchBranch('nonexistent-branch')
    ).rejects.toThrow();

    // Verify we're still on main after failed checkout
    expect(await getCurrentBranch()).toBe('main');

    // Test 2: Create uncommitted changes and try to switch branches
    await createBranch('new-feature', true);
    await writeFile(testFile, 'new feature content');
    await commitChanges('Update on new-feature');

    await switchBranch('main');
    await writeFile(testFile, 'uncommitted changes');

    // This should fail because of uncommitted changes that would be overwritten
    await expect(
      switchBranch('new-feature')
    ).rejects.toThrow();

    // Verify we're still on main after failed checkout
    expect(await getCurrentBranch()).toBe('main');

    // Test 3: Recovery - clean up uncommitted changes
    await execFileAsync('git', ['reset', '--hard', 'HEAD'], {
      cwd: testWorkspacePath,
    });

    // Now checkout should succeed
    await switchBranch('new-feature');
    expect(await getCurrentBranch()).toBe('new-feature');
  });

  /**
   * Test Case 5: Stale branch references
   *
   * Validates handling of branches that exist locally but may be out of sync.
   */
  test('handles stale branch references', async () => {
    // Initialize git repository
    await initGitRepo();

    // Create initial commit
    const testFile = join(testWorkspacePath, 'test.txt');
    await writeFile(testFile, 'initial content');
    await commitChanges('Initial commit');

    // Create a feature branch
    await createBranch('feature-branch', true);
    await writeFile(testFile, 'feature content');
    await commitChanges('Feature commit');

    // Get the commit hash for later reference
    const { stdout: featureCommit } = await execFileAsync(
      'git',
      ['rev-parse', 'HEAD'],
      { cwd: testWorkspacePath }
    );

    // Switch back to main
    await switchBranch('main');

    // Simulate branch being updated elsewhere by modifying feature branch
    await switchBranch('feature-branch');
    await writeFile(testFile, 'updated feature content');
    await commitChanges('Updated feature commit');

    // Get the new commit hash
    const { stdout: updatedCommit } = await execFileAsync(
      'git',
      ['rev-parse', 'HEAD'],
      { cwd: testWorkspacePath }
    );

    // Verify commits are different (branch has moved forward)
    expect(featureCommit.trim()).not.toBe(updatedCommit.trim());

    // Switch back to main and then to feature-branch
    await switchBranch('main');
    await switchBranch('feature-branch');

    // Verify we're on the latest commit
    const { stdout: currentCommit } = await execFileAsync(
      'git',
      ['rev-parse', 'HEAD'],
      { cwd: testWorkspacePath }
    );
    expect(currentCommit.trim()).toBe(updatedCommit.trim());

    // Verify content is the latest
    const content = await readFile(testFile, 'utf-8');
    expect(content).toBe('updated feature content');
  });

  /**
   * Performance test: Measure branch switching time
   */
  test('measures branch switching performance', async () => {
    // Initialize git repository
    await initGitRepo();

    // Create initial commit with multiple files
    const fileCount = 50;
    for (let i = 0; i < fileCount; i++) {
      const filePath = join(testWorkspacePath, `file${i}.txt`);
      await writeFile(filePath, `content ${i}`);
    }
    await commitChanges('Initial commit with many files');

    // Create a feature branch with modifications
    await createBranch('feature', true);
    for (let i = 0; i < fileCount; i++) {
      const filePath = join(testWorkspacePath, `file${i}.txt`);
      await writeFile(filePath, `feature content ${i}`);
    }
    await commitChanges('Feature modifications');

    // Measure branch switching time
    const iterations = 10;
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const startTime = Date.now();
      await switchBranch(i % 2 === 0 ? 'main' : 'feature');
      const switchTime = Date.now() - startTime;
      times.push(switchTime);
    }

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const maxTime = Math.max(...times);

    console.log(
      `Average branch switch time: ${avgTime.toFixed(2)}ms (max: ${maxTime}ms) across ${iterations} switches`
    );

    // Sanity check: branch switching should be reasonably fast (< 2 seconds)
    expect(maxTime).toBeLessThan(2000);
  });

  /**
   * Integration test: Complete workflow with multiple branch switches
   */
  test('complete workflow: create, switch, modify, verify', async () => {
    // Initialize git repository
    await initGitRepo();

    // Setup: Create initial state
    const readmeFile = join(testWorkspacePath, 'README.md');
    await writeFile(readmeFile, '# Initial Project\n');
    await commitChanges('Initial commit');

    // Workflow Step 1: Create feature branch for first action
    await createBranch('feature/add-authentication', true);
    const authFile = join(testWorkspacePath, 'auth.txt');
    await writeFile(authFile, 'authentication code');
    await commitChanges('Add authentication');

    // Verify feature branch state
    expect(await getCurrentBranch()).toBe('feature/add-authentication');
    expect(await fileExists('auth.txt')).toBe(true);

    // Workflow Step 2: Switch to main for second action
    await switchBranch('main');
    expect(await fileExists('auth.txt')).toBe(false);

    // Create second feature branch
    await createBranch('feature/add-database', true);
    const dbFile = join(testWorkspacePath, 'database.txt');
    await writeFile(dbFile, 'database code');
    await commitChanges('Add database');

    // Verify second feature branch state
    expect(await getCurrentBranch()).toBe('feature/add-database');
    expect(await fileExists('database.txt')).toBe(true);
    expect(await fileExists('auth.txt')).toBe(false);

    // Workflow Step 3: Switch back to first feature to verify isolation
    await switchBranch('feature/add-authentication');
    expect(await fileExists('auth.txt')).toBe(true);
    expect(await fileExists('database.txt')).toBe(false);

    // Workflow Step 4: Verify main branch is clean
    await switchBranch('main');
    expect(await fileExists('auth.txt')).toBe(false);
    expect(await fileExists('database.txt')).toBe(false);
    expect(await fileExists('README.md')).toBe(true);

    const readmeContent = await readFile(readmeFile, 'utf-8');
    expect(readmeContent).toBe('# Initial Project\n');
  });

  /**
   * Edge case: Switching to detached HEAD state
   */
  test('handles detached HEAD state', async () => {
    // Initialize git repository
    await initGitRepo();

    // Create initial commit
    const testFile = join(testWorkspacePath, 'test.txt');
    await writeFile(testFile, 'initial content');
    await commitChanges('Initial commit');

    // Get the commit hash
    const { stdout: commitHash } = await execFileAsync(
      'git',
      ['rev-parse', 'HEAD'],
      { cwd: testWorkspacePath }
    );

    // Create another commit
    await writeFile(testFile, 'second content');
    await commitChanges('Second commit');

    // Checkout the first commit (detached HEAD)
    await execFileAsync('git', ['checkout', commitHash.trim()], {
      cwd: testWorkspacePath,
    });

    // Verify we're in detached HEAD state
    const currentBranch = await getCurrentBranch();
    expect(currentBranch).toBe('');

    // Verify content is from first commit
    const content = await readFile(testFile, 'utf-8');
    expect(content).toBe('initial content');

    // Switch back to main
    await switchBranch('main');
    expect(await getCurrentBranch()).toBe('main');

    // Verify content is from second commit
    const mainContent = await readFile(testFile, 'utf-8');
    expect(mainContent).toBe('second content');
  });
});
