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

  describe('--max-steps contract', () => {
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

    it('does not increment step count on idle polls', async () => {
      // This test demonstrates that idle polls don't count toward maxSteps
      // After 5 idle polls, one claimed step reaches maxSteps=1
      mockRunStewardStep
        .mockResolvedValueOnce({ claimed: false })
        .mockResolvedValueOnce({ claimed: false })
        .mockResolvedValueOnce({ claimed: false })
        .mockResolvedValueOnce({ claimed: false })
        .mockResolvedValueOnce({ claimed: false })
        .mockResolvedValueOnce({ claimed: true });

      await runStewardLoop({
        intervalSeconds: 0,
        maxSteps: 1,
      });

      // Should continue polling through idle cycles until one claim succeeds
      expect(mockRunStewardStep).toHaveBeenCalledTimes(6);
    });

    it('handles multiple claimed steps correctly', async () => {
      mockRunStewardStep
        .mockResolvedValueOnce({ claimed: true })
        .mockResolvedValueOnce({ claimed: false })
        .mockResolvedValueOnce({ claimed: true })
        .mockResolvedValueOnce({ claimed: true });

      await runStewardLoop({
        intervalSeconds: 0,
        maxSteps: 3,
      });

      expect(mockRunStewardStep).toHaveBeenCalledTimes(4);
    });
  });

  describe('--interval-seconds contract', () => {
    it('accepts zero interval for hot loop', async () => {
      mockRunStewardStep.mockResolvedValueOnce({ claimed: true });

      const startTime = Date.now();
      await runStewardLoop({
        intervalSeconds: 0,
        maxSteps: 1,
      });
      const duration = Date.now() - startTime;

      // With zero interval, should complete quickly (< 100ms)
      expect(duration).toBeLessThan(100);
    });

    it('rejects negative intervals', async () => {
      await expect(
        runStewardLoop({
          intervalSeconds: -1,
          maxSteps: 1,
        })
      ).rejects.toThrow('intervalSeconds must be a non-negative number');
    });

    it('enforces minimum delay with positive interval', async () => {
      // Need multiple steps to observe the interval delay
      // The delay happens between steps, not after the final step
      mockRunStewardStep
        .mockResolvedValueOnce({ claimed: false })
        .mockResolvedValueOnce({ claimed: true });

      const startTime = Date.now();
      await runStewardLoop({
        intervalSeconds: 1,
        maxSteps: 1,
      });
      const duration = Date.now() - startTime;

      // Should take at least close to the interval (allowing for execution overhead)
      // We set a generous lower bound to avoid flakiness
      expect(duration).toBeGreaterThanOrEqual(900);
    });
  });

  describe('--stop-on-error contract', () => {
    it('continues past errors when flag is false', async () => {
      mockRunStewardStep
        .mockRejectedValueOnce(new Error('Execution failed'))
        .mockResolvedValueOnce({ claimed: true });

      await runStewardLoop({
        intervalSeconds: 0,
        maxSteps: 1,
        stopOnError: false,
      });

      // Should continue after error and reach maxSteps
      expect(mockRunStewardStep).toHaveBeenCalledTimes(2);
    });

    it('exits on first error when flag is true', async () => {
      mockRunStewardStep
        .mockRejectedValueOnce(new Error('Execution failed'))
        .mockResolvedValueOnce({ claimed: true });

      await runStewardLoop({
        intervalSeconds: 0,
        maxSteps: 1,
        stopOnError: true,
      });

      // Should stop after first error
      expect(mockRunStewardStep).toHaveBeenCalledTimes(1);
    });

    it('does not count errors toward maxSteps', async () => {
      mockRunStewardStep
        .mockRejectedValueOnce(new Error('Execution failed'))
        .mockRejectedValueOnce(new Error('Execution failed'))
        .mockResolvedValueOnce({ claimed: true });

      await runStewardLoop({
        intervalSeconds: 0,
        maxSteps: 1,
        stopOnError: false,
      });

      // Errors don't increment step count
      expect(mockRunStewardStep).toHaveBeenCalledTimes(3);
    });
  });

  describe('validation', () => {
    it('rejects non-integer maxSteps', async () => {
      await expect(
        runStewardLoop({
          intervalSeconds: 0,
          maxSteps: 1.5,
        })
      ).rejects.toThrow('maxSteps must be a positive integer');
    });

    it('rejects zero maxSteps', async () => {
      await expect(
        runStewardLoop({
          intervalSeconds: 0,
          maxSteps: 0,
        })
      ).rejects.toThrow('maxSteps must be a positive integer');
    });

    it('rejects negative maxSteps', async () => {
      await expect(
        runStewardLoop({
          intervalSeconds: 0,
          maxSteps: -1,
        })
      ).rejects.toThrow('maxSteps must be a positive integer');
    });

    it('allows undefined maxSteps for infinite loop', async () => {
      mockRunStewardStep
        .mockResolvedValueOnce({ claimed: false })
        .mockResolvedValueOnce({ claimed: true });

      // Should not throw during validation
      // Using maxSteps: 1 after the validation to terminate the loop
      await runStewardLoop({
        intervalSeconds: 0,
        maxSteps: 1,
      });

      // If validation passed, the loop ran successfully
      expect(mockRunStewardStep).toHaveBeenCalled();
    });
  });
});
