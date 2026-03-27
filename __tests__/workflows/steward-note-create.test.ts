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

const mockCreateStewardNote = jest.fn<(params: any) => Promise<any>>();
jest.unstable_mockModule('../../src/api-client.js', () => ({
  ApiClient: jest.fn(() => ({
    createStewardNote: mockCreateStewardNote,
  })),
}));

const { runStewardNoteCreate } = await import('../../src/workflows/steward-note-create.js');

describe('runStewardNoteCreate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsExpired.mockReturnValue(false);
    mockIsTokenExpired.mockReturnValue(false);
  });

  it('creates a steward note linked to a backlog item', async () => {
    mockCreateStewardNote.mockResolvedValue({
      steward: { name: 'Observability', slug: 'observability' },
      note: {
        id: 'note-1',
        createdAt: '2026-03-27T12:05:00.000Z',
        metadata: { backlogReference: 'observability/add-correlation-ids-to-heartbeat-logs' },
      },
    });
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runStewardNoteCreate({
      steward: 'observability',
      note: 'Split out the heartbeat logger work as the smallest safe slice.',
      backlogItem: 'observability/add-correlation-ids-to-heartbeat-logs',
    });

    expect(mockCreateStewardNote).toHaveBeenCalledWith({
      steward: 'observability',
      note: 'Split out the heartbeat logger work as the smallest safe slice.',
      backlog_item: 'observability/add-correlation-ids-to-heartbeat-logs',
    });
    expect(consoleLog).toHaveBeenCalledWith('Backlog Ref:', 'observability/add-correlation-ids-to-heartbeat-logs');
    consoleLog.mockRestore();
  });
});
