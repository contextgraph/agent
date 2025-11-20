/**
 * Tests for cleanup operations module.
 *
 * Tests the cleanup wrapper layer that delegates to WorkspaceManager.
 */

import { rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import {
  cleanupWorkspace,
  cleanupAllWorkspaces,
  getCleanupTiming,
  setCleanupTiming,
  CleanupTiming
} from '../../src/services/repository/cleanup.js';

const WORKSPACE_BASE_DIR = join(homedir(), '.contextgraph', 'workspaces');

describe('cleanup', () => {
  let testWorkspaceDir: string;

  beforeEach(async () => {
    // Create a test workspace directory within the actual workspace base dir
    testWorkspaceDir = join(
      WORKSPACE_BASE_DIR,
      `test-workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testWorkspaceDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test workspace
    try {
      await rm(testWorkspaceDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('cleanupWorkspace', () => {
    it('should accept a valid workspace path within base directory', async () => {
      await expect(
        cleanupWorkspace(testWorkspaceDir, { timing: 'deferred' })
      ).resolves.not.toThrow();
    });

    it('should reject workspace path outside base directory', async () => {
      const unsafePath = join(tmpdir(), 'unsafe-workspace');

      await expect(
        cleanupWorkspace(unsafePath, { timing: 'deferred' })
      ).rejects.toThrow('Unsafe workspace path');
    });

    it('should allow unsafe path when force=true', async () => {
      const unsafePath = join(tmpdir(), 'unsafe-workspace');

      // Should not throw with force=true
      await expect(
        cleanupWorkspace(unsafePath, { timing: 'deferred', force: true })
      ).resolves.not.toThrow();
    });

    it('should reject cleanup of base directory itself', async () => {
      await expect(
        cleanupWorkspace(WORKSPACE_BASE_DIR, { timing: 'deferred' })
      ).rejects.toThrow('Cannot cleanup base directory');
    });

    it('should use deferred timing by default', async () => {
      // Create a spy to capture console.log calls
      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      await cleanupWorkspace(testWorkspaceDir);

      // Verify timing was set to deferred
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('timing: deferred')
      );

      logSpy.mockRestore();
    });

    it('should accept immediate timing option', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      await cleanupWorkspace(testWorkspaceDir, { timing: 'immediate' });

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('timing: immediate')
      );

      logSpy.mockRestore();
    });

    it('should accept background timing option', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      await cleanupWorkspace(testWorkspaceDir, { timing: 'background' });

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('timing: background')
      );

      logSpy.mockRestore();
    });

    it('should handle preserveOnError option', async () => {
      await expect(
        cleanupWorkspace(testWorkspaceDir, {
          timing: 'deferred',
          preserveOnError: true
        })
      ).resolves.not.toThrow();
    });

    it('should handle custom config overrides', async () => {
      await expect(
        cleanupWorkspace(testWorkspaceDir, {
          timing: 'deferred',
          config: {
            cleanup: {
              backgroundInterval: 60000
            }
          }
        })
      ).resolves.not.toThrow();
    });

    it('should log cleanup operation', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      await cleanupWorkspace(testWorkspaceDir, { timing: 'immediate' });

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Cleanup] Cleaning workspace:')
      );

      logSpy.mockRestore();
    });

    it('should handle Windows-style paths', async () => {
      // Create a path with backslashes (Windows-style)
      const windowsStylePath = testWorkspaceDir.replace(/\//g, '\\');

      // Should work because validation normalizes paths
      await expect(
        cleanupWorkspace(windowsStylePath, { timing: 'deferred' })
      ).resolves.not.toThrow();
    });
  });

  describe('cleanupAllWorkspaces', () => {
    it('should trigger cleanup with default options', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      await cleanupAllWorkspaces();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Cleanup] Triggering cleanup for all workspaces')
      );

      logSpy.mockRestore();
    });

    it('should use deferred timing by default', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      await cleanupAllWorkspaces();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('timing: deferred')
      );

      logSpy.mockRestore();
    });

    it('should accept immediate timing option', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      await cleanupAllWorkspaces({ timing: 'immediate' });

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('timing: immediate')
      );

      logSpy.mockRestore();
    });

    it('should accept background timing option', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      await cleanupAllWorkspaces({ timing: 'background' });

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('timing: background')
      );

      logSpy.mockRestore();
    });

    it('should handle preserveOnError option', async () => {
      await expect(
        cleanupAllWorkspaces({
          timing: 'deferred',
          preserveOnError: true
        })
      ).resolves.not.toThrow();
    });

    it('should handle custom config overrides', async () => {
      await expect(
        cleanupAllWorkspaces({
          timing: 'background',
          config: {
            cleanup: {
              backgroundInterval: 10 * 60 * 1000 // 10 minutes
            },
            cache: {
              maxWorkspaces: 5
            }
          }
        })
      ).resolves.not.toThrow();
    });

    it('should log bulk cleanup configuration', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      await cleanupAllWorkspaces({ timing: 'immediate' });

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Cleanup] Bulk cleanup configured')
      );

      logSpy.mockRestore();
    });
  });

  describe('getCleanupTiming', () => {
    it('should return current cleanup timing', () => {
      const timing = getCleanupTiming();

      expect(timing).toBeDefined();
      expect(['immediate', 'deferred', 'background']).toContain(timing);
    });

    it('should return a valid CleanupTiming type', () => {
      const timing: CleanupTiming = getCleanupTiming();

      // This should compile without type errors
      expect(typeof timing).toBe('string');
    });
  });

  describe('setCleanupTiming', () => {
    const originalTiming = getCleanupTiming();

    afterEach(() => {
      // Restore original timing after each test
      setCleanupTiming(originalTiming);
    });

    it('should update cleanup timing to immediate', () => {
      setCleanupTiming('immediate');
      expect(getCleanupTiming()).toBe('immediate');
    });

    it('should update cleanup timing to deferred', () => {
      setCleanupTiming('deferred');
      expect(getCleanupTiming()).toBe('deferred');
    });

    it('should update cleanup timing to background', () => {
      setCleanupTiming('background');
      expect(getCleanupTiming()).toBe('background');
    });

    it('should log timing update', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      setCleanupTiming('immediate');

      expect(logSpy).toHaveBeenCalledWith(
        '[Cleanup] Updated cleanup timing to: immediate'
      );

      logSpy.mockRestore();
    });

    it('should persist timing across multiple calls', () => {
      setCleanupTiming('background');
      expect(getCleanupTiming()).toBe('background');

      // Call get multiple times
      expect(getCleanupTiming()).toBe('background');
      expect(getCleanupTiming()).toBe('background');
    });

    it('should allow switching between timing strategies', () => {
      setCleanupTiming('immediate');
      expect(getCleanupTiming()).toBe('immediate');

      setCleanupTiming('deferred');
      expect(getCleanupTiming()).toBe('deferred');

      setCleanupTiming('background');
      expect(getCleanupTiming()).toBe('background');
    });
  });

  describe('integration scenarios', () => {
    it('should handle cleanup with preservation enabled', async () => {
      await expect(
        cleanupWorkspace(testWorkspaceDir, {
          timing: 'immediate',
          preserveOnError: true
        })
      ).resolves.not.toThrow();
    });

    it('should handle cleanup with preservation disabled', async () => {
      await expect(
        cleanupWorkspace(testWorkspaceDir, {
          timing: 'immediate',
          preserveOnError: false
        })
      ).resolves.not.toThrow();
    });

    it('should handle workflow: set timing then cleanup', async () => {
      const originalTiming = getCleanupTiming();

      try {
        setCleanupTiming('immediate');
        const timingBeforeCleanup = getCleanupTiming();
        expect(timingBeforeCleanup).toBe('immediate');

        await cleanupAllWorkspaces();

        // Cleanup completes without errors (timing may be updated by cleanupAllWorkspaces)
      } finally {
        setCleanupTiming(originalTiming);
      }
    });

    it('should handle multiple cleanup operations in sequence', async () => {
      await cleanupAllWorkspaces({ timing: 'deferred' });
      await cleanupWorkspace(testWorkspaceDir, { timing: 'deferred' });
      await cleanupAllWorkspaces({ timing: 'deferred' });

      // All operations should complete without errors
    });
  });

  describe('path validation edge cases', () => {
    it('should reject empty path', async () => {
      await expect(
        cleanupWorkspace('', { timing: 'deferred' })
      ).rejects.toThrow();
    });

    it('should reject path with directory traversal', async () => {
      const maliciousPath = join(WORKSPACE_BASE_DIR, '..', '..', 'etc');

      await expect(
        cleanupWorkspace(maliciousPath, { timing: 'deferred' })
      ).rejects.toThrow('Unsafe workspace path');
    });

    it('should accept deeply nested workspace path', async () => {
      const deepPath = join(
        WORKSPACE_BASE_DIR,
        'org',
        'repo',
        'branch',
        `test-${Date.now()}`
      );

      await mkdir(deepPath, { recursive: true });

      try {
        await expect(
          cleanupWorkspace(deepPath, { timing: 'deferred' })
        ).resolves.not.toThrow();
      } finally {
        await rm(deepPath, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('should handle path with special characters', async () => {
      const specialPath = join(
        WORKSPACE_BASE_DIR,
        `test-workspace-with-special-chars-${Date.now()}`
      );

      await mkdir(specialPath, { recursive: true });

      try {
        await expect(
          cleanupWorkspace(specialPath, { timing: 'deferred' })
        ).resolves.not.toThrow();
      } finally {
        await rm(specialPath, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('should handle non-existent workspace path', async () => {
      const nonExistentPath = join(
        WORKSPACE_BASE_DIR,
        `non-existent-${Date.now()}`
      );

      // Should not throw even if path doesn't exist
      await expect(
        cleanupWorkspace(nonExistentPath, { timing: 'deferred' })
      ).resolves.not.toThrow();
    });
  });

  describe('options validation', () => {
    it('should handle all timing options', async () => {
      const timings: CleanupTiming[] = ['immediate', 'deferred', 'background'];

      for (const timing of timings) {
        await expect(
          cleanupWorkspace(testWorkspaceDir, { timing })
        ).resolves.not.toThrow();
      }
    });

    it('should handle empty options object', async () => {
      await expect(
        cleanupWorkspace(testWorkspaceDir, {})
      ).resolves.not.toThrow();
    });

    it('should handle undefined options', async () => {
      await expect(
        cleanupWorkspace(testWorkspaceDir)
      ).resolves.not.toThrow();
    });

    it('should handle complex config overrides', async () => {
      await expect(
        cleanupAllWorkspaces({
          timing: 'background',
          preserveOnError: true,
          config: {
            cleanup: {
              timing: 'background',
              backgroundInterval: 30 * 60 * 1000
            },
            cache: {
              maxWorkspaces: 20,
              sizeThreshold: 200 * 1024 * 1024
            },
            preservation: {
              preserveOnFailure: true,
              maxPreservedWorkspaces: 10
            }
          }
        })
      ).resolves.not.toThrow();
    });
  });

  describe('error handling', () => {
    it('should provide clear error message for unsafe path', async () => {
      const unsafePath = '/some/random/path';

      try {
        await cleanupWorkspace(unsafePath, { timing: 'deferred' });
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toContain('Unsafe workspace path');
        expect(error.message).toContain(unsafePath);
        expect(error.message).toContain(WORKSPACE_BASE_DIR);
      }
    });

    it('should provide clear error message for base directory cleanup', async () => {
      try {
        await cleanupWorkspace(WORKSPACE_BASE_DIR, { timing: 'deferred' });
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toContain('Cannot cleanup base directory');
        expect(error.message).toContain('cleanupAllWorkspaces()');
      }
    });
  });
});
