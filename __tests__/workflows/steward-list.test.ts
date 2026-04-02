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

const mockListStewards = jest.fn<() => Promise<any[]>>();
jest.unstable_mockModule('../../src/api-client.js', () => ({
  ApiClient: jest.fn(() => ({
    listStewards: mockListStewards,
  })),
}));

const { runStewardList } = await import('../../src/workflows/steward-list.js');

describe('runStewardList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsExpired.mockReturnValue(false);
    mockIsTokenExpired.mockReturnValue(false);
  });

  it('prints visible stewards', async () => {
    mockListStewards.mockResolvedValue([
      {
        id: '8845d31f-497c-4c93-8b6d-8de13a1c7fb4',
        name: 'Axiom logging',
        slug: 'axiom-logging-steward',
        mission: 'Validate production logging quality.',
        status: 'active',
        organizationId: null,
        updatedAt: '2026-04-02T00:00:00.000Z',
      },
    ]);
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runStewardList();

    expect(mockListStewards).toHaveBeenCalled();
    expect(consoleLog).toHaveBeenCalledWith('# Stewards');
    expect(consoleLog).toHaveBeenCalledWith('## Axiom logging');
    expect(consoleLog).toHaveBeenCalledWith('- ID: 8845d31f-497c-4c93-8b6d-8de13a1c7fb4');
    expect(consoleLog).toHaveBeenCalledWith('- Slug: axiom-logging-steward');
    expect(consoleLog).toHaveBeenCalledWith('Mission:');
    consoleLog.mockRestore();
  });

  it('prints a warning when no stewards are visible', async () => {
    mockListStewards.mockResolvedValue([]);
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runStewardList();

    expect(consoleLog).toHaveBeenCalledWith('No visible stewards right now.');
    consoleLog.mockRestore();
  });

  it('prints organization id for organization-scoped stewards', async () => {
    mockListStewards.mockResolvedValue([
      {
        id: '8845d31f-497c-4c93-8b6d-8de13a1c7fb4',
        name: 'Axiom logging',
        slug: 'axiom-logging-steward',
        mission: 'Validate production logging quality.',
        status: 'active',
        organizationId: '00000000-0000-4000-8000-000000000001',
        updatedAt: '2026-04-02T00:00:00.000Z',
      },
    ]);
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runStewardList();

    expect(consoleLog).toHaveBeenCalledWith('- Organization ID: 00000000-0000-4000-8000-000000000001');
    expect(consoleLog).not.toHaveBeenCalledWith('- Scope: personal');
    consoleLog.mockRestore();
  });

  it('exits when stored credentials are expired', async () => {
    mockIsExpired.mockReturnValue(true);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);

    await expect(runStewardList()).rejects.toThrow('process.exit');

    expect(consoleError).toHaveBeenCalledWith('Token expired.', 'Re-authenticate to continue.');
    expect(mockListStewards).not.toHaveBeenCalled();

    exitSpy.mockRestore();
    consoleError.mockRestore();
  });

  it('exits when the auth token is expired', async () => {
    mockIsTokenExpired.mockReturnValue(true);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);

    await expect(runStewardList()).rejects.toThrow('process.exit');

    expect(consoleError).toHaveBeenCalledWith('Token expired.', 'Re-authenticate to continue.');
    expect(mockListStewards).not.toHaveBeenCalled();

    exitSpy.mockRestore();
    consoleError.mockRestore();
  });
});
