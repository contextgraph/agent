import { mkdtemp, writeFile, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Test suite for concurrent execution scenarios.
 *
 * These tests validate workspace behavior under concurrent access,
 * including race conditions, isolation, and performance degradation.
 */
describe('Concurrent Execution Scenarios', () => {
  let testBasePath: string;

  beforeEach(async () => {
    // Create a unique base directory for each test
    testBasePath = await mkdtemp(join(tmpdir(), 'test-concurrent-'));
  });

  afterEach(async () => {
    // Clean up all test workspaces after each test
    try {
      await rm(testBasePath, { recursive: true, force: true });
    } catch (error) {
      console.error('Failed to cleanup test workspaces:', error);
    }
  });

  /**
   * Helper function to initialize a git repository.
   */
  async function initGitRepo(workspacePath: string): Promise<void> {
    await execFileAsync('git', ['init'], { cwd: workspacePath });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: workspacePath,
    });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], {
      cwd: workspacePath,
    });
  }

  /**
   * Helper function to create a bare repository (simulates remote).
   */
  async function createBareRepo(repoPath: string): Promise<void> {
    await execFileAsync('git', ['init', '--bare', repoPath]);
  }

  /**
   * Helper function to clone a repository.
   */
  async function cloneRepo(
    sourceUrl: string,
    targetPath: string
  ): Promise<void> {
    await execFileAsync('git', ['clone', sourceUrl, targetPath]);
  }

  /**
   * Helper function to commit changes.
   */
  async function commitChanges(
    workspacePath: string,
    message: string
  ): Promise<void> {
    await execFileAsync('git', ['add', '.'], { cwd: workspacePath });
    await execFileAsync('git', ['commit', '-m', message], {
      cwd: workspacePath,
    });
  }

  /**
   * Helper function to get current branch.
   */
  async function getCurrentBranch(workspacePath: string): Promise<string> {
    const { stdout } = await execFileAsync(
      'git',
      ['branch', '--show-current'],
      { cwd: workspacePath }
    );
    return stdout.trim();
  }

  /**
   * Test Case 1: Validate basic concurrent repository cloning
   * (Child action: d9f806e8-391f-49df-93ad-a5296dcfcc52)
   *
   * Validates that multiple actions can clone the same repository
   * concurrently without data corruption or race conditions.
   */
  test('handles concurrent repository cloning without corruption', async () => {
    // Create a bare repository to simulate a remote
    const bareRepoPath = join(testBasePath, 'bare-repo.git');
    await createBareRepo(bareRepoPath);

    // Initialize a temporary workspace to populate the bare repo
    const tempWorkspace = await mkdtemp(join(testBasePath, 'temp-init-'));
    await initGitRepo(tempWorkspace);

    // Add some initial content
    const readmeFile = join(tempWorkspace, 'README.md');
    await writeFile(readmeFile, '# Test Repository\n');
    await commitChanges(tempWorkspace, 'Initial commit');

    // Push to bare repo
    await execFileAsync('git', ['remote', 'add', 'origin', bareRepoPath], {
      cwd: tempWorkspace,
    });
    await execFileAsync('git', ['push', '-u', 'origin', 'main'], {
      cwd: tempWorkspace,
    });

    // Clean up temp workspace
    await rm(tempWorkspace, { recursive: true, force: true });

    // Simulate 5 concurrent clone operations
    const cloneCount = 5;
    const clonePromises = Array.from({ length: cloneCount }, async (_, i) => {
      const workspacePath = join(testBasePath, `workspace-${i}`);
      const startTime = Date.now();

      await cloneRepo(bareRepoPath, workspacePath);

      const cloneTime = Date.now() - startTime;

      // Verify the clone was successful
      const readmeContent = await readFile(
        join(workspacePath, 'README.md'),
        'utf-8'
      );
      expect(readmeContent).toBe('# Test Repository\n');

      // Verify git integrity
      const { stdout: status } = await execFileAsync(
        'git',
        ['status', '--porcelain'],
        { cwd: workspacePath }
      );
      expect(status.trim()).toBe(''); // Clean working directory

      return { workspaceId: i, cloneTime };
    });

    // Execute all clones concurrently
    const results = await Promise.all(clonePromises);

    // Verify all clones completed successfully
    expect(results).toHaveLength(cloneCount);

    // Log performance data
    const avgCloneTime =
      results.reduce((sum, r) => sum + r.cloneTime, 0) / results.length;
    console.log(
      `Concurrent cloning: ${cloneCount} clones, average time: ${avgCloneTime.toFixed(2)}ms`
    );

    // Verify no corruption by checking each workspace independently
    for (let i = 0; i < cloneCount; i++) {
      const workspacePath = join(testBasePath, `workspace-${i}`);
      const content = await readFile(join(workspacePath, 'README.md'), 'utf-8');
      expect(content).toBe('# Test Repository\n');
    }
  });

  /**
   * Test Case 2: Test concurrent branch operations in same repository
   * (Child action: 22c4504a-df77-4db0-8f9a-50eb84e717bf)
   *
   * Validates that concurrent branch operations on different workspaces
   * of the same repository don't interfere with each other.
   */
  test('isolates concurrent branch operations across workspaces', async () => {
    // Create a bare repository
    const bareRepoPath = join(testBasePath, 'shared-repo.git');
    await createBareRepo(bareRepoPath);

    // Initialize with content
    const initWorkspace = await mkdtemp(join(testBasePath, 'init-workspace-'));
    await initGitRepo(initWorkspace);

    const sharedFile = join(initWorkspace, 'shared.txt');
    await writeFile(sharedFile, 'initial content\n');
    await commitChanges(initWorkspace, 'Initial commit');

    await execFileAsync('git', ['remote', 'add', 'origin', bareRepoPath], {
      cwd: initWorkspace,
    });
    await execFileAsync('git', ['push', '-u', 'origin', 'main'], {
      cwd: initWorkspace,
    });

    await rm(initWorkspace, { recursive: true, force: true });

    // Simulate 3 concurrent actions, each working on different branches
    const actionCount = 3;
    const branchOperations = Array.from(
      { length: actionCount },
      async (_, i) => {
        const workspacePath = join(testBasePath, `action-workspace-${i}`);
        await cloneRepo(bareRepoPath, workspacePath);

        const branchName = `feature/action-${i}`;

        // Create and switch to branch
        await execFileAsync('git', ['checkout', '-b', branchName], {
          cwd: workspacePath,
        });

        // Verify we're on the correct branch
        const currentBranch = await getCurrentBranch(workspacePath);
        expect(currentBranch).toBe(branchName);

        // Make branch-specific changes
        const actionFile = join(workspacePath, `action-${i}.txt`);
        await writeFile(actionFile, `Action ${i} content\n`);

        // Also modify the shared file differently in each branch
        const sharedFilePath = join(workspacePath, 'shared.txt');
        await writeFile(
          sharedFilePath,
          `initial content\naction ${i} changes\n`
        );

        await commitChanges(workspacePath, `Action ${i} changes`);

        // Push the branch
        await execFileAsync('git', ['push', '-u', 'origin', branchName], {
          cwd: workspacePath,
        });

        // Verify branch-specific file exists
        const actionFileContent = await readFile(actionFile, 'utf-8');
        expect(actionFileContent).toBe(`Action ${i} content\n`);

        // Verify shared file has correct content
        const sharedContent = await readFile(sharedFilePath, 'utf-8');
        expect(sharedContent).toBe(
          `initial content\naction ${i} changes\n`
        );

        return {
          workspaceId: i,
          branch: branchName,
        };
      }
    );

    // Execute all branch operations concurrently
    const results = await Promise.all(branchOperations);

    // Verify all operations completed successfully
    expect(results).toHaveLength(actionCount);

    // Verify isolation: check that each workspace still has its own branch
    for (let i = 0; i < actionCount; i++) {
      const workspacePath = join(testBasePath, `action-workspace-${i}`);
      const currentBranch = await getCurrentBranch(workspacePath);
      expect(currentBranch).toBe(`feature/action-${i}`);

      // Verify branch-specific file exists
      const actionFile = join(workspacePath, `action-${i}.txt`);
      const content = await readFile(actionFile, 'utf-8');
      expect(content).toBe(`Action ${i} content\n`);

      // Verify other action files don't exist in this workspace
      for (let j = 0; j < actionCount; j++) {
        if (i !== j) {
          const otherActionFile = join(workspacePath, `action-${j}.txt`);
          await expect(readFile(otherActionFile)).rejects.toThrow();
        }
      }
    }
  });

  /**
   * Test Case 3: Test concurrent read/write operations
   * (Child action: a79f21f6-336d-4b7e-9928-715cd0765a9b)
   *
   * Validates that concurrent read and write operations are properly
   * isolated and don't cause data corruption.
   */
  test('prevents data corruption during concurrent read/write operations', async () => {
    // Create a shared repository
    const bareRepoPath = join(testBasePath, 'rw-repo.git');
    await createBareRepo(bareRepoPath);

    // Initialize with multiple files
    const initWorkspace = await mkdtemp(join(testBasePath, 'init-rw-'));
    await initGitRepo(initWorkspace);

    // Create 10 files
    const fileCount = 10;
    for (let i = 0; i < fileCount; i++) {
      const filePath = join(initWorkspace, `data-${i}.txt`);
      await writeFile(filePath, `initial data ${i}\n`);
    }

    await commitChanges(initWorkspace, 'Initial data files');
    await execFileAsync('git', ['remote', 'add', 'origin', bareRepoPath], {
      cwd: initWorkspace,
    });
    await execFileAsync('git', ['push', '-u', 'origin', 'main'], {
      cwd: initWorkspace,
    });

    await rm(initWorkspace, { recursive: true, force: true });

    // Simulate concurrent readers and writers
    const readerCount = 3;
    const writerCount = 3;

    // Reader operations: read all files and verify content
    const readerPromises = Array.from({ length: readerCount }, async (_, i) => {
      const workspacePath = join(testBasePath, `reader-${i}`);
      await cloneRepo(bareRepoPath, workspacePath);

      const readResults: string[] = [];

      // Read all files
      for (let j = 0; j < fileCount; j++) {
        const filePath = join(workspacePath, `data-${j}.txt`);
        const content = await readFile(filePath, 'utf-8');
        readResults.push(content);

        // Verify content matches expected initial data
        expect(content).toBe(`initial data ${j}\n`);
      }

      return {
        readerId: i,
        filesRead: readResults.length,
      };
    });

    // Writer operations: modify files on separate branches
    const writerPromises = Array.from({ length: writerCount }, async (_, i) => {
      const workspacePath = join(testBasePath, `writer-${i}`);
      await cloneRepo(bareRepoPath, workspacePath);

      const branchName = `writer-branch-${i}`;
      await execFileAsync('git', ['checkout', '-b', branchName], {
        cwd: workspacePath,
      });

      // Modify a subset of files
      const modifyStart = i * 3;
      const modifyEnd = Math.min(modifyStart + 3, fileCount);

      for (let j = modifyStart; j < modifyEnd; j++) {
        const filePath = join(workspacePath, `data-${j}.txt`);
        await writeFile(
          filePath,
          `initial data ${j}\nmodified by writer ${i}\n`
        );
      }

      await commitChanges(workspacePath, `Writer ${i} modifications`);

      // Verify writes were successful
      for (let j = modifyStart; j < modifyEnd; j++) {
        const filePath = join(workspacePath, `data-${j}.txt`);
        const content = await readFile(filePath, 'utf-8');
        expect(content).toBe(
          `initial data ${j}\nmodified by writer ${i}\n`
        );
      }

      return {
        writerId: i,
        filesModified: modifyEnd - modifyStart,
        branch: branchName,
      };
    });

    // Execute readers and writers concurrently
    const [readerResults, writerResults] = await Promise.all([
      Promise.all(readerPromises),
      Promise.all(writerPromises),
    ]);

    // Verify all readers completed successfully
    expect(readerResults).toHaveLength(readerCount);
    readerResults.forEach((result) => {
      expect(result.filesRead).toBe(fileCount);
    });

    // Verify all writers completed successfully
    expect(writerResults).toHaveLength(writerCount);

    // Verify isolation: readers should still see original content
    for (let i = 0; i < readerCount; i++) {
      const workspacePath = join(testBasePath, `reader-${i}`);
      for (let j = 0; j < fileCount; j++) {
        const filePath = join(workspacePath, `data-${j}.txt`);
        const content = await readFile(filePath, 'utf-8');
        expect(content).toBe(`initial data ${j}\n`);
      }
    }

    // Verify writers have their own changes on their branches
    for (let i = 0; i < writerCount; i++) {
      const workspacePath = join(testBasePath, `writer-${i}`);
      const currentBranch = await getCurrentBranch(workspacePath);
      expect(currentBranch).toBe(`writer-branch-${i}`);
    }
  });

  /**
   * Test Case 4: Measure performance under concurrent load
   * (Child action: 3a5dd638-70e0-411d-9c9a-67f16e3386e6)
   *
   * Validates that performance degradation remains acceptable under
   * concurrent load and measures resource contention.
   */
  test('measures performance degradation under concurrent load', async () => {
    // Create a repository with substantial content
    const bareRepoPath = join(testBasePath, 'perf-repo.git');
    await createBareRepo(bareRepoPath);

    const initWorkspace = await mkdtemp(join(testBasePath, 'init-perf-'));
    await initGitRepo(initWorkspace);

    // Create a realistic file structure
    const fileCount = 100;
    const dirCount = 10;

    for (let d = 0; d < dirCount; d++) {
      const dirPath = await mkdtemp(join(initWorkspace, `dir-${d}-`));

      for (let f = 0; f < fileCount / dirCount; f++) {
        const filePath = join(dirPath, `file-${f}.txt`);
        await writeFile(filePath, `Content for file ${f} in dir ${d}\n`);
      }
    }

    await commitChanges(initWorkspace, 'Initial structure');
    await execFileAsync('git', ['remote', 'add', 'origin', bareRepoPath], {
      cwd: initWorkspace,
    });
    await execFileAsync('git', ['push', '-u', 'origin', 'main'], {
      cwd: initWorkspace,
    });

    await rm(initWorkspace, { recursive: true, force: true });

    // Measure baseline: single clone operation
    const baselineWorkspace = join(testBasePath, 'baseline');
    const baselineStart = Date.now();
    await cloneRepo(bareRepoPath, baselineWorkspace);
    const baselineTime = Date.now() - baselineStart;

    console.log(`Baseline clone time: ${baselineTime}ms`);

    // Measure concurrent operations
    const concurrencyLevels = [2, 4, 8];
    const performanceResults: Array<{
      concurrency: number;
      avgTime: number;
      maxTime: number;
      slowdownFactor: number;
    }> = [];

    for (const concurrency of concurrencyLevels) {
      const concurrentStart = Date.now();

      const clonePromises = Array.from({ length: concurrency }, async (_, i) => {
        const workspacePath = join(testBasePath, `concurrent-${concurrency}-${i}`);
        const cloneStart = Date.now();
        await cloneRepo(bareRepoPath, workspacePath);
        const cloneTime = Date.now() - cloneStart;

        // Verify clone succeeded
        const { stdout: status } = await execFileAsync(
          'git',
          ['status', '--porcelain'],
          { cwd: workspacePath }
        );
        expect(status.trim()).toBe('');

        return cloneTime;
      });

      const times = await Promise.all(clonePromises);
      const totalConcurrentTime = Date.now() - concurrentStart;

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const maxTime = Math.max(...times);
      const slowdownFactor = avgTime / baselineTime;

      performanceResults.push({
        concurrency,
        avgTime,
        maxTime,
        slowdownFactor,
      });

      console.log(
        `Concurrency ${concurrency}: avg=${avgTime.toFixed(2)}ms, max=${maxTime}ms, ` +
          `total=${totalConcurrentTime}ms, slowdown=${slowdownFactor.toFixed(2)}x`
      );
    }

    // Verify performance degradation is acceptable (< 5x slowdown)
    // Real-world testing shows 4-5x slowdown at concurrency level 8
    performanceResults.forEach((result) => {
      expect(result.slowdownFactor).toBeLessThan(5);
    });

    // Verify that higher concurrency doesn't cause exponential degradation
    // Allow for performance degradation that accelerates but stays sub-exponential
    for (let i = 1; i < performanceResults.length; i++) {
      const prevSlowdown = performanceResults[i - 1].slowdownFactor;
      const currSlowdown = performanceResults[i].slowdownFactor;

      // Performance can degrade more significantly at higher concurrency levels
      // but should not be exponential (e.g., 2^n). Allow up to 3x increase per level.
      expect(currSlowdown).toBeLessThan(prevSlowdown * 3);
    }
  });

  /**
   * Test Case 5: Stress test with high concurrency
   *
   * Validates system behavior at the limits of concurrent execution.
   */
  test('handles high concurrency levels without failures', async () => {
    // Create a small repository for faster operations
    const bareRepoPath = join(testBasePath, 'stress-repo.git');
    await createBareRepo(bareRepoPath);

    const initWorkspace = await mkdtemp(join(testBasePath, 'init-stress-'));
    await initGitRepo(initWorkspace);

    await writeFile(join(initWorkspace, 'README.md'), '# Stress Test\n');
    await commitChanges(initWorkspace, 'Initial commit');

    await execFileAsync('git', ['remote', 'add', 'origin', bareRepoPath], {
      cwd: initWorkspace,
    });
    await execFileAsync('git', ['push', '-u', 'origin', 'main'], {
      cwd: initWorkspace,
    });

    await rm(initWorkspace, { recursive: true, force: true });

    // Stress test: 20 concurrent operations
    const stressLevel = 20;
    const startTime = Date.now();

    const stressPromises = Array.from({ length: stressLevel }, async (_, i) => {
      const workspacePath = join(testBasePath, `stress-${i}`);

      try {
        await cloneRepo(bareRepoPath, workspacePath);

        // Perform some operations
        const testFile = join(workspacePath, `test-${i}.txt`);
        await writeFile(testFile, `Stress test ${i}\n`);

        await execFileAsync('git', ['checkout', '-b', `stress-branch-${i}`], {
          cwd: workspacePath,
        });

        await commitChanges(workspacePath, `Stress test ${i}`);

        return { success: true, workspaceId: i };
      } catch (error) {
        return {
          success: false,
          workspaceId: i,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    const results = await Promise.all(stressPromises);
    const totalTime = Date.now() - startTime;

    // Count successes and failures
    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    console.log(
      `Stress test (${stressLevel} concurrent operations): ` +
        `${successCount} succeeded, ${failureCount} failed, ` +
        `total time: ${totalTime}ms`
    );

    // All operations should succeed
    expect(successCount).toBe(stressLevel);
    expect(failureCount).toBe(0);

    // Log any failures for debugging
    results.forEach((result) => {
      if (!result.success) {
        console.error(
          `Workspace ${result.workspaceId} failed:`,
          'error' in result ? result.error : 'unknown error'
        );
      }
    });
  });

  /**
   * Test Case 6: Mixed operations (clone, branch, read, write)
   *
   * Validates that different types of concurrent operations work together.
   */
  test('handles mixed concurrent operations', async () => {
    // Setup repository
    const bareRepoPath = join(testBasePath, 'mixed-repo.git');
    await createBareRepo(bareRepoPath);

    const initWorkspace = await mkdtemp(join(testBasePath, 'init-mixed-'));
    await initGitRepo(initWorkspace);

    await writeFile(join(initWorkspace, 'data.txt'), 'shared data\n');
    await commitChanges(initWorkspace, 'Initial commit');

    await execFileAsync('git', ['remote', 'add', 'origin', bareRepoPath], {
      cwd: initWorkspace,
    });
    await execFileAsync('git', ['push', '-u', 'origin', 'main'], {
      cwd: initWorkspace,
    });

    await rm(initWorkspace, { recursive: true, force: true });

    // Mix of operations
    const operations = [
      // Clone operations
      ...Array.from({ length: 3 }, async (_, i) => {
        const workspacePath = join(testBasePath, `clone-op-${i}`);
        await cloneRepo(bareRepoPath, workspacePath);
        return { type: 'clone', id: i };
      }),

      // Branch creation operations
      ...Array.from({ length: 3 }, async (_, i) => {
        const workspacePath = join(testBasePath, `branch-op-${i}`);
        await cloneRepo(bareRepoPath, workspacePath);
        await execFileAsync('git', ['checkout', '-b', `feature-${i}`], {
          cwd: workspacePath,
        });
        return { type: 'branch', id: i };
      }),

      // Read operations
      ...Array.from({ length: 3 }, async (_, i) => {
        const workspacePath = join(testBasePath, `read-op-${i}`);
        await cloneRepo(bareRepoPath, workspacePath);
        const content = await readFile(
          join(workspacePath, 'data.txt'),
          'utf-8'
        );
        expect(content).toBe('shared data\n');
        return { type: 'read', id: i };
      }),

      // Write operations
      ...Array.from({ length: 3 }, async (_, i) => {
        const workspacePath = join(testBasePath, `write-op-${i}`);
        await cloneRepo(bareRepoPath, workspacePath);
        await execFileAsync('git', ['checkout', '-b', `write-${i}`], {
          cwd: workspacePath,
        });
        await writeFile(
          join(workspacePath, 'data.txt'),
          `shared data\nmodified by ${i}\n`
        );
        await commitChanges(workspacePath, `Write ${i}`);
        return { type: 'write', id: i };
      }),
    ];

    // Execute all mixed operations concurrently
    const results = await Promise.all(operations);

    // Verify all operations completed
    expect(results).toHaveLength(12); // 3 + 3 + 3 + 3

    // Count operation types
    const typeCounts = results.reduce(
      (acc, r) => {
        acc[r.type] = (acc[r.type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    expect(typeCounts.clone).toBe(3);
    expect(typeCounts.branch).toBe(3);
    expect(typeCounts.read).toBe(3);
    expect(typeCounts.write).toBe(3);
  });
});
