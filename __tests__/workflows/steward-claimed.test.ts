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

const mockListClaimedStewardBacklog = jest.fn<() => Promise<any>>();
jest.unstable_mockModule('../../src/api-client.js', () => ({
  ApiClient: jest.fn(() => ({
    listClaimedStewardBacklog: mockListClaimedStewardBacklog,
  })),
}));

const { runStewardClaimed } = await import('../../src/workflows/steward-claimed.js');

describe('runStewardClaimed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsExpired.mockReturnValue(false);
    mockIsTokenExpired.mockReturnValue(false);
  });

  it('prints claimed backlog items', async () => {
    mockListClaimedStewardBacklog.mockResolvedValue([{
      steward: { name: 'Agent Platform', slug: 'agent-platform' },
      backlog_item: {
        id: 'backlog-1',
        title: 'Wire CLI command',
        backlog_reference: 'agent-platform/wire-cli-command',
        proposed_branch: 'feat/steward-next-cli',
        state: 'in_progress',
      },
    }]);
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runStewardClaimed();

    expect(mockListClaimedStewardBacklog).toHaveBeenCalled();
    expect(consoleLog).toHaveBeenCalledWith('# Claimed Steward Backlog');
    expect(consoleLog).toHaveBeenCalledWith('- Inspect these items before claiming anything new.');
    expect(consoleLog).toHaveBeenCalledWith('## Claimed Item');
    expect(consoleLog).toHaveBeenCalledWith('- State: in_progress');
    expect(consoleLog).toHaveBeenCalledWith('- Recovery: Use this item for context recovery instead of claiming a new one.');
    consoleLog.mockRestore();
  });
});
