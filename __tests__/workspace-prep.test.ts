import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { ChildProcess, spawn as actualSpawn } from 'child_process';
import { EventEmitter } from 'events';

// Mock modules before importing
jest.mock('child_process');
jest.mock('fs/promises');

// Import after mocking
import { spawn } from 'child_process';
import { mkdtemp, rm } from 'fs/promises';
import { prepareWorkspace, type PrepareWorkspaceOptions } from '../src/workspace-prep.js';

const mockSpawn = spawn as jest.MockedFunction<typeof actualSpawn>;
const mockMkdtemp = mkdtemp as jest.MockedFunction<typeof mkdtemp>;
const mockRm = rm as jest.MockedFunction<typeof rm>;

// Helper to create a mock child process
function createMockProcess(exitCode: number, stdout: string = '', stderr: string = ''): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;
  proc.stdout = new EventEmitter() as any;
  proc.stderr = new EventEmitter() as any;

  // Emit data and close asynchronously
  setImmediate(() => {
    if (stdout) {
      (proc.stdout as EventEmitter).emit('data', Buffer.from(stdout));
    }
    if (stderr) {
      (proc.stderr as EventEmitter).emit('data', Buffer.from(stderr));
    }
    proc.emit('close', exitCode);
  });

  return proc;
}

// Mock fetch globally
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

describe('workspace-prep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock implementations
    mockMkdtemp.mockResolvedValue('/tmp/cg-workspace-abc123' as any);
    mockRm.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('prepareWorkspace', () => {
    const defaultOptions: PrepareWorkspaceOptions = {
      authToken: 'test-auth-token',
    };

    it('should clone repository and return workspace path', async () => {
      // Mock GitHub credentials API
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          githubToken: 'gh-token-123',
          githubUsername: 'testuser',
          githubEmail: 'test@example.com',
        }),
      } as Response);

      // Mock git commands: clone, config user.name, config user.email, rev-parse
      mockSpawn
        .mockReturnValueOnce(createMockProcess(0)) // git clone
        .mockReturnValueOnce(createMockProcess(0)) // git config user.name
        .mockReturnValueOnce(createMockProcess(0)) // git config user.email
        .mockReturnValueOnce(createMockProcess(0, 'abc123def456\n')); // git rev-parse HEAD

      const result = await prepareWorkspace('https://github.com/test/repo', defaultOptions);

      expect(result.path).toBe('/tmp/cg-workspace-abc123');
      expect(result.startingCommit).toBe('abc123def456');
      expect(typeof result.cleanup).toBe('function');

      // Verify fetch was called with correct auth header
      expect(mockFetch).toHaveBeenCalledWith(
        'https://www.contextgraph.dev/api/cli/credentials',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-authorization': 'Bearer test-auth-token',
          }),
        })
      );

      // Verify git clone was called with authenticated URL
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['clone', 'https://gh-token-123@github.com/test/repo', '/tmp/cg-workspace-abc123'],
        expect.any(Object)
      );
    });

    it('should checkout existing branch when it exists remotely', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          githubToken: 'gh-token-123',
        }),
      } as Response);

      // Mock: clone, ls-remote (branch exists), checkout, rev-parse
      mockSpawn
        .mockReturnValueOnce(createMockProcess(0)) // git clone
        .mockReturnValueOnce(createMockProcess(0, 'abc123\trefs/heads/feature-branch')) // ls-remote shows branch
        .mockReturnValueOnce(createMockProcess(0)) // git checkout
        .mockReturnValueOnce(createMockProcess(0, 'def789ghi012\n')); // git rev-parse HEAD

      const result = await prepareWorkspace('https://github.com/test/repo', {
        ...defaultOptions,
        branch: 'feature-branch',
      });

      expect(result.path).toBe('/tmp/cg-workspace-abc123');
      expect(result.startingCommit).toBe('def789ghi012');

      // Verify checkout was called (not checkout -b)
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['checkout', 'feature-branch'],
        expect.objectContaining({ cwd: '/tmp/cg-workspace-abc123' })
      );
    });

    it('should create new branch when it does not exist remotely', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          githubToken: 'gh-token-123',
        }),
      } as Response);

      // Mock: clone, ls-remote (empty = no branch), checkout -b, rev-parse
      mockSpawn
        .mockReturnValueOnce(createMockProcess(0)) // git clone
        .mockReturnValueOnce(createMockProcess(0, '')) // ls-remote returns empty
        .mockReturnValueOnce(createMockProcess(0)) // git checkout -b
        .mockReturnValueOnce(createMockProcess(0, 'aaa111bbb222\n')); // git rev-parse HEAD

      const result = await prepareWorkspace('https://github.com/test/repo', {
        ...defaultOptions,
        branch: 'new-feature',
      });

      expect(result.path).toBe('/tmp/cg-workspace-abc123');
      expect(result.startingCommit).toBe('aaa111bbb222');

      // Verify checkout -b was called (create new branch)
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['checkout', '-b', 'new-feature'],
        expect.objectContaining({ cwd: '/tmp/cg-workspace-abc123' })
      );
    });

    it('should throw on 401 authentication error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      } as Response);

      await expect(
        prepareWorkspace('https://github.com/test/repo', defaultOptions)
      ).rejects.toThrow('Authentication failed. Please re-authenticate.');
    });

    it('should throw on 404 when GitHub not connected', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response);

      await expect(
        prepareWorkspace('https://github.com/test/repo', defaultOptions)
      ).rejects.toThrow('GitHub not connected');
    });

    it('should cleanup workspace on git clone failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          githubToken: 'gh-token-123',
        }),
      } as Response);

      // Mock git clone failure
      mockSpawn.mockReturnValueOnce(createMockProcess(128, '', 'fatal: repository not found'));

      await expect(
        prepareWorkspace('https://github.com/test/repo', defaultOptions)
      ).rejects.toThrow('git clone failed');

      // Verify cleanup was called
      expect(mockRm).toHaveBeenCalledWith(
        '/tmp/cg-workspace-abc123',
        { recursive: true, force: true }
      );
    });

    it('should not modify URL for non-GitHub repos', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          githubToken: 'gh-token-123',
        }),
      } as Response);

      mockSpawn
        .mockReturnValueOnce(createMockProcess(0)) // git clone
        .mockReturnValueOnce(createMockProcess(0, 'ccc333ddd444\n')); // git rev-parse HEAD

      await prepareWorkspace('https://gitlab.com/test/repo', defaultOptions);

      // Verify URL was not modified (no token injection for non-GitHub)
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['clone', 'https://gitlab.com/test/repo', '/tmp/cg-workspace-abc123'],
        expect.any(Object)
      );
    });

    it('should call cleanup function to remove workspace', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          githubToken: 'gh-token-123',
        }),
      } as Response);

      mockSpawn
        .mockReturnValueOnce(createMockProcess(0)) // git clone
        .mockReturnValueOnce(createMockProcess(0, 'eee555fff666\n')); // git rev-parse HEAD

      const result = await prepareWorkspace('https://github.com/test/repo', defaultOptions);

      // Call cleanup
      await result.cleanup();

      // Verify rm was called
      expect(mockRm).toHaveBeenCalledWith(
        '/tmp/cg-workspace-abc123',
        { recursive: true, force: true }
      );
    });

    it('should handle cleanup errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          githubToken: 'gh-token-123',
        }),
      } as Response);

      mockSpawn
        .mockReturnValueOnce(createMockProcess(0)) // git clone
        .mockReturnValueOnce(createMockProcess(0, 'ggg777hhh888\n')); // git rev-parse HEAD
      mockRm.mockRejectedValueOnce(new Error('Permission denied'));

      const result = await prepareWorkspace('https://github.com/test/repo', defaultOptions);

      // Cleanup should not throw even if rm fails
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await expect(result.cleanup()).resolves.not.toThrow();
      consoleSpy.mockRestore();
    });
  });
});
