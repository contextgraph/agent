import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { ChildProcess, spawn as actualSpawn } from 'child_process';
import { EventEmitter } from 'events';

jest.mock('child_process');
jest.mock('fs/promises');

import { spawn } from 'child_process';
import { mkdtemp, rm, appendFile } from 'fs/promises';
import {
  extractRepoName,
  prepareMultiRepoWorkspace,
  type PrepareWorkspaceOptions,
} from '../src/workspace-prep.js';

const mockSpawn = spawn as jest.MockedFunction<typeof actualSpawn>;
const mockMkdtemp = mkdtemp as jest.MockedFunction<typeof mkdtemp>;
const mockRm = rm as jest.MockedFunction<typeof rm>;
const mockAppendFile = appendFile as jest.MockedFunction<typeof appendFile>;

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

describe('extractRepoName', () => {
  it('should extract name from standard GitHub URL', () => {
    expect(extractRepoName('https://github.com/contextgraph/actions')).toBe('actions');
  });

  it('should extract name from URL with .git suffix', () => {
    expect(extractRepoName('https://github.com/contextgraph/actions.git')).toBe('actions');
  });

  it('should extract name from URL with trailing slash', () => {
    expect(extractRepoName('https://github.com/contextgraph/actions/')).toBe('actions');
  });

  it('should extract name from URL with .git and trailing slash', () => {
    expect(extractRepoName('https://github.com/contextgraph/actions.git/')).toBe('actions');
  });

  it('should handle GitLab URLs', () => {
    expect(extractRepoName('https://gitlab.com/org/my-project')).toBe('my-project');
  });

  it('should handle deeply nested paths', () => {
    expect(extractRepoName('https://github.com/org/sub/repo-name')).toBe('repo-name');
  });
});

describe('prepareMultiRepoWorkspace', () => {
  const defaultOptions: PrepareWorkspaceOptions = {
    authToken: 'test-auth-token',
    skipSkills: true,
  };

  function mockCredentials() {
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
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockMkdtemp.mockResolvedValue('/tmp/cg-workspace-abc123' as any);
    mockRm.mockResolvedValue(undefined);
    mockAppendFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should clone multiple repos into subdirectories', async () => {
    mockCredentials();

    const repos = [
      { url: 'https://github.com/contextgraph/actions' },
      { url: 'https://github.com/contextgraph/agent' },
    ];

    // For each repo: clone, config user.name, config user.email, appendFile (git exclude), rev-parse
    mockSpawn
      // repo 1: actions
      .mockReturnValueOnce(createMockProcess(0)) // git clone
      .mockReturnValueOnce(createMockProcess(0)) // git config user.name
      .mockReturnValueOnce(createMockProcess(0)) // git config user.email
      .mockReturnValueOnce(createMockProcess(0, 'aaa111\n')) // git rev-parse HEAD
      // repo 2: agent
      .mockReturnValueOnce(createMockProcess(0)) // git clone
      .mockReturnValueOnce(createMockProcess(0)) // git config user.name
      .mockReturnValueOnce(createMockProcess(0)) // git config user.email
      .mockReturnValueOnce(createMockProcess(0, 'bbb222\n')); // git rev-parse HEAD

    const result = await prepareMultiRepoWorkspace(repos, defaultOptions);

    expect(result.rootPath).toBe('/tmp/cg-workspace-abc123');
    expect(result.repos).toHaveLength(2);
    expect(result.repos[0].name).toBe('actions');
    expect(result.repos[0].path).toBe('/tmp/cg-workspace-abc123/actions');
    expect(result.repos[0].startingCommit).toBe('aaa111');
    expect(result.repos[1].name).toBe('agent');
    expect(result.repos[1].path).toBe('/tmp/cg-workspace-abc123/agent');
    expect(result.repos[1].startingCommit).toBe('bbb222');

    // Verify clone targets subdirectories
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['clone', expect.stringContaining('actions'), '/tmp/cg-workspace-abc123/actions'],
      expect.any(Object)
    );
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['clone', expect.stringContaining('agent'), '/tmp/cg-workspace-abc123/agent'],
      expect.any(Object)
    );
  });

  it('should configure git identity in each clone', async () => {
    mockCredentials();

    const repos = [
      { url: 'https://github.com/contextgraph/actions' },
      { url: 'https://github.com/contextgraph/agent' },
    ];

    mockSpawn
      .mockReturnValueOnce(createMockProcess(0)) // clone actions
      .mockReturnValueOnce(createMockProcess(0)) // config user.name actions
      .mockReturnValueOnce(createMockProcess(0)) // config user.email actions
      .mockReturnValueOnce(createMockProcess(0, 'aaa111\n')) // rev-parse actions
      .mockReturnValueOnce(createMockProcess(0)) // clone agent
      .mockReturnValueOnce(createMockProcess(0)) // config user.name agent
      .mockReturnValueOnce(createMockProcess(0)) // config user.email agent
      .mockReturnValueOnce(createMockProcess(0, 'bbb222\n')); // rev-parse agent

    await prepareMultiRepoWorkspace(repos, defaultOptions);

    // Verify git config for each repo
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['config', 'user.name', 'testuser'],
      expect.objectContaining({ cwd: '/tmp/cg-workspace-abc123/actions' })
    );
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['config', 'user.email', 'test@example.com'],
      expect.objectContaining({ cwd: '/tmp/cg-workspace-abc123/actions' })
    );
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['config', 'user.name', 'testuser'],
      expect.objectContaining({ cwd: '/tmp/cg-workspace-abc123/agent' })
    );
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['config', 'user.email', 'test@example.com'],
      expect.objectContaining({ cwd: '/tmp/cg-workspace-abc123/agent' })
    );
  });

  it('should handle per-repo branch checkout', async () => {
    mockCredentials();

    const repos = [
      { url: 'https://github.com/contextgraph/actions', branch: 'develop' },
      { url: 'https://github.com/contextgraph/agent' },
    ];

    mockSpawn
      // repo 1 (actions): clone, config name, config email, ls-remote, checkout, rev-parse
      .mockReturnValueOnce(createMockProcess(0)) // clone
      .mockReturnValueOnce(createMockProcess(0)) // config user.name
      .mockReturnValueOnce(createMockProcess(0)) // config user.email
      .mockReturnValueOnce(createMockProcess(0, 'abc\trefs/heads/develop')) // ls-remote (branch exists)
      .mockReturnValueOnce(createMockProcess(0)) // checkout
      .mockReturnValueOnce(createMockProcess(0, 'aaa111\n')) // rev-parse
      // repo 2 (agent): clone, config name, config email, rev-parse (no branch)
      .mockReturnValueOnce(createMockProcess(0)) // clone
      .mockReturnValueOnce(createMockProcess(0)) // config user.name
      .mockReturnValueOnce(createMockProcess(0)) // config user.email
      .mockReturnValueOnce(createMockProcess(0, 'bbb222\n')); // rev-parse

    const result = await prepareMultiRepoWorkspace(repos, defaultOptions);

    expect(result.repos[0].branch).toBe('develop');
    expect(result.repos[1].branch).toBeUndefined();

    // Verify branch checkout was called for actions
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['ls-remote', '--heads', 'origin', 'develop'],
      expect.objectContaining({ cwd: '/tmp/cg-workspace-abc123/actions' })
    );
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['checkout', 'develop'],
      expect.objectContaining({ cwd: '/tmp/cg-workspace-abc123/actions' })
    );
  });

  it('should cleanup entire workspace root', async () => {
    mockCredentials();

    const repos = [
      { url: 'https://github.com/contextgraph/actions' },
      { url: 'https://github.com/contextgraph/agent' },
    ];

    mockSpawn
      .mockReturnValueOnce(createMockProcess(0))
      .mockReturnValueOnce(createMockProcess(0))
      .mockReturnValueOnce(createMockProcess(0))
      .mockReturnValueOnce(createMockProcess(0, 'aaa111\n'))
      .mockReturnValueOnce(createMockProcess(0))
      .mockReturnValueOnce(createMockProcess(0))
      .mockReturnValueOnce(createMockProcess(0))
      .mockReturnValueOnce(createMockProcess(0, 'bbb222\n'));

    const result = await prepareMultiRepoWorkspace(repos, defaultOptions);
    await result.cleanup();

    expect(mockRm).toHaveBeenCalledWith(
      '/tmp/cg-workspace-abc123',
      { recursive: true, force: true }
    );
  });

  it('should add .claude/skills/ to git exclude in each repo', async () => {
    mockCredentials();

    const repos = [
      { url: 'https://github.com/contextgraph/actions' },
      { url: 'https://github.com/contextgraph/agent' },
    ];

    mockSpawn
      .mockReturnValueOnce(createMockProcess(0))
      .mockReturnValueOnce(createMockProcess(0))
      .mockReturnValueOnce(createMockProcess(0))
      .mockReturnValueOnce(createMockProcess(0, 'aaa111\n'))
      .mockReturnValueOnce(createMockProcess(0))
      .mockReturnValueOnce(createMockProcess(0))
      .mockReturnValueOnce(createMockProcess(0))
      .mockReturnValueOnce(createMockProcess(0, 'bbb222\n'));

    await prepareMultiRepoWorkspace(repos, defaultOptions);

    // Verify git exclude was set for each repo
    expect(mockAppendFile).toHaveBeenCalledWith(
      '/tmp/cg-workspace-abc123/actions/.git/info/exclude',
      '\n.claude/skills/\n'
    );
    expect(mockAppendFile).toHaveBeenCalledWith(
      '/tmp/cg-workspace-abc123/agent/.git/info/exclude',
      '\n.claude/skills/\n'
    );
  });

  it('should cleanup on clone failure', async () => {
    mockCredentials();

    const repos = [
      { url: 'https://github.com/contextgraph/actions' },
      { url: 'https://github.com/contextgraph/agent' },
    ];

    // First repo clones fine, second fails
    mockSpawn
      .mockReturnValueOnce(createMockProcess(0)) // clone actions
      .mockReturnValueOnce(createMockProcess(0)) // config name
      .mockReturnValueOnce(createMockProcess(0)) // config email
      .mockReturnValueOnce(createMockProcess(0, 'aaa111\n')) // rev-parse
      .mockReturnValueOnce(createMockProcess(128, '', 'fatal: repository not found')); // clone agent fails

    await expect(
      prepareMultiRepoWorkspace(repos, defaultOptions)
    ).rejects.toThrow('git clone failed');

    expect(mockRm).toHaveBeenCalledWith(
      '/tmp/cg-workspace-abc123',
      { recursive: true, force: true }
    );
  });

  it('should preserve repo url and branch on result', async () => {
    mockCredentials();

    const repos = [
      { url: 'https://github.com/contextgraph/actions', branch: 'main' },
      { url: 'https://github.com/contextgraph/agent' },
    ];

    mockSpawn
      .mockReturnValueOnce(createMockProcess(0))
      .mockReturnValueOnce(createMockProcess(0))
      .mockReturnValueOnce(createMockProcess(0))
      .mockReturnValueOnce(createMockProcess(0, 'abc\trefs/heads/main'))
      .mockReturnValueOnce(createMockProcess(0))
      .mockReturnValueOnce(createMockProcess(0, 'aaa111\n'))
      .mockReturnValueOnce(createMockProcess(0))
      .mockReturnValueOnce(createMockProcess(0))
      .mockReturnValueOnce(createMockProcess(0))
      .mockReturnValueOnce(createMockProcess(0, 'bbb222\n'));

    const result = await prepareMultiRepoWorkspace(repos, defaultOptions);

    expect(result.repos[0].url).toBe('https://github.com/contextgraph/actions');
    expect(result.repos[0].branch).toBe('main');
    expect(result.repos[1].url).toBe('https://github.com/contextgraph/agent');
    expect(result.repos[1].branch).toBeUndefined();
  });
});
