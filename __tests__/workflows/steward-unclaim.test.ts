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

const mockUnclaimStewardBacklog = jest.fn<(identifier: string) => Promise<any>>();
jest.unstable_mockModule('../../src/api-client.js', () => ({
  ApiClient: jest.fn(() => ({
    unclaimStewardBacklog: mockUnclaimStewardBacklog,
  })),
}));

const { runStewardUnclaim } = await import('../../src/workflows/steward-unclaim.js');

describe('runStewardUnclaim', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsExpired.mockReturnValue(false);
    mockIsTokenExpired.mockReturnValue(false);
  });

  it('unclaims a backlog item by reference', async () => {
    mockUnclaimStewardBacklog.mockResolvedValue({
      backlog_item: {
        id: 'backlog-1',
        title: 'Wire CLI command',
        backlog_reference: 'agent-platform/wire-cli-command',
        state: 'queued',
      },
    });
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runStewardUnclaim({ identifier: 'agent-platform/wire-cli-command' });

    expect(mockUnclaimStewardBacklog).toHaveBeenCalledWith('agent-platform/wire-cli-command');
    expect(consoleLog).toHaveBeenCalledWith('# Steward Unclaim');
    expect(consoleLog).toHaveBeenCalledWith('- State: queued');
    expect(consoleLog).toHaveBeenCalledWith('- Result: This backlog item is back in the queue and can be claimed again later.');
    consoleLog.mockRestore();
  });
});
