import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { ChildProcess, spawn as actualSpawn } from 'child_process';
import { EventEmitter } from 'events';

// Mock modules before importing
jest.mock('child_process');
jest.mock('fs/promises');
jest.mock('os', () => {
  const original = jest.requireActual<typeof import('os')>('os');
  return {
    ...original,
    homedir: () => '/home/testuser',
  };
});

// Import after mocking
import { spawn } from 'child_process';
import { access, mkdir } from 'fs/promises';
import { ensurePlugin, updatePlugin, getPluginPath } from '../src/plugin-setup.js';

const mockSpawn = spawn as jest.MockedFunction<typeof actualSpawn>;
const mockAccess = access as jest.MockedFunction<typeof access>;
const mockMkdir = mkdir as jest.MockedFunction<typeof mkdir>;

// Helper to create a mock child process with stdio: 'inherit'
function createMockProcess(exitCode: number): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;

  // Emit close asynchronously
  setImmediate(() => {
    proc.emit('close', exitCode);
  });

  return proc;
}

describe('plugin-setup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('ensurePlugin', () => {
    const expectedPluginPath = '/home/testuser/.contextgraph/claude-code-plugin/plugins/contextgraph';
    const expectedPluginDir = '/home/testuser/.contextgraph/claude-code-plugin';

    it('should return existing plugin path when plugin exists', async () => {
      // Plugin path exists
      mockAccess.mockResolvedValueOnce(undefined);

      const result = await ensurePlugin();

      expect(result).toBe(expectedPluginPath);
      expect(mockAccess).toHaveBeenCalledWith(expectedPluginPath);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should pull and return path when repo dir exists but plugin missing', async () => {
      // First access (plugin path) fails
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'));
      // Second access (repo dir) succeeds
      mockAccess.mockResolvedValueOnce(undefined);
      // git pull succeeds
      mockSpawn.mockReturnValueOnce(createMockProcess(0));
      // Third access (plugin path after pull) succeeds
      mockAccess.mockResolvedValueOnce(undefined);

      const result = await ensurePlugin();

      expect(result).toBe(expectedPluginPath);
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['pull'],
        expect.objectContaining({ cwd: expectedPluginDir })
      );
    });

    it('should throw when plugin not found after git pull', async () => {
      // First access (plugin path) fails
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'));
      // Second access (repo dir) succeeds
      mockAccess.mockResolvedValueOnce(undefined);
      // git pull succeeds
      mockSpawn.mockReturnValueOnce(createMockProcess(0));
      // Third access (plugin path after pull) fails
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'));

      await expect(ensurePlugin()).rejects.toThrow('Plugin not found at');
    });

    it('should clone repo when neither plugin nor dir exist', async () => {
      // First access (plugin path) fails
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'));
      // Second access (repo dir) fails
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'));
      // mkdir succeeds
      mockMkdir.mockResolvedValueOnce(undefined);
      // git clone succeeds
      mockSpawn.mockReturnValueOnce(createMockProcess(0));
      // Final access (plugin path after clone) succeeds
      mockAccess.mockResolvedValueOnce(undefined);

      const result = await ensurePlugin();

      expect(result).toBe(expectedPluginPath);
      expect(mockMkdir).toHaveBeenCalledWith('/home/testuser/.contextgraph', { recursive: true });
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['clone', 'https://github.com/contextgraph/claude-code-plugin.git', expectedPluginDir],
        expect.any(Object)
      );
    });

    it('should throw when clone succeeds but plugin path not found', async () => {
      // First access (plugin path) fails
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'));
      // Second access (repo dir) fails
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'));
      // mkdir succeeds
      mockMkdir.mockResolvedValueOnce(undefined);
      // git clone succeeds
      mockSpawn.mockReturnValueOnce(createMockProcess(0));
      // Final access (plugin path after clone) fails
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'));

      await expect(ensurePlugin()).rejects.toThrow('Plugin clone succeeded but plugin path not found');
    });

    it('should throw when git clone fails', async () => {
      // First access (plugin path) fails
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'));
      // Second access (repo dir) fails
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'));
      // mkdir succeeds
      mockMkdir.mockResolvedValueOnce(undefined);
      // git clone fails
      mockSpawn.mockReturnValueOnce(createMockProcess(128));

      await expect(ensurePlugin()).rejects.toThrow('git clone failed with exit code 128');
    });

    it('should handle mkdir error gracefully (directory may exist)', async () => {
      // First access (plugin path) fails
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'));
      // Second access (repo dir) fails
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'));
      // mkdir fails (directory exists)
      mockMkdir.mockRejectedValueOnce(new Error('EEXIST'));
      // git clone succeeds
      mockSpawn.mockReturnValueOnce(createMockProcess(0));
      // Final access (plugin path after clone) succeeds
      mockAccess.mockResolvedValueOnce(undefined);

      // Should not throw
      const result = await ensurePlugin();
      expect(result).toBe(expectedPluginPath);
    });
  });

  describe('updatePlugin', () => {
    const expectedPluginDir = '/home/testuser/.contextgraph/claude-code-plugin';

    it('should pull latest when plugin is installed', async () => {
      // Plugin dir exists
      mockAccess.mockResolvedValueOnce(undefined);
      // git pull succeeds
      mockSpawn.mockReturnValueOnce(createMockProcess(0));

      await updatePlugin();

      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['pull'],
        expect.objectContaining({ cwd: expectedPluginDir })
      );
    });

    it('should throw when plugin is not installed', async () => {
      // Plugin dir does not exist
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'));

      await expect(updatePlugin()).rejects.toThrow('Plugin not installed');
    });

    it('should throw when git pull fails', async () => {
      // Plugin dir exists
      mockAccess.mockResolvedValueOnce(undefined);
      // git pull fails
      mockSpawn.mockReturnValueOnce(createMockProcess(1));

      await expect(updatePlugin()).rejects.toThrow('git pull failed with exit code 1');
    });
  });

  describe('getPluginPath', () => {
    it('should return expected plugin path', () => {
      const result = getPluginPath();
      expect(result).toBe('/home/testuser/.contextgraph/claude-code-plugin/plugins/contextgraph');
    });
  });
});
