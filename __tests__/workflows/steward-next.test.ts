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

const mockNextStewardWork = jest.fn<() => Promise<any>>();
jest.unstable_mockModule('../../src/api-client.js', () => ({
  ApiClient: jest.fn(() => ({
    nextStewardWork: mockNextStewardWork,
  })),
}));

const mockSpawn = jest.fn<(...args: unknown[]) => ChildProcess>();
jest.unstable_mockModule('child_process', () => ({
  spawn: mockSpawn,
}));

const { runStewardNext } = await import('../../src/workflows/steward-next.js');

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

describe('runStewardNext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadCredentials.mockResolvedValue({
      clerkToken: 'test-token',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
    });
    mockIsExpired.mockReturnValue(false);
    mockIsTokenExpired.mockReturnValue(false);
  });

  it('creates the proposed branch after selecting the next backlog item', async () => {
    mockNextStewardWork.mockResolvedValue({
      steward: {
        name: 'Agent Platform',
        slug: 'agent-platform',
      },
      backlog_item: {
        id: 'backlog-1',
        title: 'Wire CLI command',
        backlog_reference: 'agent-platform/wire-cli-command',
        objective: 'Add steward next to the agent CLI',
        rationale: 'Humans need a manual claim flow',
        proposed_branch: 'feat/steward-next-cli',
        repository_url: 'https://github.com/contextgraph/agent',
      },
      workflow: {
        dismissal_command: 'steward backlog dismiss agent-platform/wire-cli-command --note "<reason>"',
        dismissal_rule: 'If invalid, dismiss it.',
        completion_rule: 'Merge webhook completes it.',
      },
    });
    mockSpawn.mockReturnValue(createMockProcess(0));

    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runStewardNext();

    expect(mockNextStewardWork).toHaveBeenCalled();
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['checkout', '-b', 'feat/steward-next-cli'],
      { cwd: undefined }
    );
    expect(consoleLog).toHaveBeenCalledWith('Title:', 'Wire CLI command');

    consoleLog.mockRestore();
  });

  it('prints a message and skips git when no work is queued', async () => {
    mockNextStewardWork.mockResolvedValue(null);

    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runStewardNext();

    expect(mockSpawn).not.toHaveBeenCalled();
    expect(consoleLog).toHaveBeenCalledWith('No queued steward backlog items right now.');

    consoleLog.mockRestore();
  });

  it('fails when no proposed branch is returned', async () => {
    mockNextStewardWork.mockResolvedValue({
      steward: {
        name: 'Agent Platform',
        slug: 'agent-platform',
      },
      backlog_item: {
        id: 'backlog-2',
        backlog_reference: 'agent-platform/triage-docs',
        title: 'Triage docs',
        objective: 'Review steward docs',
        rationale: 'No branch required',
        proposed_branch: null,
        repository_url: 'https://github.com/contextgraph/agent',
      },
    });

    await expect(runStewardNext()).rejects.toThrow(
      'API contract violation: claim route returned a backlog item without proposed_branch'
    );
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('surfaces git branch creation failures', async () => {
    mockNextStewardWork.mockResolvedValue({
      steward: {
        name: 'Agent Platform',
        slug: 'agent-platform',
      },
      backlog_item: {
        id: 'backlog-1',
        backlog_reference: 'agent-platform/wire-cli-command',
        title: 'Wire CLI command',
        objective: 'Add steward next to the agent CLI',
        rationale: 'Humans need a manual claim flow',
        proposed_branch: 'feat/steward-next-cli',
        repository_url: 'https://github.com/contextgraph/agent',
      },
    });
    mockSpawn.mockReturnValue(createMockProcess(128, '', 'fatal: a branch named already exists'));

    await expect(runStewardNext()).rejects.toThrow('git checkout -b feat/steward-next-cli failed');
  });
});
