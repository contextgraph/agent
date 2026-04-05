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

const mockGetStewardBacklogItem = jest.fn<(identifier: string) => Promise<any>>();
jest.unstable_mockModule('../../src/api-client.js', () => ({
  ApiClient: jest.fn(() => ({
    getStewardBacklogItem: mockGetStewardBacklogItem,
  })),
}));

const { runStewardBacklogItem } = await import('../../src/workflows/steward-backlog-item.js');

describe('runStewardBacklogItem', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsExpired.mockReturnValue(false);
    mockIsTokenExpired.mockReturnValue(false);
  });

  it('prints a queued backlog item and claim instructions', async () => {
    mockGetStewardBacklogItem.mockResolvedValue({
      steward: { name: 'Code Quality Steward', slug: 'code-quality-steward' },
      backlog_item: {
        id: 'backlog-1',
        title: 'Lock in validation logic with unit tests for evidence detection',
        backlog_reference: 'code-quality-steward/lock-in-validation-logic-with-unit-tests-for-evi',
        objective: 'Add comprehensive unit tests',
        rationale: 'Avoid regressions',
        proposed_branch: 'steward/code-quality-steward/lock-in-validation-logic-with-unit-tests-for-evi',
        repository_url: 'https://github.com/contextgraph/actions',
        priority_score: 97,
        state: 'queued',
      },
      workflow: {
        claim_command: 'steward backlog claim code-quality-steward/lock-in-validation-logic-with-unit-tests-for-evi',
      },
    });
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runStewardBacklogItem({
      identifier: 'code-quality-steward/lock-in-validation-logic-with-unit-tests-for-evi',
    });

    expect(mockGetStewardBacklogItem).toHaveBeenCalledWith(
      'code-quality-steward/lock-in-validation-logic-with-unit-tests-for-evi'
    );
    expect(consoleLog).toHaveBeenCalledWith('# Backlog Item');
    expect(consoleLog).toHaveBeenCalledWith('## Next Step');
    expect(consoleLog).toHaveBeenCalledWith('```bash');
    expect(consoleLog).toHaveBeenCalledWith(
      'steward backlog claim code-quality-steward/lock-in-validation-logic-with-unit-tests-for-evi'
    );
    consoleLog.mockRestore();
  });

  it('prints status messaging for an in-progress backlog item', async () => {
    mockGetStewardBacklogItem.mockResolvedValue({
      steward: { name: 'Code Quality Steward', slug: 'code-quality-steward' },
      backlog_item: {
        id: 'backlog-1',
        title: 'Lock in validation logic with unit tests for evidence detection',
        backlog_reference: 'code-quality-steward/lock-in-validation-logic-with-unit-tests-for-evi',
        objective: 'Add comprehensive unit tests',
        rationale: 'Avoid regressions',
        proposed_branch: 'steward/code-quality-steward/lock-in-validation-logic-with-unit-tests-for-evi',
        repository_url: 'https://github.com/contextgraph/actions',
        priority_score: 97,
        state: 'in_progress',
      },
      workflow: {},
    });
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runStewardBacklogItem({ identifier: 'backlog-1' });

    expect(consoleLog).toHaveBeenCalledWith('## Status');
    consoleLog.mockRestore();
  });
});
