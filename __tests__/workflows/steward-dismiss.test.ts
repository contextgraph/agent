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

const mockDismissStewardBacklog = jest.fn<(identifier: string, note: string) => Promise<any>>();
jest.unstable_mockModule('../../src/api-client.js', () => ({
  ApiClient: jest.fn(() => ({
    dismissStewardBacklog: mockDismissStewardBacklog,
  })),
}));

const { runStewardDismiss } = await import('../../src/workflows/steward-dismiss.js');

describe('runStewardDismiss', () => {
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

  it('dismisses a backlog item by reference and prints the note', async () => {
    mockDismissStewardBacklog.mockResolvedValue({
      backlog_item: {
        id: 'backlog-1',
        state: 'dismissed',
        title: 'Wire CLI command',
        backlog_reference: 'agent-platform/wire-cli-command',
      },
      note: {
        id: 'note-1',
        content: 'Already landed in PR #100.',
        createdAt: '2026-03-27T12:00:00.000Z',
      },
    });

    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runStewardDismiss({
      identifier: 'agent-platform/wire-cli-command',
      note: 'Already landed in PR #100.',
    });

    expect(mockDismissStewardBacklog).toHaveBeenCalledWith(
      'agent-platform/wire-cli-command',
      'Already landed in PR #100.'
    );
    expect(consoleLog).toHaveBeenCalledWith('State:', 'dismissed');

    consoleLog.mockRestore();
  });

  it('requires a note', async () => {
    await expect(runStewardDismiss({
      identifier: 'agent-platform/wire-cli-command',
      note: '   ',
    })).rejects.toThrow('note is required');
    expect(mockDismissStewardBacklog).not.toHaveBeenCalled();
  });
});
