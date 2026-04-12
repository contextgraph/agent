import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('chalk', () => ({
  default: {
    bold: (s: string) => s,
    dim: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s,
  },
  __esModule: true,
}));

const mockRunStewardStep: any = jest.fn();
const mockTopStewardQueue: any = jest.fn();

jest.unstable_mockModule('../../src/workflows/steward-step.js', () => ({
  runStewardStep: mockRunStewardStep,
}));

jest.unstable_mockModule('../../src/api-client.js', () => ({
  ApiClient: jest.fn(() => ({
    topStewardQueue: mockTopStewardQueue,
  })),
}));

const { runStewardLoop, getStewardRunModeInfo } = await import('../../src/workflows/steward-run.js');

const ORIGINAL_ENV = { ...process.env };

describe('runStewardLoop', () => {
  beforeEach(() => {
    mockRunStewardStep.mockReset();
    mockTopStewardQueue.mockReset();
    process.env = { ...ORIGINAL_ENV };
  });

  it('counts only claimed work toward maxSteps', async () => {
    mockTopStewardQueue.mockResolvedValue({
      steward: { id: 'steward-1', name: 'Code Quality Steward' },
      backlog_item: { title: 'Top item' },
    });
    mockRunStewardStep
      .mockResolvedValueOnce({ claimed: false })
      .mockResolvedValueOnce({ claimed: false })
      .mockResolvedValueOnce({ claimed: true });

    await runStewardLoop({
      intervalSeconds: 0,
      maxSteps: 1,
    });

    expect(mockRunStewardStep).toHaveBeenCalledTimes(3);
    expect(mockTopStewardQueue).toHaveBeenCalledTimes(3);
    expect(mockTopStewardQueue).toHaveBeenCalledWith(undefined, { mode: 'run' });
  });

  it('waits for a run-ready queue item before claiming a step', async () => {
    mockTopStewardQueue
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        steward: { id: 'steward-1', name: 'Code Quality Steward' },
        backlog_item: { title: 'Top item' },
      });
    mockRunStewardStep.mockResolvedValueOnce({ claimed: true });

    await runStewardLoop({
      intervalSeconds: 0,
      maxSteps: 1,
    });

    expect(mockTopStewardQueue).toHaveBeenCalledTimes(2);
    expect(mockRunStewardStep).toHaveBeenCalledTimes(1);
    expect(mockRunStewardStep).toHaveBeenCalledWith(
      expect.objectContaining({
        stewardId: 'steward-1',
      })
    );
  });
});

describe('getStewardRunModeInfo', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('infers global-worker when api token matches global worker token', () => {
    process.env.CONTEXTGRAPH_API_TOKEN = 'token-abc';
    process.env.STEWARD_GLOBAL_WORKER_TOKEN = 'token-abc';

    expect(getStewardRunModeInfo()).toEqual(
      expect.objectContaining({
        authSource: 'env-api-token',
        inferredScopeMode: 'global-worker',
      })
    );
  });

  it('infers user-scoped when api token differs from global worker token', () => {
    process.env.CONTEXTGRAPH_API_TOKEN = 'token-abc';
    process.env.STEWARD_GLOBAL_WORKER_TOKEN = 'token-def';

    expect(getStewardRunModeInfo()).toEqual(
      expect.objectContaining({
        authSource: 'env-api-token',
        inferredScopeMode: 'user-scoped',
      })
    );
  });

  it('infers user-scoped with stored credentials when no api token env var exists', () => {
    delete process.env.CONTEXTGRAPH_API_TOKEN;
    delete process.env.STEWARD_GLOBAL_WORKER_TOKEN;

    expect(getStewardRunModeInfo()).toEqual(
      expect.objectContaining({
        authSource: 'stored-credentials',
        inferredScopeMode: 'user-scoped',
      })
    );
  });
});
