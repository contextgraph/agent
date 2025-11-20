/**
 * Tests for git operations module.
 *
 * Includes:
 * - Unit tests for URL validation and error handling
 * - Integration tests with real git clone operations (public repos)
 * - Mock tests for error scenarios
 */

import { rm, access, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import simpleGit, { SimpleGit } from 'simple-git';
import {
  cloneRepository,
  checkoutBranch,
  validateBranch
} from '../../src/services/repository/git-operations.js';

const TEST_REPO_URL = 'https://github.com/contextgraph/actions.git';
const NONEXISTENT_REPO_URL = 'https://github.com/nonexistent-user-12345/nonexistent-repo-99999.git';

describe('git-operations', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create unique test directory
    testDir = join(tmpdir(), `git-ops-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('cloneRepository', () => {
    it('should clone a public repository successfully', async () => {
      const targetDir = join(testDir, 'cloned-repo');

      await cloneRepository(TEST_REPO_URL, targetDir);

      // Verify repository was cloned
      await access(join(targetDir, '.git'));
      const git: SimpleGit = simpleGit(targetDir);
      const remotes = await git.getRemotes(true);
      expect(remotes).toHaveLength(1);
      expect(remotes[0].name).toBe('origin');
      expect(remotes[0].refs.fetch).toBe(TEST_REPO_URL);
    }, 60000);

    it('should clone with specific branch', async () => {
      const targetDir = join(testDir, 'cloned-repo-branch');

      // Clone main branch specifically
      await cloneRepository(TEST_REPO_URL, targetDir, 'main');

      // Verify correct branch is checked out
      const git: SimpleGit = simpleGit(targetDir);
      const status = await git.status();
      expect(status.current).toBe('main');
    }, 60000);

    it('should fail gracefully for nonexistent repository', async () => {
      const targetDir = join(testDir, 'nonexistent-repo');

      await expect(
        cloneRepository(NONEXISTENT_REPO_URL, targetDir)
      ).rejects.toThrow(/Failed to clone repository/);
    }, 60000);

    it('should fail gracefully for invalid branch', async () => {
      const targetDir = join(testDir, 'invalid-branch-repo');

      await expect(
        cloneRepository(TEST_REPO_URL, targetDir, 'nonexistent-branch-12345')
      ).rejects.toThrow(/Failed to clone repository/);
    }, 60000);

    it('should handle clone with credentials (mocked)', async () => {
      const targetDir = join(testDir, 'cloned-with-creds');

      // This test uses a public repo so credentials aren't needed,
      // but it tests the code path with credentials
      const credentials = {
        githubToken: 'fake-token-for-testing',
        provider: 'github' as const,
        acquiredAt: new Date().toISOString(),
        source: 'manual' as const
      };

      // Should succeed even with fake token for public repo
      await cloneRepository(TEST_REPO_URL, targetDir, undefined, credentials);

      // Verify repository was cloned
      await access(join(targetDir, '.git'));
    }, 60000);
  });

  describe('validateBranch', () => {
    let repoDir: string;

    beforeEach(async () => {
      // Clone a repository for branch validation tests
      repoDir = join(testDir, 'repo-for-validation');
      await cloneRepository(TEST_REPO_URL, repoDir);
    });

    it('should return true for existing local branch', async () => {
      const exists = await validateBranch(repoDir, 'main');
      expect(exists).toBe(true);
    });

    it('should return false for nonexistent branch', async () => {
      const exists = await validateBranch(repoDir, 'nonexistent-branch-xyz-123');
      expect(exists).toBe(false);
    });

    it('should detect remote branches', async () => {
      const git: SimpleGit = simpleGit(repoDir);

      // Fetch all remote branches
      await git.fetch();

      // Get list of remote branches
      const branches = await git.branch(['-r']);

      // If there are any remote branches, test validation
      if (branches.all.length > 0) {
        // Extract branch name from 'origin/branch-name' format
        const remoteBranch = branches.all[0].replace('origin/', '');
        const exists = await validateBranch(repoDir, remoteBranch);
        expect(exists).toBe(true);
      }
    });

    it('should throw error for invalid repository path', async () => {
      await expect(
        validateBranch('/nonexistent/path', 'main')
      ).rejects.toThrow(/Failed to validate branch/);
    });
  });

  describe('checkoutBranch', () => {
    let repoDir: string;

    beforeEach(async () => {
      // Clone a repository for checkout tests
      repoDir = join(testDir, 'repo-for-checkout');
      await cloneRepository(TEST_REPO_URL, repoDir);
    });

    it('should checkout existing branch', async () => {
      const git: SimpleGit = simpleGit(repoDir);

      // Ensure we're on main first
      await git.checkout('main');

      // Create a new branch to test checkout
      await git.checkoutLocalBranch('test-branch');
      await git.checkout('main');

      // Now test our checkoutBranch function
      await checkoutBranch(repoDir, 'test-branch');

      const status = await git.status();
      expect(status.current).toBe('test-branch');
    });

    it('should fail for nonexistent branch', async () => {
      await expect(
        checkoutBranch(repoDir, 'nonexistent-branch-xyz-123')
      ).rejects.toThrow(/does not exist/);
    });

    it('should handle detached HEAD state', async () => {
      const git: SimpleGit = simpleGit(repoDir);

      // Get a commit hash to create detached HEAD
      const log = await git.log();
      const commitHash = log.latest?.hash;

      if (commitHash) {
        // Checkout commit to create detached HEAD
        await git.checkout(commitHash);

        // Verify we're in detached state
        const status = await git.status();
        expect(status.detached).toBe(true);

        // Now checkout a branch from detached state
        await checkoutBranch(repoDir, 'main');

        // Verify we're back on main
        const newStatus = await git.status();
        expect(newStatus.current).toBe('main');
        expect(newStatus.detached).toBe(false);
      }
    });

    it('should create local tracking branch for remote branch', async () => {
      const git: SimpleGit = simpleGit(repoDir);

      // Fetch all remote branches
      await git.fetch();

      // Get remote branches
      const remoteBranches = await git.branch(['-r']);

      // Find a remote branch that doesn't exist locally
      const remoteBranch = remoteBranches.all
        .filter(b => !b.includes('HEAD'))
        .map(b => b.replace('origin/', ''))
        .find(async (branchName) => {
          const localBranches = await git.branchLocal();
          return !localBranches.all.includes(branchName);
        });

      if (remoteBranch) {
        // Delete local branch if it exists
        const localBranches = await git.branchLocal();
        if (localBranches.all.includes(remoteBranch)) {
          await git.deleteLocalBranch(remoteBranch, true);
        }

        // Checkout should create local tracking branch
        await checkoutBranch(repoDir, remoteBranch);

        const status = await git.status();
        expect(status.current).toBe(remoteBranch);
      }
    }, 60000);

    it('should throw error for invalid repository path', async () => {
      await expect(
        checkoutBranch('/nonexistent/path', 'main')
      ).rejects.toThrow(/Failed to checkout branch/);
    });
  });

  describe('error handling', () => {
    it('cloneRepository should provide clear error messages', async () => {
      const targetDir = join(testDir, 'error-test');

      try {
        await cloneRepository(NONEXISTENT_REPO_URL, targetDir);
        fail('Should have thrown an error');
      } catch (error) {
        const err = error as Error;
        expect(err.message).toContain('Failed to clone repository');
        expect(err.message).toContain(NONEXISTENT_REPO_URL);
        expect(err.message).toContain(targetDir);
      }
    }, 60000);

    it('checkoutBranch should provide clear error messages', async () => {
      const repoDir = join(testDir, 'repo-for-error');
      await cloneRepository(TEST_REPO_URL, repoDir);

      try {
        await checkoutBranch(repoDir, 'nonexistent-branch-xyz');
        fail('Should have thrown an error');
      } catch (error) {
        const err = error as Error;
        expect(err.message).toContain('does not exist');
        expect(err.message).toContain('nonexistent-branch-xyz');
      }
    });

    it('validateBranch should provide clear error messages', async () => {
      try {
        await validateBranch('/totally/invalid/path', 'main');
        fail('Should have thrown an error');
      } catch (error) {
        const err = error as Error;
        expect(err.message).toContain('Failed to validate branch');
        expect(err.message).toContain('main');
      }
    });
  });

  describe('integration scenarios', () => {
    it('should handle full clone and checkout workflow', async () => {
      const repoDir = join(testDir, 'full-workflow');

      // Clone repository
      await cloneRepository(TEST_REPO_URL, repoDir);

      // Verify main branch
      const mainExists = await validateBranch(repoDir, 'main');
      expect(mainExists).toBe(true);

      // Checkout main
      await checkoutBranch(repoDir, 'main');

      const git: SimpleGit = simpleGit(repoDir);
      const status = await git.status();
      expect(status.current).toBe('main');
    }, 60000);
  });
});
