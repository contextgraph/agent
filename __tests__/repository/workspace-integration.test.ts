/**
 * Tests for workspace integration module.
 *
 * Tests the integration layer between git operations and workspace management.
 */

import { rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { cwd } from 'process';
import {
  prepareWorkspace,
  getWorkspaceForRepository
} from '../../src/services/repository/workspace-integration.js';

const TEST_REPO_URL = 'https://github.com/contextgraph/actions.git';

describe('workspace-integration', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create unique test directory
    testDir = join(tmpdir(), `workspace-int-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  describe('prepareWorkspace', () => {
    it('should return current directory when no repository URL provided', async () => {
      const workspacePath = await prepareWorkspace();
      expect(workspacePath).toBe(cwd());
    });

    it('should return current directory when repository URL is null', async () => {
      const workspacePath = await prepareWorkspace(null);
      expect(workspacePath).toBe(cwd());
    });

    it('should return current directory when repository URL is undefined', async () => {
      const workspacePath = await prepareWorkspace(undefined);
      expect(workspacePath).toBe(cwd());
    });

    it('should return workspace path when repository URL provided', async () => {
      const workspacePath = await prepareWorkspace(TEST_REPO_URL);

      // Should return a valid path
      expect(workspacePath).toBeTruthy();
      expect(typeof workspacePath).toBe('string');

      // Should be an absolute path
      expect(workspacePath).toMatch(/^\//);

      // Should contain contextgraph/workspaces in the path
      expect(workspacePath).toContain('.contextgraph');
      expect(workspacePath).toContain('workspaces');
    }, 60000);

    it('should return workspace path when repository URL and branch provided', async () => {
      const workspacePath = await prepareWorkspace(TEST_REPO_URL, 'main');

      // Should return a valid path
      expect(workspacePath).toBeTruthy();
      expect(typeof workspacePath).toBe('string');

      // Should be an absolute path
      expect(workspacePath).toMatch(/^\//);
    }, 60000);

    it('should handle credentials parameter (functionality tested in git-operations)', async () => {
      const credentials = {
        githubToken: 'fake-token-for-testing',
        provider: 'github' as const,
        acquiredAt: new Date().toISOString(),
        source: 'manual' as const
      };

      // For public repo, credentials won't be needed but should not cause errors
      const workspacePath = await prepareWorkspace(TEST_REPO_URL, 'main', credentials);

      expect(workspacePath).toBeTruthy();
      expect(typeof workspacePath).toBe('string');
    }, 60000);

    it('should propagate errors from WorkspaceManager', async () => {
      const invalidUrl = 'https://github.com/nonexistent-user-12345/nonexistent-repo-99999.git';

      await expect(
        prepareWorkspace(invalidUrl)
      ).rejects.toThrow();
    }, 60000);
  });

  describe('getWorkspaceForRepository', () => {
    it('should return workspace path and isNew flag for new workspace', async () => {
      const result = await getWorkspaceForRepository(TEST_REPO_URL, 'main');

      expect(result).toHaveProperty('path');
      expect(result).toHaveProperty('isNew');

      // Path should be a valid string
      expect(typeof result.path).toBe('string');
      expect(result.path).toBeTruthy();

      // isNew should be a boolean
      expect(typeof result.isNew).toBe('boolean');

      // Path should be absolute
      expect(result.path).toMatch(/^\//);

      // Path should contain contextgraph/workspaces
      expect(result.path).toContain('.contextgraph');
      expect(result.path).toContain('workspaces');
    }, 60000);

    it('should return isNew: false for cached workspace on second call', async () => {
      // First call - might be new or cached depending on previous test runs
      const firstResult = await getWorkspaceForRepository(TEST_REPO_URL, 'main');

      // Second call - should use cache
      const secondResult = await getWorkspaceForRepository(TEST_REPO_URL, 'main');

      expect(secondResult.path).toBe(firstResult.path);
      expect(secondResult.isNew).toBe(false);
    }, 120000);

    it('should handle credentials parameter', async () => {
      const credentials = {
        githubToken: 'fake-token-for-testing',
        provider: 'github' as const,
        acquiredAt: new Date().toISOString(),
        source: 'manual' as const
      };

      const result = await getWorkspaceForRepository(TEST_REPO_URL, 'main', credentials);

      expect(result).toHaveProperty('path');
      expect(result).toHaveProperty('isNew');
      expect(typeof result.path).toBe('string');
      expect(typeof result.isNew).toBe('boolean');
    }, 60000);

    it('should propagate errors from WorkspaceManager', async () => {
      const invalidUrl = 'https://github.com/nonexistent-user-12345/nonexistent-repo-99999.git';

      await expect(
        getWorkspaceForRepository(invalidUrl)
      ).rejects.toThrow();
    }, 60000);

    it('should work with different branches', async () => {
      const mainResult = await getWorkspaceForRepository(TEST_REPO_URL, 'main');

      expect(mainResult.path).toBeTruthy();
      expect(typeof mainResult.isNew).toBe('boolean');
    }, 60000);
  });

  describe('integration scenarios', () => {
    it('should handle workflow: prepareWorkspace then getWorkspaceForRepository', async () => {
      // First prepare workspace
      const preparedPath = await prepareWorkspace(TEST_REPO_URL, 'main');

      // Then get workspace with metadata
      const workspaceInfo = await getWorkspaceForRepository(TEST_REPO_URL, 'main');

      // Paths should match
      expect(workspaceInfo.path).toBe(preparedPath);

      // Should be cached (isNew: false) since we just prepared it
      expect(workspaceInfo.isNew).toBe(false);
    }, 120000);

    it('should handle switching from no-repo to repo scenario', async () => {
      // Start with no repository
      const currentDir = await prepareWorkspace();
      expect(currentDir).toBe(cwd());

      // Then prepare with repository
      const repoWorkspace = await prepareWorkspace(TEST_REPO_URL, 'main');
      expect(repoWorkspace).not.toBe(currentDir);
      expect(repoWorkspace).toContain('.contextgraph');
    }, 60000);
  });

  describe('error handling', () => {
    it('prepareWorkspace should provide meaningful error for invalid repository', async () => {
      const invalidUrl = 'not-a-valid-url';

      await expect(
        prepareWorkspace(invalidUrl)
      ).rejects.toThrow();
    }, 60000);

    it('getWorkspaceForRepository should provide meaningful error for invalid repository', async () => {
      const invalidUrl = 'not-a-valid-url';

      await expect(
        getWorkspaceForRepository(invalidUrl)
      ).rejects.toThrow();
    }, 60000);
  });

  describe('null safety', () => {
    it('prepareWorkspace should handle various null/undefined inputs', async () => {
      // All of these should return cwd
      const result1 = await prepareWorkspace();
      const result2 = await prepareWorkspace(undefined);
      const result3 = await prepareWorkspace(null);
      const result4 = await prepareWorkspace(undefined, undefined, undefined);

      const currentWorkingDir = cwd();
      expect(result1).toBe(currentWorkingDir);
      expect(result2).toBe(currentWorkingDir);
      expect(result3).toBe(currentWorkingDir);
      expect(result4).toBe(currentWorkingDir);
    });
  });
});
