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

const mockNextStewardWork = jest.fn<() => Promise<any>>();
const mockClaimStewardBacklog = jest.fn<(identifier: string) => Promise<any>>();
jest.unstable_mockModule('../../src/api-client.js', () => ({
  ApiClient: jest.fn(() => ({
    nextStewardWork: mockNextStewardWork,
    claimStewardBacklog: mockClaimStewardBacklog,
  })),
}));

const { runStewardClaim } = await import('../../src/workflows/steward-claim.js');

describe('runStewardClaim', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadCredentials.mockResolvedValue({
      clerkToken: 'test-token',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
    });
    mockIsExpired.mockReturnValue(false);
    mockIsTokenExpired.mockReturnValue(false);
  });

  it('claims the next backlog item when no identifier is provided', async () => {
    mockNextStewardWork.mockResolvedValue({
      steward: { name: 'Agent Platform', slug: 'agent-platform' },
      backlog_item: {
        id: 'backlog-1',
        title: 'Wire CLI command',
        backlog_reference: 'agent-platform/wire-cli-command',
        objective: 'Add steward next to the agent CLI',
        rationale: 'Humans need a manual claim flow',
        proposed_branch: 'feat/steward-next-cli',
        repository_url: 'https://github.com/contextgraph/agent',
        metadata: {
          fileSurfaceConjecture: 'Likely touches src/cli/index.ts and src/workflows/steward-next.ts.',
        },
      },
      workflow: {
        session_rule: 'After you open or update a PR, stop and wait for the user.',
      },
    });
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runStewardClaim();

    expect(mockNextStewardWork).toHaveBeenCalled();
    expect(mockClaimStewardBacklog).not.toHaveBeenCalled();
    expect(consoleLog).toHaveBeenCalledWith('## Stop Rule');
    expect(consoleLog).toHaveBeenCalledWith('## File Surface Conjecture');
    expect(consoleLog).toHaveBeenCalledWith(
      '  Likely touches src/cli/index.ts and src/workflows/steward-next.ts.'
    );
    expect(consoleLog).toHaveBeenCalledWith('## Preferred Branch');
    expect(consoleLog).toHaveBeenCalledWith('## Workspace Setup');
    expect(consoleLog).toHaveBeenCalledWith('## PR Linking');
    expect(consoleLog).toHaveBeenCalledWith('## Next Step');
    const printedOutput = consoleLog.mock.calls.map((call) => String(call[0])).join('\n').replace(/\s+/g, ' ');
    expect(printedOutput).toContain('Preferred branch: `feat/steward-next-cli`');
    expect(printedOutput).toContain('harness-assigned branch');
    expect(printedOutput).toContain('steward backlog link-pr agent-platform/wire-cli-command --pr');
    consoleLog.mockRestore();
  });

  it('claims a specific backlog item when an identifier is provided', async () => {
    mockClaimStewardBacklog.mockResolvedValue({
      steward: { name: 'Agent Platform', slug: 'agent-platform' },
      backlog_item: {
        id: 'backlog-2',
        title: 'Triage docs',
        backlog_reference: 'agent-platform/triage-docs',
        objective: 'Review steward docs',
        rationale: 'Clarify usage',
        proposed_branch: 'docs/triage-docs',
        repository_url: 'https://github.com/contextgraph/agent',
      },
    });
    await runStewardClaim({ identifier: 'agent-platform/triage-docs' });

    expect(mockClaimStewardBacklog).toHaveBeenCalledWith('agent-platform/triage-docs');
    expect(mockNextStewardWork).not.toHaveBeenCalled();
  });
});
