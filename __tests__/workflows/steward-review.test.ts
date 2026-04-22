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

const mockStewardReview = jest.fn<(params: { repository: string; sha: string }) => Promise<any>>();
jest.unstable_mockModule('../../src/api-client.js', () => ({
  ApiClient: jest.fn(() => ({
    stewardReview: mockStewardReview,
  })),
}));

const { runStewardReview } = await import('../../src/workflows/steward-review.js');

describe('runStewardReview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsExpired.mockReturnValue(false);
    mockIsTokenExpired.mockReturnValue(false);
  });

  it('prints the rendered markdown from the API', async () => {
    mockStewardReview.mockResolvedValue({
      status: 'reviewed',
      summary: 'Stewards raised concerns.',
      markdown: '# Review\n\n- concern: missing auth guard',
      repository: { owner: 'contextgraph', repo: 'actions', url: 'https://github.com/contextgraph/actions' },
      sha: 'a1b2c3d4e5f67890abcdef1234567890abcdef12',
      diff_truncated: false,
      candidate_count: 1,
      stewards: [],
      observations: [],
    });
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runStewardReview({
      repository: 'contextgraph/actions',
      sha: 'a1b2c3d4e5f67890abcdef1234567890abcdef12',
    });

    expect(mockStewardReview).toHaveBeenCalledWith({
      repository: 'contextgraph/actions',
      sha: 'a1b2c3d4e5f67890abcdef1234567890abcdef12',
    });
    expect(consoleLog).toHaveBeenCalledWith('# Review\n\n- concern: missing auth guard');

    consoleLog.mockRestore();
  });

  it('rejects a SHA that is not hexadecimal', async () => {
    await expect(
      runStewardReview({
        repository: 'contextgraph/actions',
        sha: 'not-a-sha',
      })
    ).rejects.toThrow(/does not look like a commit SHA/);
    expect(mockStewardReview).not.toHaveBeenCalled();
  });

  it('rejects a SHA that is too short', async () => {
    await expect(
      runStewardReview({
        repository: 'contextgraph/actions',
        sha: 'abc123',
      })
    ).rejects.toThrow(/does not look like a commit SHA/);
    expect(mockStewardReview).not.toHaveBeenCalled();
  });

  it('rejects when repository is empty', async () => {
    await expect(
      runStewardReview({
        repository: '  ',
        sha: 'a1b2c3d4e5f67890abcdef1234567890abcdef12',
      })
    ).rejects.toThrow(/repository is required/);
    expect(mockStewardReview).not.toHaveBeenCalled();
  });

  it('trims whitespace before calling the API', async () => {
    mockStewardReview.mockResolvedValue({
      status: 'reviewed',
      summary: '',
      markdown: 'ok',
      repository: { owner: 'contextgraph', repo: 'actions', url: 'https://github.com/contextgraph/actions' },
      sha: 'a1b2c3d4e5f67890abcdef1234567890abcdef12',
      diff_truncated: false,
      candidate_count: 0,
      stewards: [],
      observations: [],
    });
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runStewardReview({
      repository: '  contextgraph/actions  ',
      sha: '  a1b2c3d4e5f67890abcdef1234567890abcdef12  ',
    });

    expect(mockStewardReview).toHaveBeenCalledWith({
      repository: 'contextgraph/actions',
      sha: 'a1b2c3d4e5f67890abcdef1234567890abcdef12',
    });

    consoleLog.mockRestore();
  });

  it('exits when credentials are expired', async () => {
    mockIsExpired.mockReturnValue(true);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);

    await expect(
      runStewardReview({
        repository: 'contextgraph/actions',
        sha: 'a1b2c3d4e5f67890abcdef1234567890abcdef12',
      })
    ).rejects.toThrow('process.exit');

    expect(consoleError).toHaveBeenCalledWith('Token expired.', 'Re-authenticate to continue.');
    expect(mockStewardReview).not.toHaveBeenCalled();

    exitSpy.mockRestore();
    consoleError.mockRestore();
  });
});
