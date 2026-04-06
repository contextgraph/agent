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

const mockTopStewardQueue = jest.fn<(steward?: string) => Promise<any>>();
jest.unstable_mockModule('../../src/api-client.js', () => ({
  ApiClient: jest.fn(() => ({
    topStewardQueue: mockTopStewardQueue,
  })),
}));

const { runStewardTop } = await import('../../src/workflows/steward-top.js');

describe('runStewardTop', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsExpired.mockReturnValue(false);
    mockIsTokenExpired.mockReturnValue(false);
  });

  it('prints the top backlog item and explicit claim instructions', async () => {
    mockTopStewardQueue.mockResolvedValue({
      queue_item: {
        id: 'backlog-1',
        type: 'backlog',
        title: 'Lock in validation logic with unit tests for evidence detection',
        rationale: 'Avoid regressions',
        priority_score: 97,
        state: 'queued',
      },
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
        metadata: {
          fileSurfaceConjecture: ['lib/evidence.ts', 'lib/validation.ts'],
        },
      },
      workflow: {
        selection_rule: 'This is currently the highest-priority queue item, and it is a backlog item.',
        claim_command: 'steward queue claim backlog-1',
        fallback_claim_command: 'steward backlog claim code-quality-steward/lock-in-validation-logic-with-unit-tests-for-evi',
        session_rule: 'Claim at most one backlog item at a time.',
      },
    });
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runStewardTop();

    expect(mockTopStewardQueue).toHaveBeenCalled();
    expect(consoleLog).toHaveBeenCalledWith('# Top Backlog Item');
    expect(consoleLog).toHaveBeenCalledWith('## File Surface Conjecture');
    expect(consoleLog).toHaveBeenCalledWith('## Next Step');
    expect(consoleLog).toHaveBeenCalledWith('  Claim this backlog item before doing any work on it.');
    expect(consoleLog).toHaveBeenCalledWith('```bash');
    expect(consoleLog).toHaveBeenCalledWith('steward queue claim backlog-1');
    expect(consoleLog).toHaveBeenCalledWith('## Stop Rule');
    const printedOutput = consoleLog.mock.calls.map((call) => String(call[0])).join('\n');
    expect(printedOutput).toContain('"lib/evidence.ts"');
    expect(printedOutput).toContain('"lib/validation.ts"');
    consoleLog.mockRestore();
  });

  it('forwards an optional steward selector', async () => {
    mockTopStewardQueue.mockResolvedValue({
      queue_item: {
        id: 'backlog-2',
        type: 'backlog',
        title: 'Remove obsolete branch cleanup fallback',
        rationale: 'Reduce code surface area',
        priority_score: 91,
        state: 'queued',
      },
      steward: { name: 'Codebase Pruning', slug: 'codebase-pruning' },
      backlog_item: {
        id: 'backlog-2',
        title: 'Remove obsolete branch cleanup fallback',
        backlog_reference: 'codebase-pruning/remove-obsolete-branch-cleanup-fallback',
        objective: 'Delete dead fallback logic',
        rationale: 'Reduce code surface area',
        proposed_branch: 'steward/codebase-pruning/remove-obsolete-branch-cleanup-fallback',
        repository_url: 'https://github.com/contextgraph/actions',
        priority_score: 91,
      },
      workflow: {
        claim_command: 'steward backlog claim codebase-pruning/remove-obsolete-branch-cleanup-fallback',
      },
    });
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runStewardTop({ steward: 'codebase-pruning' });

    expect(mockTopStewardQueue).toHaveBeenCalledWith('codebase-pruning');
    consoleLog.mockRestore();
  });
});
