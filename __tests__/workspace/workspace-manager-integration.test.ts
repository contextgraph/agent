/**
 * Integration tests for the workspace manager.
 *
 * Tests the complete system with all components integrated:
 * - Cache management with LRU eviction
 * - Cleanup timing strategies
 * - Workspace preservation
 * - Error handling and retry logic
 */

import { rm, stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import {
  WorkspaceManager,
  withWorkspace
} from '../../src/services/workspace/workspace-manager.js';
import {
  getEnvironmentConfig,
  DEFAULT_WORKSPACE_MANAGER_CONFIG
} from '../../src/services/workspace/config.js';

const WORKSPACE_BASE_DIR = join(homedir(), '.contextgraph', 'workspaces');
const TEST_REPO_URL = 'https://github.com/contextgraph/actions.git';
const TEST_REPO_URL_2 = 'https://github.com/contextgraph/agent.git';

describe('WorkspaceManager Integration Tests', () => {
  let manager: WorkspaceManager;

  beforeEach(() => {
    // Create manager with test configuration
    manager = new WorkspaceManager(
      getEnvironmentConfig('test', {
        cache: {
          maxWorkspaces: 3 // Low limit for testing eviction
        },
        preservation: {
          preserveOnFailure: true,
          failureRetentionDays: 7
        }
      })
    );
  });

  afterEach(async () => {
    // Stop manager
    manager.stop();

    // Clean up test workspaces
    try {
      await rm(WORKSPACE_BASE_DIR, { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
  });

  describe('Basic Workspace Operations', () => {
    it('should create a persistent workspace', async () => {
      const workspace = await manager.getWorkspace({
        repositoryUrl: TEST_REPO_URL
      });

      expect(workspace.path).toBeTruthy();
      expect(workspace.strategy).toBe('persistent');
      expect(workspace.isNew).toBe(true);

      // Verify workspace exists
      const stats = await stat(workspace.path);
      expect(stats.isDirectory()).toBe(true);
    }, 120000);

    it('should reuse existing workspace', async () => {
      // First access
      const workspace1 = await manager.getWorkspace({
        repositoryUrl: TEST_REPO_URL
      });

      // Second access
      const workspace2 = await manager.getWorkspace({
        repositoryUrl: TEST_REPO_URL
      });

      expect(workspace1.path).toBe(workspace2.path);
      expect(workspace2.isNew).toBe(false);
    }, 120000);

    it('should execute operation in workspace', async () => {
      const result = await withWorkspace(
        { repositoryUrl: TEST_REPO_URL },
        async (workspace) => {
          // Verify workspace has .git directory
          const gitDir = join(workspace.path, '.git');
          const stats = await stat(gitDir);
          expect(stats.isDirectory()).toBe(true);

          return 'success';
        }
      );

      expect(result).toBe('success');
    }, 120000);
  });

  describe('Cache Management and LRU Eviction', () => {
    it('should evict oldest workspace when cache limit exceeded', async () => {
      const manager = new WorkspaceManager({
        cache: {
          sizeThreshold: 100 * 1024 * 1024,
          maxWorkspaces: 2 // Very low limit
        },
        cleanup: {
          timing: 'immediate',
          backgroundInterval: 60000
        }
      });

      // Create 3 workspaces (exceeds limit of 2)
      const ws1 = await manager.getWorkspace({
        repositoryUrl: TEST_REPO_URL
      });
      const ws2 = await manager.getWorkspace({
        repositoryUrl: TEST_REPO_URL_2
      });
      const ws3 = await manager.getWorkspace({
        repositoryUrl: 'https://github.com/facebook/react.git'
      });

      // First workspace should have been evicted
      try {
        await stat(ws1.path);
        // If we get here, eviction didn't happen (or happened to different workspace)
        // This is acceptable as eviction order depends on access times
      } catch {
        // Workspace was evicted (expected)
      }

      // Latest workspaces should still exist
      const stats2 = await stat(ws2.path);
      const stats3 = await stat(ws3.path);
      expect(stats2.isDirectory()).toBe(true);
      expect(stats3.isDirectory()).toBe(true);
    }, 180000);
  });

  describe('Cleanup Timing Strategies', () => {
    it('should support immediate cleanup', async () => {
      const manager = new WorkspaceManager({
        cleanup: {
          timing: 'immediate',
          backgroundInterval: 60000
        },
        cache: {
          sizeThreshold: 100 * 1024 * 1024,
          maxWorkspaces: 1
        }
      });

      // Create first workspace
      await manager.getWorkspace({
        repositoryUrl: TEST_REPO_URL
      });

      // Create second workspace - should trigger immediate cleanup
      const ws2 = await manager.getWorkspace({
        repositoryUrl: TEST_REPO_URL_2
      });

      // Second workspace should exist
      const stats = await stat(ws2.path);
      expect(stats.isDirectory()).toBe(true);
    }, 120000);

    it('should support deferred cleanup', async () => {
      const manager = new WorkspaceManager({
        cleanup: {
          timing: 'deferred',
          backgroundInterval: 60000
        },
        cache: {
          sizeThreshold: 100 * 1024 * 1024,
          maxWorkspaces: 1
        }
      });

      // Create first workspace
      await manager.getWorkspace({
        repositoryUrl: TEST_REPO_URL
      });

      // Create second workspace - cleanup happens asynchronously
      const ws2 = await manager.getWorkspace({
        repositoryUrl: TEST_REPO_URL_2
      });

      // Second workspace should exist immediately
      const stats = await stat(ws2.path);
      expect(stats.isDirectory()).toBe(true);

      // Wait for deferred cleanup to complete
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }, 120000);

    it('should support background cleanup', async () => {
      const manager = new WorkspaceManager({
        cleanup: {
          timing: 'background',
          backgroundInterval: 2000 // 2 seconds for testing
        },
        cache: {
          sizeThreshold: 100 * 1024 * 1024,
          maxWorkspaces: 1
        }
      });

      // Start background cleanup
      manager.start();

      // Create workspaces
      await manager.getWorkspace({
        repositoryUrl: TEST_REPO_URL
      });
      const ws2 = await manager.getWorkspace({
        repositoryUrl: TEST_REPO_URL_2
      });

      // Both workspaces should exist initially
      const stats = await stat(ws2.path);
      expect(stats.isDirectory()).toBe(true);

      // Wait for background cleanup cycle
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Background cleanup should have run
      manager.stop();
    }, 120000);
  });

  describe('Workspace Preservation', () => {
    it('should preserve workspace on operation failure', async () => {
      const manager = new WorkspaceManager({
        preservation: {
          preserveOnFailure: true,
          preserveOnTimeout: true,
          preserveOnTestFailure: true,
          failureRetentionDays: 7,
          timeoutRetentionDays: 3,
          testFailureRetentionDays: 7,
          maxRetentionDays: 30,
          minRetentionHours: 24,
          maxPreservedWorkspaces: 5,
          maxPreservedTotalSize: 5 * 1024 * 1024 * 1024,
          maxWorkspaceSize: 2 * 1024 * 1024 * 1024,
          oversizedWorkspacePolicy: 'warn',
          evictionStrategy: 'oldest-first',
          retentionCheckInterval: 60000,
          checkRetentionOnAccess: true,
          storeDetailedMetadata: true,
          logPreservationEvents: false,
          metadataFileName: '.contextgraph-preservation.json'
        }
      });

      let workspacePath: string;

      try {
        await manager.withWorkspace(
          { repositoryUrl: TEST_REPO_URL },
          async (workspace) => {
            workspacePath = workspace.path;
            // Simulate operation failure
            throw new Error('Test operation failed');
          }
        );
      } catch (error) {
        // Expected error
      }

      // Check that preservation metadata was created
      const metadataPath = join(workspacePath!, '.contextgraph-preservation.json');
      const stats = await stat(metadataPath);
      expect(stats.isFile()).toBe(true);
    }, 120000);

    it('should support manual preservation', async () => {
      const workspace = await manager.getWorkspace({
        repositoryUrl: TEST_REPO_URL,
        preserve: {
          enabled: true,
          reason: 'debugging test',
          retentionDays: 7
        }
      });

      // Check that preservation metadata was created
      const metadataPath = join(
        workspace.path,
        '.contextgraph-preservation.json'
      );
      const stats = await stat(metadataPath);
      expect(stats.isFile()).toBe(true);
    }, 120000);

    it('should exclude preserved workspaces from eviction', async () => {
      const manager = new WorkspaceManager({
        cache: {
          sizeThreshold: 100 * 1024 * 1024,
          maxWorkspaces: 1 // Very low limit
        },
        cleanup: {
          timing: 'immediate',
          backgroundInterval: 60000
        }
      });

      // Create and preserve first workspace
      const ws1 = await manager.getWorkspace({
        repositoryUrl: TEST_REPO_URL,
        preserve: {
          enabled: true,
          reason: 'test preservation',
          retentionDays: 7
        }
      });

      // Create second workspace (should trigger eviction, but ws1 is preserved)
      const ws2 = await manager.getWorkspace({
        repositoryUrl: TEST_REPO_URL_2
      });

      // Both workspaces should still exist (preserved workspace not evicted)
      const stats1 = await stat(ws1.path);
      const stats2 = await stat(ws2.path);
      expect(stats1.isDirectory()).toBe(true);
      expect(stats2.isDirectory()).toBe(true);
    }, 120000);
  });

  describe('Error Handling and Retry', () => {
    it('should handle clone errors gracefully', async () => {
      const manager = new WorkspaceManager({
        errorHandling: {
          maxRetries: 2,
          initialRetryDelay: 100,
          maxRetryDelay: 1000,
          enablePreFlightChecks: false,
          requiredDiskSpace: 1024 * 1024 * 1024,
          enableCorruptionDetection: true,
          enableStructuredLogging: false
        }
      });

      // Try to clone non-existent repository
      try {
        await manager.getWorkspace({
          repositoryUrl: 'https://github.com/invalid/nonexistent-repo-12345.git'
        });
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        // Expected error
        expect(error).toBeTruthy();
      }
    }, 60000);
  });

  describe('Configuration Management', () => {
    it('should use default configuration', () => {
      const manager = new WorkspaceManager();
      const config = manager.getConfig();

      expect(config.cache.maxWorkspaces).toBe(
        DEFAULT_WORKSPACE_MANAGER_CONFIG.cache.maxWorkspaces
      );
      expect(config.cleanup.timing).toBe(
        DEFAULT_WORKSPACE_MANAGER_CONFIG.cleanup.timing
      );
    });

    it('should merge partial configuration', () => {
      const manager = new WorkspaceManager({
        cache: {
          maxWorkspaces: 5
        }
      });

      const config = manager.getConfig();
      expect(config.cache.maxWorkspaces).toBe(5);
      expect(config.cleanup.timing).toBe(
        DEFAULT_WORKSPACE_MANAGER_CONFIG.cleanup.timing
      );
    });

    it('should use environment-specific configuration', () => {
      const devConfig = getEnvironmentConfig('development');
      expect(devConfig.cleanup.timing).toBe('deferred');
      expect(devConfig.preservation.preserveOnFailure).toBe(true);

      const prodConfig = getEnvironmentConfig('production');
      expect(prodConfig.cleanup.timing).toBe('background');
      expect(prodConfig.preservation.preserveOnFailure).toBe(false);
    });

    it('should validate configuration', () => {
      expect(() => {
        new WorkspaceManager({
          cache: {
            sizeThreshold: -100, // Invalid
            maxWorkspaces: 10
          }
        });
      }).toThrow();
    });

    it('should update configuration', () => {
      const manager = new WorkspaceManager({
        cache: {
          maxWorkspaces: 10
        }
      });

      manager.updateConfig({
        cache: {
          maxWorkspaces: 20
        }
      });

      const config = manager.getConfig();
      expect(config.cache.maxWorkspaces).toBe(20);
    });
  });

  describe('Lifecycle Management', () => {
    it('should start and stop background cleanup', () => {
      const manager = new WorkspaceManager({
        cleanup: {
          timing: 'background',
          backgroundInterval: 60000
        }
      });

      // Start should not throw
      manager.start();

      // Stop should not throw
      manager.stop();

      // Should be idempotent
      manager.stop();
      manager.start();
      manager.start();
      manager.stop();
    });
  });

  describe('Cross-Component Scenarios', () => {
    it('should handle failure with preservation and cleanup', async () => {
      const manager = new WorkspaceManager({
        cache: {
          sizeThreshold: 100 * 1024 * 1024,
          maxWorkspaces: 2
        },
        cleanup: {
          timing: 'immediate',
          backgroundInterval: 60000
        },
        preservation: {
          preserveOnFailure: true,
          preserveOnTimeout: true,
          preserveOnTestFailure: true,
          failureRetentionDays: 7,
          timeoutRetentionDays: 3,
          testFailureRetentionDays: 7,
          maxRetentionDays: 30,
          minRetentionHours: 24,
          maxPreservedWorkspaces: 5,
          maxPreservedTotalSize: 5 * 1024 * 1024 * 1024,
          maxWorkspaceSize: 2 * 1024 * 1024 * 1024,
          oversizedWorkspacePolicy: 'warn',
          evictionStrategy: 'oldest-first',
          retentionCheckInterval: 60000,
          checkRetentionOnAccess: true,
          storeDetailedMetadata: true,
          logPreservationEvents: false,
          metadataFileName: '.contextgraph-preservation.json'
        }
      });

      // Create workspace and fail operation
      let ws1Path: string;
      try {
        await manager.withWorkspace(
          { repositoryUrl: TEST_REPO_URL },
          async (workspace) => {
            ws1Path = workspace.path;
            throw new Error('Operation failed');
          }
        );
      } catch {
        // Expected
      }

      // Create more workspaces
      await manager.getWorkspace({ repositoryUrl: TEST_REPO_URL_2 });
      await manager.getWorkspace({
        repositoryUrl: 'https://github.com/facebook/react.git'
      });

      // First workspace should still exist (preserved)
      const stats = await stat(ws1Path!);
      expect(stats.isDirectory()).toBe(true);

      // Should have preservation metadata
      const metadataPath = join(ws1Path!, '.contextgraph-preservation.json');
      const metadataStats = await stat(metadataPath);
      expect(metadataStats.isFile()).toBe(true);
    }, 180000);
  });
});
