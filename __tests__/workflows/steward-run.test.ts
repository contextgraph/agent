import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('chalk', () => ({
  default: {
    bold: (s: string) => s,
    dim: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s,
  },
  __esModule: true,
}));

const mockRunStewardStep = jest.fn<() => Promise<{ claimed: boolean }>>();

jest.mock('../../src/workflows/steward-step.js', () => ({
  runStewardStep: mockRunStewardStep,
}));

import { runStewardLoop } from '../../src/workflows/steward-run.js';

describe('runStewardLoop', () => {
  beforeEach(() => {
    mockRunStewardStep.mockReset();
  });

  it('counts only claimed work toward maxSteps', async () => {
    mockRunStewardStep
      .mockResolvedValueOnce({ claimed: false })
      .mockResolvedValueOnce({ claimed: false })
      .mockResolvedValueOnce({ claimed: true });

    await runStewardLoop({
      intervalSeconds: 0,
      maxSteps: 1,
    });

    expect(mockRunStewardStep).toHaveBeenCalledTimes(3);
  });
});
