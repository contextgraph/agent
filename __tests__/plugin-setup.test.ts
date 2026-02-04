import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { ChildProcess, spawn as actualSpawn } from 'child_process';
import { EventEmitter } from 'events';
import { Readable } from 'stream';

// Mock child_process before importing
jest.mock('child_process');

import { spawn } from 'child_process';
import { isClaudeCodeAvailable, isPluginInstalled, ensurePluginInstalled, PLUGIN_REPO } from '../src/plugin-setup.js';

const mockSpawn = spawn as jest.MockedFunction<typeof actualSpawn>;

/**
 * Create a mock child process that emits close with the given exit code
 * and streams the given stdout data.
 */
function createMockProcess(exitCode: number, stdoutData = ''): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;
  const stdout = new Readable({ read() {} });
  (proc as any).stdout = stdout;
  (proc as any).stderr = new Readable({ read() {} });

  setImmediate(() => {
    if (stdoutData) {
      stdout.push(stdoutData);
    }
    stdout.push(null);
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

  describe('PLUGIN_REPO', () => {
    it('should be the canonical repository URL', () => {
      expect(PLUGIN_REPO).toBe('https://github.com/contextgraph/claude-code-plugin');
    });
  });

  describe('isClaudeCodeAvailable', () => {
    it('should return true when claude --version succeeds', async () => {
      mockSpawn.mockReturnValueOnce(createMockProcess(0, '1.0.0\n'));

      const result = await isClaudeCodeAvailable();

      expect(result).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        ['--version'],
        expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] })
      );
    });

    it('should return false when claude --version fails', async () => {
      mockSpawn.mockReturnValueOnce(createMockProcess(1));

      const result = await isClaudeCodeAvailable();

      expect(result).toBe(false);
    });

    it('should return false when spawn throws (command not found)', async () => {
      mockSpawn.mockImplementationOnce((() => {
        const proc = new EventEmitter() as ChildProcess;
        (proc as any).stdout = new Readable({ read() {} });
        (proc as any).stderr = new Readable({ read() {} });
        setImmediate(() => proc.emit('error', new Error('ENOENT')));
        return proc;
      }) as any);

      const result = await isClaudeCodeAvailable();

      expect(result).toBe(false);
    });
  });

  describe('isPluginInstalled', () => {
    it('should return true when plugin list includes contextgraph', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockProcess(0, 'contextgraph@contextgraph-marketplace\nother-plugin\n')
      );

      const result = await isPluginInstalled();

      expect(result).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        ['plugin', 'list'],
        expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] })
      );
    });

    it('should return false when plugin list does not include the plugin', async () => {
      mockSpawn.mockReturnValueOnce(createMockProcess(0, 'some-other-plugin\n'));

      const result = await isPluginInstalled();

      expect(result).toBe(false);
    });

    it('should return false when plugin list command fails', async () => {
      mockSpawn.mockReturnValueOnce(createMockProcess(1));

      const result = await isPluginInstalled();

      expect(result).toBe(false);
    });
  });

  describe('ensurePluginInstalled', () => {
    it('should skip install when plugin is already installed', async () => {
      // isPluginInstalled: claude plugin list returns the plugin
      mockSpawn.mockReturnValueOnce(
        createMockProcess(0, 'contextgraph@contextgraph-marketplace\n')
      );

      await ensurePluginInstalled();

      // Only one spawn call (plugin list), no marketplace or install calls
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        ['plugin', 'list'],
        expect.any(Object)
      );
    });

    it('should install plugin when marketplace is already configured', async () => {
      // isPluginInstalled: not installed
      mockSpawn.mockReturnValueOnce(createMockProcess(0, ''));
      // isMarketplaceConfigured: marketplace exists
      mockSpawn.mockReturnValueOnce(createMockProcess(0, 'contextgraph-marketplace\n'));
      // claude plugin install succeeds
      mockSpawn.mockReturnValueOnce(createMockProcess(0, 'Installed\n'));

      await ensurePluginInstalled();

      expect(mockSpawn).toHaveBeenCalledTimes(3);
      expect(mockSpawn).toHaveBeenNthCalledWith(
        3,
        'claude',
        ['plugin', 'install', 'contextgraph'],
        expect.any(Object)
      );
    });

    it('should add marketplace then install when marketplace is not configured', async () => {
      // isPluginInstalled: not installed
      mockSpawn.mockReturnValueOnce(createMockProcess(0, ''));
      // isMarketplaceConfigured: not found
      mockSpawn.mockReturnValueOnce(createMockProcess(0, 'claude-plugins-official\n'));
      // addMarketplace: succeeds
      mockSpawn.mockReturnValueOnce(createMockProcess(0, ''));
      // claude plugin install succeeds
      mockSpawn.mockReturnValueOnce(createMockProcess(0, 'Installed\n'));

      await ensurePluginInstalled();

      expect(mockSpawn).toHaveBeenCalledTimes(4);
      expect(mockSpawn).toHaveBeenNthCalledWith(
        3,
        'claude',
        ['plugin', 'marketplace', 'add', 'contextgraph/claude-code-plugin'],
        expect.any(Object)
      );
      expect(mockSpawn).toHaveBeenNthCalledWith(
        4,
        'claude',
        ['plugin', 'install', 'contextgraph'],
        expect.any(Object)
      );
    });

    it('should throw when marketplace add fails', async () => {
      // isPluginInstalled: not installed
      mockSpawn.mockReturnValueOnce(createMockProcess(0, ''));
      // isMarketplaceConfigured: not found
      mockSpawn.mockReturnValueOnce(createMockProcess(0, ''));
      // addMarketplace: fails
      mockSpawn.mockReturnValueOnce(createMockProcess(1));

      await expect(ensurePluginInstalled()).rejects.toThrow(
        'Failed to add marketplace (exit code 1)'
      );
    });

    it('should throw when plugin install fails', async () => {
      // isPluginInstalled: not installed
      mockSpawn.mockReturnValueOnce(createMockProcess(0, ''));
      // isMarketplaceConfigured: exists
      mockSpawn.mockReturnValueOnce(createMockProcess(0, 'contextgraph\n'));
      // claude plugin install fails
      mockSpawn.mockReturnValueOnce(createMockProcess(1));

      await expect(ensurePluginInstalled()).rejects.toThrow(
        'Failed to install plugin (exit code 1)'
      );
    });
  });
});
