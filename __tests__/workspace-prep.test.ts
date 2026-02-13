import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

const mockMkdtemp = jest.fn<(...args: unknown[]) => Promise<string>>();
const mockRm = jest.fn<(...args: unknown[]) => Promise<void>>();
const mockAppendFile = jest.fn<(...args: unknown[]) => Promise<void>>();
const mockWriteFile = jest.fn<(...args: unknown[]) => Promise<void>>();
const mockChmod = jest.fn<(...args: unknown[]) => Promise<void>>();
const mockMkdir = jest.fn<(...args: unknown[]) => Promise<string | undefined>>();

jest.unstable_mockModule('fs/promises', () => ({
  mkdtemp: mockMkdtemp,
  rm: mockRm,
  appendFile: mockAppendFile,
  writeFile: mockWriteFile,
  chmod: mockChmod,
  mkdir: mockMkdir,
}));

const mockSpawn = jest.fn<(...args: unknown[]) => ChildProcess>();

jest.unstable_mockModule('child_process', () => ({
  spawn: mockSpawn,
}));

const { prepareWorkspace } = await import('../src/workspace-prep.js');
import type { PrepareWorkspaceOptions } from '../src/workspace-prep.js';

function createMockProcess(exitCode: number, stdout: string = '', stderr: string = ''): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;
  proc.stdout = new EventEmitter() as any;
  proc.stderr = new EventEmitter() as any;

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

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

describe('workspace-prep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMkdtemp.mockResolvedValue('/tmp/cg-workspace-abc123');
    mockRm.mockResolvedValue(undefined);
    mockAppendFile.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockChmod.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('prepareWorkspace', () => {
    const defaultOptions: PrepareWorkspaceOptions = {
      authToken: 'test-auth-token',
    };

    it('should clone repository and return workspace path', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          githubToken: 'gh-token-123',
          githubUsername: 'testuser',
          githubEmail: 'test@example.com',
          gitCredentialsUsername: 'x-access-token',
        }),
      } as Response);

      mockSpawn
        .mockReturnValueOnce(createMockProcess(0)) // git clone
        .mockReturnValueOnce(createMockProcess(0)) // git config user.name
        .mockReturnValueOnce(createMockProcess(0)) // git config user.email
        .mockReturnValueOnce(createMockProcess(0, 'abc123def456\n')); // git rev-parse HEAD

      const result = await prepareWorkspace('https://github.com/test/repo', defaultOptions);

      expect(result.path).toBe('/tmp/cg-workspace-abc123');
      expect(result.startingCommit).toBe('abc123def456');
      expect(typeof result.cleanup).toBe('function');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://www.contextgraph.dev/api/cli/credentials',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-authorization': 'Bearer test-auth-token',
          }),
        })
      );

      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['clone', 'https://x-access-token:gh-token-123@github.com/test/repo', '/tmp/cg-workspace-abc123'],
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

      mockSpawn
        .mockReturnValueOnce(createMockProcess(0)) // git clone
        .mockReturnValueOnce(createMockProcess(0, 'abc123\trefs/heads/feature-branch')) // ls-remote
        .mockReturnValueOnce(createMockProcess(0)) // git checkout
        .mockReturnValueOnce(createMockProcess(0, 'def789ghi012\n')); // git rev-parse HEAD

      const result = await prepareWorkspace('https://github.com/test/repo', {
        ...defaultOptions,
        branch: 'feature-branch',
      });

      expect(result.path).toBe('/tmp/cg-workspace-abc123');
      expect(result.startingCommit).toBe('def789ghi012');

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

      mockSpawn.mockReturnValueOnce(createMockProcess(128, '', 'fatal: repository not found'));

      await expect(
        prepareWorkspace('https://github.com/test/repo', defaultOptions)
      ).rejects.toThrow('git clone failed');

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

      await result.cleanup();

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

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await expect(result.cleanup()).resolves.not.toThrow();
      consoleSpy.mockRestore();
    });

    describe('branch enforcement', () => {
      it('should write EXPECTED_BRANCH file when branch is specified', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            githubToken: 'gh-token-123',
          }),
        } as Response);

        mockSpawn
          .mockReturnValueOnce(createMockProcess(0)) // git clone
          .mockReturnValueOnce(createMockProcess(0, 'abc123\trefs/heads/feat/my-branch')) // ls-remote
          .mockReturnValueOnce(createMockProcess(0)) // git checkout
          .mockReturnValueOnce(createMockProcess(0, 'abc123\n')); // git rev-parse HEAD

        await prepareWorkspace('https://github.com/test/repo', {
          ...defaultOptions,
          branch: 'feat/my-branch',
        });

        expect(mockWriteFile).toHaveBeenCalledWith(
          '/tmp/cg-workspace-abc123/.git/EXPECTED_BRANCH',
          'feat/my-branch'
        );
      });

      it('should install pre-push hook when branch is specified', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            githubToken: 'gh-token-123',
          }),
        } as Response);

        mockSpawn
          .mockReturnValueOnce(createMockProcess(0)) // git clone
          .mockReturnValueOnce(createMockProcess(0, '')) // ls-remote (new branch)
          .mockReturnValueOnce(createMockProcess(0)) // git checkout -b
          .mockReturnValueOnce(createMockProcess(0, 'abc123\n')); // git rev-parse HEAD

        await prepareWorkspace('https://github.com/test/repo', {
          ...defaultOptions,
          branch: 'feat/my-branch',
        });

        expect(mockMkdir).toHaveBeenCalledWith(
          '/tmp/cg-workspace-abc123/.git/hooks',
          { recursive: true }
        );

        const hookWriteCall = mockWriteFile.mock.calls.find(
          (call) => (call[0] as string).endsWith('pre-push')
        );
        expect(hookWriteCall).toBeDefined();
        expect(hookWriteCall![1]).toContain('EXPECTED_BRANCH');
        expect(hookWriteCall![1]).toContain('The agent MUST use');

        expect(mockChmod).toHaveBeenCalledWith(
          '/tmp/cg-workspace-abc123/.git/hooks/pre-push',
          0o755
        );
      });

      it('should not install branch enforcement when no branch is specified', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            githubToken: 'gh-token-123',
          }),
        } as Response);

        mockSpawn
          .mockReturnValueOnce(createMockProcess(0)) // git clone
          .mockReturnValueOnce(createMockProcess(0, 'abc123\n')); // git rev-parse HEAD

        await prepareWorkspace('https://github.com/test/repo', defaultOptions);

        const expectedBranchWrite = mockWriteFile.mock.calls.find(
          (call) => (call[0] as string).includes('EXPECTED_BRANCH')
        );
        expect(expectedBranchWrite).toBeUndefined();
      });
    });
  });
});
