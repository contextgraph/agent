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

const mockGetStewardMission = jest.fn<(identifier: string) => Promise<any>>();
jest.unstable_mockModule('../../src/api-client.js', () => ({
  ApiClient: jest.fn(() => ({
    getStewardMission: mockGetStewardMission,
  })),
}));

const { runStewardMission } = await import('../../src/workflows/steward-mission.js');

describe('runStewardMission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsExpired.mockReturnValue(false);
    mockIsTokenExpired.mockReturnValue(false);
  });

  it('prints a steward mission', async () => {
    mockGetStewardMission.mockResolvedValue({
      steward: {
        name: 'Observability',
        slug: 'observability',
        mission: 'Protect traceability across the platform.',
      },
    });
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runStewardMission({ steward: 'observability' });

    expect(mockGetStewardMission).toHaveBeenCalledWith('observability');
    expect(consoleLog).toHaveBeenCalledWith('Mission:', 'Protect traceability across the platform.');
    consoleLog.mockRestore();
  });
});
