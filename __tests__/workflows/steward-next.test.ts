import { beforeEach, describe, expect, it, jest } from '@jest/globals';

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
const mockClaimStewardBacklog = jest.fn<(...args: unknown[]) => Promise<any>>();
jest.unstable_mockModule('../../src/api-client.js', () => ({
  ApiClient: jest.fn(() => ({
    nextStewardWork: mockNextStewardWork,
    claimStewardBacklog: mockClaimStewardBacklog,
  })),
}));

const mockDetectCurrentBranch = jest.fn<() => Promise<any>>();
jest.unstable_mockModule('../../src/git-current-branch.js', () => ({
  detectCurrentBranch: mockDetectCurrentBranch,
}));

const mockCaptureEvent = jest.fn();
jest.unstable_mockModule('../../src/posthog-client.js', () => ({
  captureEvent: mockCaptureEvent,
}));

const { runStewardNext } = await import('../../src/workflows/steward-next.js');

const BACKLOG_ITEM = {
  id: 'backlog-1',
  title: 'Wire CLI command',
  backlog_reference: 'agent-platform/wire-cli-command',
  objective: 'Add steward next to the agent CLI',
  rationale: 'Humans need a manual claim flow',
  repository_url: 'https://github.com/contextgraph/agent',
};

const STEWARD = {
  name: 'Agent Platform',
  slug: 'agent-platform',
};

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

  it('prints the claim summary for the top queued item without registering a branch', async () => {
    mockNextStewardWork.mockResolvedValue({
      steward: STEWARD,
      backlog_item: BACKLOG_ITEM,
      workflow: {
        dismissal_command: 'steward backlog dismiss agent-platform/wire-cli-command --note "<reason>"',
        dismissal_rule: 'If invalid, dismiss it.',
        completion_rule: 'Merge webhook completes it.',
      },
    });

    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runStewardNext();

    expect(mockNextStewardWork).toHaveBeenCalled();
    // No identifier => the top item is inspected, not claimed. No branch is registered.
    expect(mockClaimStewardBacklog).not.toHaveBeenCalled();
    expect(mockDetectCurrentBranch).not.toHaveBeenCalled();

    expect(consoleLog).toHaveBeenCalledWith('# Steward Claim');
    expect(consoleLog).toHaveBeenCalledWith('## Objective');
    expect(consoleLog).toHaveBeenCalledWith('  Add steward next to the agent CLI');
    expect(consoleLog).toHaveBeenCalledWith('## Rationale');
    expect(consoleLog).toHaveBeenCalledWith('## Workflow');
    expect(consoleLog).toHaveBeenCalledWith(
      'Deprecated: shortcut `steward backlog claim` without an identifier returns the top queued item but does not register a branch.'
    );

    consoleLog.mockRestore();
  });

  it('prints a message and skips claiming when no work is queued', async () => {
    mockNextStewardWork.mockResolvedValue(null);

    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runStewardNext();

    expect(mockClaimStewardBacklog).not.toHaveBeenCalled();
    expect(consoleLog).toHaveBeenCalledWith('No queued steward backlog items right now.');

    consoleLog.mockRestore();
  });

  it('registers the resolved branch when claiming a specific identifier', async () => {
    mockDetectCurrentBranch.mockResolvedValue({ kind: 'branch', name: 'feat/steward-next-cli' });
    mockClaimStewardBacklog.mockResolvedValue({
      steward: STEWARD,
      backlog_item: BACKLOG_ITEM,
    });

    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runStewardNext({ identifier: 'agent-platform/wire-cli-command' });

    expect(mockNextStewardWork).not.toHaveBeenCalled();
    expect(mockClaimStewardBacklog).toHaveBeenCalledWith(
      'agent-platform/wire-cli-command',
      'feat/steward-next-cli'
    );
    expect(consoleLog).toHaveBeenCalledWith('## Registered Branch');
    expect(consoleLog).toHaveBeenCalledWith('## Next Step');

    consoleLog.mockRestore();
  });

  it('fails when claiming without a branch checkout (detached HEAD)', async () => {
    mockDetectCurrentBranch.mockResolvedValue({ kind: 'detached' });

    await expect(runStewardNext({ identifier: 'agent-platform/wire-cli-command' })).rejects.toThrow(
      'steward backlog claim requires a branch checkout. HEAD is detached.'
    );
    expect(mockClaimStewardBacklog).not.toHaveBeenCalled();
  });

  it('surfaces claim API failures', async () => {
    mockDetectCurrentBranch.mockResolvedValue({ kind: 'branch', name: 'feat/steward-next-cli' });
    mockClaimStewardBacklog.mockRejectedValue(new Error('API error 409: already claimed'));

    await expect(runStewardNext({ identifier: 'agent-platform/wire-cli-command' })).rejects.toThrow(
      'API error 409: already claimed'
    );
  });
});
