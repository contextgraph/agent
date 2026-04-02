import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

jest.unstable_mockModule('chalk', () => ({
  default: {
    bold: (s: string) => s,
    cyan: (s: string) => s,
    dim: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
  },
  __esModule: true,
}));

const mockLoadCredentials = jest.fn<() => Promise<unknown>>().mockResolvedValue({
  clerkToken: 'test-token',
  userId: 'user-1',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  createdAt: new Date().toISOString(),
});
const mockIsExpired = jest.fn<() => boolean>().mockReturnValue(false);
const mockIsTokenExpired = jest.fn<() => boolean>().mockReturnValue(false);
jest.unstable_mockModule('../../src/credentials.js', () => ({
  loadCredentials: mockLoadCredentials,
  isExpired: mockIsExpired,
  isTokenExpired: mockIsTokenExpired,
}));

const mockListClaimedStewardBacklog = jest.fn<() => Promise<any[]>>();
jest.unstable_mockModule('../../src/api-client.js', () => ({
  ApiClient: jest.fn(() => ({
    listClaimedStewardBacklog: mockListClaimedStewardBacklog,
  })),
}));

const mockSpawn = jest.fn<(...args: unknown[]) => ChildProcess>();
jest.unstable_mockModule('child_process', () => ({
  spawn: mockSpawn,
}));

const { runStewardBacklogSetup } = await import('../../src/workflows/steward-backlog-setup.js');

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

describe('runStewardBacklogSetup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListClaimedStewardBacklog.mockResolvedValue([
      {
        steward: { name: 'SEO & Discovery', slug: 'seo-discovery' },
        backlog_item: {
          id: 'fef39a30-18c1-4d12-bf42-c53381ce6c6a',
          backlog_reference: 'seo-discovery/audit-and-rewrite-landing-page-hero-copy',
          title: 'Audit and rewrite landing page hero copy',
          objective: 'Improve the landing page hero copy.',
          rationale: 'The hero copy is the highest leverage SEO surface.',
          proposed_branch: 'steward/seo-discovery/audit-and-rewrite-landing-page-hero-copy',
          repository_url: 'https://github.com/contextgraph/actions',
          state: 'in_progress',
        },
      },
    ]);
  });

  it('creates a clean worktree by default', async () => {
    mockSpawn.mockImplementation((...mockArgs: unknown[]) => {
      const [command, args] = mockArgs as [unknown, unknown[]];
      const argv = args as string[];
      if (command === 'git' && argv[0] === 'rev-parse') {
        return createMockProcess(0, '/Users/bbn/code/codex/actions\n');
      }
      if (command === 'git' && argv[0] === 'remote') {
        return createMockProcess(0, 'git@github.com:contextgraph/actions.git\n');
      }
      if (command === 'git' && argv[0] === 'fetch') {
        return createMockProcess(0);
      }
      if (command === 'git' && argv[0] === 'worktree') {
        return createMockProcess(0);
      }
      throw new Error(`Unexpected command: ${String(command)} ${argv.join(' ')}`);
    });

    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runStewardBacklogSetup({ identifier: 'seo-discovery/audit-and-rewrite-landing-page-hero-copy' });

    expect(mockSpawn).toHaveBeenCalledWith('git', ['fetch', 'origin', 'main'], { cwd: '/Users/bbn/code/codex/actions' });
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      [
        'worktree',
        'add',
        '/Users/bbn/code/codex/actions/.worktrees/steward-seo-discovery-audit-and-rewrite-landing-page-hero-copy',
        '-b',
        'steward/seo-discovery/audit-and-rewrite-landing-page-hero-copy',
        'origin/main',
      ],
      { cwd: '/Users/bbn/code/codex/actions' }
    );
    expect(consoleLog).toHaveBeenCalledWith('# Steward Workspace Setup');
    consoleLog.mockRestore();
  });

  it('supports in-place branch setup', async () => {
    mockSpawn.mockImplementation((...mockArgs: unknown[]) => {
      const [command, args] = mockArgs as [unknown, unknown[]];
      const argv = args as string[];
      if (command === 'git' && argv[0] === 'rev-parse') {
        return createMockProcess(0, '/Users/bbn/code/codex/actions\n');
      }
      if (command === 'git' && argv[0] === 'remote') {
        return createMockProcess(0, 'https://github.com/contextgraph/actions\n');
      }
      if (command === 'git' && argv[0] === 'fetch') {
        return createMockProcess(0);
      }
      if (command === 'git' && argv[0] === 'checkout') {
        return createMockProcess(0);
      }
      throw new Error(`Unexpected command: ${String(command)} ${argv.join(' ')}`);
    });

    await runStewardBacklogSetup({
      identifier: 'seo-discovery/audit-and-rewrite-landing-page-hero-copy',
      inPlace: true,
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['checkout', '-b', 'steward/seo-discovery/audit-and-rewrite-landing-page-hero-copy', 'origin/main'],
      { cwd: '/Users/bbn/code/codex/actions' }
    );
  });
});
