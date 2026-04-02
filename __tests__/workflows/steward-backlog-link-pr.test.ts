import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { readFileSync } from 'fs';

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

const { runStewardBacklogLinkPr } = await import('../../src/workflows/steward-backlog-link-pr.js');

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

describe('runStewardBacklogLinkPr', () => {
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

  it('appends the backlog marker to the PR body', async () => {
    mockSpawn.mockImplementation((...mockArgs: unknown[]) => {
      const [command, args] = mockArgs as [unknown, unknown[]];
      const argv = args as string[];
      if (command === 'gh' && argv[0] === 'pr' && argv[1] === 'view') {
        return createMockProcess(0, JSON.stringify({
          body: '## Summary\nExisting body',
          number: 123,
          url: 'https://github.com/contextgraph/actions/pull/123',
        }));
      }
      if (command === 'gh' && argv[0] === 'pr' && argv[1] === 'edit') {
        const bodyFileIndex = argv.indexOf('--body-file');
        const bodyPath = argv[bodyFileIndex + 1];
        const body = readFileSync(bodyPath, 'utf8');
        expect(body).toContain('Steward-Backlog-Item: fef39a30-18c1-4d12-bf42-c53381ce6c6a');
        return createMockProcess(0);
      }
      throw new Error(`Unexpected command: ${String(command)} ${argv.join(' ')}`);
    });

    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runStewardBacklogLinkPr({
      identifier: 'seo-discovery/audit-and-rewrite-landing-page-hero-copy',
      pr: '123',
    });

    expect(consoleLog).toHaveBeenCalledWith('# Steward PR Link');
    consoleLog.mockRestore();
  });

  it('is a no-op when the PR already links the backlog item', async () => {
    mockSpawn.mockImplementation((...mockArgs: unknown[]) => {
      const [command, args] = mockArgs as [unknown, unknown[]];
      const argv = args as string[];
      if (command === 'gh' && argv[0] === 'pr' && argv[1] === 'view') {
        return createMockProcess(0, JSON.stringify({
          body: '## Summary\n\nSteward-Backlog-Item: fef39a30-18c1-4d12-bf42-c53381ce6c6a',
          number: 123,
          url: 'https://github.com/contextgraph/actions/pull/123',
        }));
      }
      throw new Error(`Unexpected command: ${String(command)} ${argv.join(' ')}`);
    });

    await runStewardBacklogLinkPr({
      identifier: 'seo-discovery/audit-and-rewrite-landing-page-hero-copy',
      pr: '123',
    });

    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });
});
