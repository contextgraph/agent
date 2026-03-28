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

const mockCreateStewardBacklog = jest.fn<(params: any) => Promise<any>>();
jest.unstable_mockModule('../../src/api-client.js', () => ({
  ApiClient: jest.fn(() => ({
    createStewardBacklog: mockCreateStewardBacklog,
  })),
}));

const { runStewardBacklogCreate } = await import('../../src/workflows/steward-backlog-create.js');

describe('runStewardBacklogCreate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsExpired.mockReturnValue(false);
    mockIsTokenExpired.mockReturnValue(false);
  });

  it('creates a backlog item and prints the generated branch', async () => {
    mockCreateStewardBacklog.mockResolvedValue({
      steward: { name: 'Observability', slug: 'observability' },
      backlog_item: {
        id: 'backlog-1',
        title: 'Add correlation IDs to heartbeat logs',
        backlog_reference: 'observability/add-correlation-ids-to-heartbeat-logs',
        proposed_branch: 'steward/observability/add-correlation-ids-to-heartbeat-logs',
        state: 'queued',
      },
    });
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runStewardBacklogCreate({
      steward: 'observability',
      title: 'Add correlation IDs to heartbeat logs',
      objective: 'Thread correlation metadata into heartbeat and queue logs.',
      rationale: 'This is the smallest confident slice of the larger effort.',
      repository_url: 'https://github.com/contextgraph/actions',
    });

    expect(mockCreateStewardBacklog).toHaveBeenCalledWith(expect.objectContaining({
      steward: 'observability',
      repository_url: 'https://github.com/contextgraph/actions',
    }));
    expect(consoleLog).toHaveBeenCalledWith('# Steward Backlog Item');
    expect(consoleLog).toHaveBeenCalledWith('- Branch: steward/observability/add-correlation-ids-to-heartbeat-logs');
    consoleLog.mockRestore();
  });
});
