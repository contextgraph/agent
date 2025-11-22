/**
 * Integration Tests for Execute Workflow
 *
 * Validates the complete execute workflow with repository context, including:
 * - Repository-based execution with workspace preparation
 * - Inherited repository context from parent actions
 * - Fallback to current directory when no repository
 * - Error scenarios with meaningful messages
 * - Cleanup verification (success and failure cases)
 * - Performance validation (caching behavior)
 */

// Mock the SDK module before other imports
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn()
}));

import { rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { cwd } from 'process';
import { runExecute } from '../../src/workflows/execute.js';
import * as credentialsModule from '../../src/credentials.js';
import * as apiClientModule from '../../src/api-client.js';
import * as claudeCliModule from '../../src/claude-cli.js';
import * as repositoryManagerModule from '../../src/repository-manager.js';
import type { ActionDetailResource } from '../../src/types/actions.js';

const TEST_REPO_URL = 'https://github.com/contextgraph/actions.git';
const TEST_ACTION_ID = 'test-action-id-123';

// Mock credentials
const mockCredentials = {
  clerkToken: 'mock-clerk-token',
  userId: 'mock-user-id',
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  createdAt: new Date().toISOString(),
};

const mockGitCredentials = {
  githubToken: 'ghp_mock_token',
  provider: 'github' as const,
  acquiredAt: new Date().toISOString(),
  source: 'manual' as const,
};

describe('Execute Workflow Integration Tests', () => {
  let testDir: string;
  let cleanupFn: jest.Mock;
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let consoleLogs: string[];
  let consoleErrors: string[];

  beforeEach(async () => {
    // Create unique test directory
    testDir = join(tmpdir(), `execute-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });

    // Mock cleanup function
    cleanupFn = jest.fn().mockResolvedValue(undefined);

    // Capture console output
    consoleLogs = [];
    consoleErrors = [];
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    console.log = jest.fn((...args) => {
      consoleLogs.push(args.map(String).join(' '));
    });
    console.error = jest.fn((...args) => {
      consoleErrors.push(args.map(String).join(' '));
    });

    // Mock credentials
    jest.spyOn(credentialsModule, 'loadCredentials').mockResolvedValue(mockCredentials);
    jest.spyOn(credentialsModule, 'isExpired').mockReturnValue(false);
    jest.spyOn(credentialsModule, 'isTokenExpired').mockReturnValue(false);
    jest.spyOn(credentialsModule, 'loadGitCredentials').mockResolvedValue(mockGitCredentials);

    // Mock Claude CLI
    jest.spyOn(claudeCliModule, 'spawnClaude').mockResolvedValue({ exitCode: 0 });

    // Mock global fetch for execute prompt
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ prompt: 'Test execution prompt' }),
      text: async () => 'OK',
    } as Response);
  });

  afterEach(async () => {
    // Restore console
    console.log = originalConsoleLog;
    console.error = originalConsoleError;

    // Clean up test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    // Restore all mocks
    jest.restoreAllMocks();
  });

  describe('1. Repository-based execution', () => {
    it('should execute action with repository_url and prepare workspace', async () => {
      // Mock action with repository context
      const mockAction: ActionDetailResource = {
        id: TEST_ACTION_ID,
        title: 'Test Action',
        description: 'Test description',
        vision: 'Test vision',
        done: false,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        repository_url: TEST_REPO_URL,
        resolved_repository_url: TEST_REPO_URL,
        branch: 'main',
        resolved_branch: 'main',
        parent_chain: [],
        children: [],
        dependencies: [],
        dependents: [],
        siblings: [],
        relationship_flags: {},
        dependency_completion_context: [],
      };

      jest.spyOn(apiClientModule.ApiClient.prototype, 'getActionDetail').mockResolvedValue(mockAction);

      // Mock repository workspace preparation
      jest.spyOn(repositoryManagerModule, 'prepareRepositoryWorkspace').mockResolvedValue({
        workspacePath: testDir,
        cleanup: cleanupFn,
      });

      // Execute
      await runExecute(TEST_ACTION_ID);

      // Verify workspace was prepared with correct parameters
      expect(repositoryManagerModule.prepareRepositoryWorkspace).toHaveBeenCalledWith(
        TEST_REPO_URL,
        'main',
        mockGitCredentials
      );

      // Verify Claude spawned in correct workspace
      expect(claudeCliModule.spawnClaude).toHaveBeenCalledWith({
        prompt: 'Test execution prompt',
        cwd: testDir,
        gitCredentials: mockGitCredentials,
      });

      // Verify cleanup was called
      expect(cleanupFn).toHaveBeenCalled();
    }, 60000);

    it('should checkout correct branch when specified', async () => {
      const mockAction: ActionDetailResource = {
        id: TEST_ACTION_ID,
        title: 'Test Action',
        done: false,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        repository_url: TEST_REPO_URL,
        resolved_repository_url: TEST_REPO_URL,
        branch: 'feature/test-branch',
        resolved_branch: 'feature/test-branch',
        parent_chain: [],
        children: [],
        dependencies: [],
        dependents: [],
        siblings: [],
        relationship_flags: {},
        dependency_completion_context: [],
      };

      jest.spyOn(apiClientModule.ApiClient.prototype, 'getActionDetail').mockResolvedValue(mockAction);
      jest.spyOn(repositoryManagerModule, 'prepareRepositoryWorkspace').mockResolvedValue({
        workspacePath: testDir,
        cleanup: cleanupFn,
      });

      await runExecute(TEST_ACTION_ID);

      expect(repositoryManagerModule.prepareRepositoryWorkspace).toHaveBeenCalledWith(
        TEST_REPO_URL,
        'feature/test-branch',
        mockGitCredentials
      );
    }, 60000);
  });

  describe('2. Inherited repository context', () => {
    it('should inherit repository context from parent chain', async () => {
      const mockAction: ActionDetailResource = {
        id: TEST_ACTION_ID,
        title: 'Child Action',
        done: false,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        repository_url: null, // No direct repository
        resolved_repository_url: TEST_REPO_URL, // Inherited from parent
        branch: null, // No direct branch
        resolved_branch: 'main', // Inherited from parent
        parent_chain: [
          {
            id: 'parent-id',
            title: 'Parent Action',
            done: false,
            version: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            repository_url: TEST_REPO_URL,
            branch: 'main',
          },
        ],
        children: [],
        dependencies: [],
        dependents: [],
        siblings: [],
        relationship_flags: {},
        dependency_completion_context: [],
      };

      jest.spyOn(apiClientModule.ApiClient.prototype, 'getActionDetail').mockResolvedValue(mockAction);
      jest.spyOn(repositoryManagerModule, 'prepareRepositoryWorkspace').mockResolvedValue({
        workspacePath: testDir,
        cleanup: cleanupFn,
      });

      await runExecute(TEST_ACTION_ID);

      // Verify workspace was prepared with inherited context
      expect(repositoryManagerModule.prepareRepositoryWorkspace).toHaveBeenCalledWith(
        TEST_REPO_URL,
        'main',
        mockGitCredentials
      );
    }, 60000);

    it('should use resolved_repository_url over repository_url', async () => {
      const mockAction: ActionDetailResource = {
        id: TEST_ACTION_ID,
        title: 'Test Action',
        done: false,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        repository_url: 'https://github.com/old/repo.git',
        resolved_repository_url: TEST_REPO_URL,
        branch: 'old-branch',
        resolved_branch: 'main',
        parent_chain: [],
        children: [],
        dependencies: [],
        dependents: [],
        siblings: [],
        relationship_flags: {},
        dependency_completion_context: [],
      };

      jest.spyOn(apiClientModule.ApiClient.prototype, 'getActionDetail').mockResolvedValue(mockAction);
      jest.spyOn(repositoryManagerModule, 'prepareRepositoryWorkspace').mockResolvedValue({
        workspacePath: testDir,
        cleanup: cleanupFn,
      });

      await runExecute(TEST_ACTION_ID);

      // Should use resolved values
      expect(repositoryManagerModule.prepareRepositoryWorkspace).toHaveBeenCalledWith(
        TEST_REPO_URL,
        'main',
        mockGitCredentials
      );
    }, 60000);
  });

  describe('3. No repository fallback', () => {
    it('should use current directory when no repository context', async () => {
      const mockAction: ActionDetailResource = {
        id: TEST_ACTION_ID,
        title: 'Local Action',
        done: false,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        repository_url: null,
        resolved_repository_url: null,
        branch: null,
        resolved_branch: null,
        parent_chain: [],
        children: [],
        dependencies: [],
        dependents: [],
        siblings: [],
        relationship_flags: {},
        dependency_completion_context: [],
      };

      jest.spyOn(apiClientModule.ApiClient.prototype, 'getActionDetail').mockResolvedValue(mockAction);

      // Mock prepareRepositoryWorkspace to return cwd when no repo
      jest.spyOn(repositoryManagerModule, 'prepareRepositoryWorkspace').mockResolvedValue({
        workspacePath: cwd(),
        cleanup: cleanupFn,
      });

      await runExecute(TEST_ACTION_ID);

      // Verify workspace preparation was called with undefined (null converted via ?? operator)
      expect(repositoryManagerModule.prepareRepositoryWorkspace).toHaveBeenCalledWith(
        undefined,
        undefined,
        mockGitCredentials
      );

      // Verify Claude spawned in current directory
      expect(claudeCliModule.spawnClaude).toHaveBeenCalledWith({
        prompt: 'Test execution prompt',
        cwd: cwd(),
        gitCredentials: mockGitCredentials,
      });

      // Cleanup should still be called
      expect(cleanupFn).toHaveBeenCalled();
    }, 60000);
  });

  describe('4. Error scenarios', () => {
    it('should handle invalid repository URL with clear error', async () => {
      const mockAction: ActionDetailResource = {
        id: TEST_ACTION_ID,
        title: 'Test Action',
        done: false,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        repository_url: 'https://github.com/nonexistent/invalid-repo.git',
        resolved_repository_url: 'https://github.com/nonexistent/invalid-repo.git',
        branch: 'main',
        resolved_branch: 'main',
        parent_chain: [],
        children: [],
        dependencies: [],
        dependents: [],
        siblings: [],
        relationship_flags: {},
        dependency_completion_context: [],
      };

      jest.spyOn(apiClientModule.ApiClient.prototype, 'getActionDetail').mockResolvedValue(mockAction);

      // Mock repository preparation failure
      const cloneError = new Error('Repository not found');
      jest.spyOn(repositoryManagerModule, 'prepareRepositoryWorkspace').mockRejectedValue(cloneError);

      // Mock process.exit
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      // Execute and expect error
      await expect(runExecute(TEST_ACTION_ID)).rejects.toThrow();

      // Verify error was logged
      expect(consoleErrors.some(log => log.includes('Failed to prepare repository workspace'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(1);
    }, 60000);

    it('should handle missing credentials with helpful guidance', async () => {
      // Mock no credentials
      jest.spyOn(credentialsModule, 'loadCredentials').mockResolvedValue(null);

      // Mock process.exit
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      await expect(runExecute(TEST_ACTION_ID)).rejects.toThrow();

      expect(consoleErrors.some(log => log.includes('Not authenticated'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(1);
    }, 60000);

    it('should handle network failures with timeout error', async () => {
      const mockAction: ActionDetailResource = {
        id: TEST_ACTION_ID,
        title: 'Test Action',
        done: false,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        repository_url: TEST_REPO_URL,
        resolved_repository_url: TEST_REPO_URL,
        branch: 'main',
        resolved_branch: 'main',
        parent_chain: [],
        children: [],
        dependencies: [],
        dependents: [],
        siblings: [],
        relationship_flags: {},
        dependency_completion_context: [],
      };

      jest.spyOn(apiClientModule.ApiClient.prototype, 'getActionDetail').mockResolvedValue(mockAction);

      // Mock network error
      const networkError = new Error('Network timeout');
      jest.spyOn(repositoryManagerModule, 'prepareRepositoryWorkspace').mockRejectedValue(networkError);

      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      await expect(runExecute(TEST_ACTION_ID)).rejects.toThrow();

      expect(consoleErrors.some(log => log.includes('Failed to prepare repository workspace'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(1);
    }, 60000);

    it('should handle non-existent branch with error message', async () => {
      const mockAction: ActionDetailResource = {
        id: TEST_ACTION_ID,
        title: 'Test Action',
        done: false,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        repository_url: TEST_REPO_URL,
        resolved_repository_url: TEST_REPO_URL,
        branch: 'nonexistent-branch',
        resolved_branch: 'nonexistent-branch',
        parent_chain: [],
        children: [],
        dependencies: [],
        dependents: [],
        siblings: [],
        relationship_flags: {},
        dependency_completion_context: [],
      };

      jest.spyOn(apiClientModule.ApiClient.prototype, 'getActionDetail').mockResolvedValue(mockAction);

      const branchError = new Error('Branch not found: nonexistent-branch');
      jest.spyOn(repositoryManagerModule, 'prepareRepositoryWorkspace').mockRejectedValue(branchError);

      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      await expect(runExecute(TEST_ACTION_ID)).rejects.toThrow();

      expect(consoleErrors.some(log => log.includes('branch'))).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(1);
    }, 60000);
  });

  describe('5. Cleanup verification', () => {
    it('should cleanup workspace on successful execution', async () => {
      const mockAction: ActionDetailResource = {
        id: TEST_ACTION_ID,
        title: 'Test Action',
        done: false,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        repository_url: TEST_REPO_URL,
        resolved_repository_url: TEST_REPO_URL,
        branch: 'main',
        resolved_branch: 'main',
        parent_chain: [],
        children: [],
        dependencies: [],
        dependents: [],
        siblings: [],
        relationship_flags: {},
        dependency_completion_context: [],
      };

      jest.spyOn(apiClientModule.ApiClient.prototype, 'getActionDetail').mockResolvedValue(mockAction);
      jest.spyOn(repositoryManagerModule, 'prepareRepositoryWorkspace').mockResolvedValue({
        workspacePath: testDir,
        cleanup: cleanupFn,
      });

      await runExecute(TEST_ACTION_ID);

      expect(cleanupFn).toHaveBeenCalledTimes(1);
    }, 60000);

    it('should cleanup workspace even when execution fails', async () => {
      const mockAction: ActionDetailResource = {
        id: TEST_ACTION_ID,
        title: 'Test Action',
        done: false,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        repository_url: TEST_REPO_URL,
        resolved_repository_url: TEST_REPO_URL,
        branch: 'main',
        resolved_branch: 'main',
        parent_chain: [],
        children: [],
        dependencies: [],
        dependents: [],
        siblings: [],
        relationship_flags: {},
        dependency_completion_context: [],
      };

      jest.spyOn(apiClientModule.ApiClient.prototype, 'getActionDetail').mockResolvedValue(mockAction);
      jest.spyOn(repositoryManagerModule, 'prepareRepositoryWorkspace').mockResolvedValue({
        workspacePath: testDir,
        cleanup: cleanupFn,
      });

      // Mock Claude failure
      jest.spyOn(claudeCliModule, 'spawnClaude').mockResolvedValue({ exitCode: 1 });

      jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      await expect(runExecute(TEST_ACTION_ID)).rejects.toThrow();

      // Cleanup should still be called even on failure
      expect(cleanupFn).toHaveBeenCalledTimes(1);
    }, 60000);

    it('should cleanup workspace when Claude throws error', async () => {
      const mockAction: ActionDetailResource = {
        id: TEST_ACTION_ID,
        title: 'Test Action',
        done: false,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        repository_url: TEST_REPO_URL,
        resolved_repository_url: TEST_REPO_URL,
        branch: 'main',
        resolved_branch: 'main',
        parent_chain: [],
        children: [],
        dependencies: [],
        dependents: [],
        siblings: [],
        relationship_flags: {},
        dependency_completion_context: [],
      };

      jest.spyOn(apiClientModule.ApiClient.prototype, 'getActionDetail').mockResolvedValue(mockAction);
      jest.spyOn(repositoryManagerModule, 'prepareRepositoryWorkspace').mockResolvedValue({
        workspacePath: testDir,
        cleanup: cleanupFn,
      });

      // Mock Claude exception
      jest.spyOn(claudeCliModule, 'spawnClaude').mockRejectedValue(new Error('Claude crashed'));

      await expect(runExecute(TEST_ACTION_ID)).rejects.toThrow('Claude crashed');

      // Cleanup should still be called even on exception
      expect(cleanupFn).toHaveBeenCalledTimes(1);
    }, 60000);
  });

  describe('6. Performance validation', () => {
    it('should use cached workspace for second execution of same repo/branch', async () => {
      const mockAction: ActionDetailResource = {
        id: TEST_ACTION_ID,
        title: 'Test Action',
        done: false,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        repository_url: TEST_REPO_URL,
        resolved_repository_url: TEST_REPO_URL,
        branch: 'main',
        resolved_branch: 'main',
        parent_chain: [],
        children: [],
        dependencies: [],
        dependents: [],
        siblings: [],
        relationship_flags: {},
        dependency_completion_context: [],
      };

      jest.spyOn(apiClientModule.ApiClient.prototype, 'getActionDetail').mockResolvedValue(mockAction);

      // Track calls to workspace preparation
      const prepareWorkspaceSpy = jest.spyOn(repositoryManagerModule, 'prepareRepositoryWorkspace')
        .mockResolvedValue({
          workspacePath: testDir,
          cleanup: cleanupFn,
        });

      // First execution
      await runExecute(TEST_ACTION_ID);
      const firstCallCount = prepareWorkspaceSpy.mock.calls.length;

      // Second execution - should still call prepareWorkspace but workspace manager handles caching
      await runExecute(TEST_ACTION_ID);
      const secondCallCount = prepareWorkspaceSpy.mock.calls.length;

      // Both should call prepareRepositoryWorkspace (caching happens inside)
      expect(firstCallCount).toBe(1);
      expect(secondCallCount).toBe(2);

      // Both should have been called with the same parameters
      expect(prepareWorkspaceSpy.mock.calls[0]).toEqual(prepareWorkspaceSpy.mock.calls[1]);
    }, 120000);

    it('should handle different branches efficiently', async () => {
      const mockActionMain: ActionDetailResource = {
        id: TEST_ACTION_ID,
        title: 'Test Action Main',
        done: false,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        repository_url: TEST_REPO_URL,
        resolved_repository_url: TEST_REPO_URL,
        branch: 'main',
        resolved_branch: 'main',
        parent_chain: [],
        children: [],
        dependencies: [],
        dependents: [],
        siblings: [],
        relationship_flags: {},
        dependency_completion_context: [],
      };

      const mockActionFeature: ActionDetailResource = {
        ...mockActionMain,
        branch: 'feature/test',
        resolved_branch: 'feature/test',
      };

      const getActionSpy = jest.spyOn(apiClientModule.ApiClient.prototype, 'getActionDetail');
      jest.spyOn(repositoryManagerModule, 'prepareRepositoryWorkspace').mockResolvedValue({
        workspacePath: testDir,
        cleanup: cleanupFn,
      });

      // Execute with main branch
      getActionSpy.mockResolvedValue(mockActionMain);
      await runExecute(TEST_ACTION_ID);

      // Execute with different branch
      getActionSpy.mockResolvedValue(mockActionFeature);
      await runExecute(TEST_ACTION_ID);

      // Verify different branches were requested
      expect(repositoryManagerModule.prepareRepositoryWorkspace).toHaveBeenNthCalledWith(
        1,
        TEST_REPO_URL,
        'main',
        mockGitCredentials
      );
      expect(repositoryManagerModule.prepareRepositoryWorkspace).toHaveBeenNthCalledWith(
        2,
        TEST_REPO_URL,
        'feature/test',
        mockGitCredentials
      );
    }, 120000);
  });
});
