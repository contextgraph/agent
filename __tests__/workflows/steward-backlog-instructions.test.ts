import { describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('chalk', () => ({
  default: {
    bold: (s: string) => s,
  },
  __esModule: true,
}));

const { runStewardBacklogInstructions } = await import('../../src/workflows/steward-backlog-instructions.js');

describe('runStewardBacklogInstructions', () => {
  it('prints the manual backlog workflow', () => {
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    runStewardBacklogInstructions();

    expect(consoleLog).toHaveBeenCalledWith('# Manual Backlog Workflow');
    expect(consoleLog).toHaveBeenCalledWith('- 1. Inspect the top item with `steward backlog top`.');
    expect(consoleLog).toHaveBeenCalledWith('- 7. If you need to recover context, use `steward backlog claimed` instead of claiming another item.');

    consoleLog.mockRestore();
  });
});
