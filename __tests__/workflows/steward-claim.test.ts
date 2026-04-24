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
const mockClaimStewardBacklog = jest.fn<(identifier: string, branch: string) => Promise<any>>();
jest.unstable_mockModule('../../src/api-client.js', () => ({
  ApiClient: jest.fn(() => ({
    nextStewardWork: mockNextStewardWork,
    claimStewardBacklog: mockClaimStewardBacklog,
  })),
}));

const mockDetectCurrentBranch = jest.fn<() => Promise<
  { kind: 'branch'; name: string } | { kind: 'detached' } | { kind: 'not-a-repo'; message: string }
>>();
jest.unstable_mockModule('../../src/git-current-branch.js', () => ({
  detectCurrentBranch: mockDetectCurrentBranch,
}));

const mockCaptureEvent = jest.fn<(distinctId: string, event: string, properties?: Record<string, unknown>) => void>();
jest.unstable_mockModule('../../src/posthog-client.js', () => ({
  captureEvent: mockCaptureEvent,
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
    mockDetectCurrentBranch.mockResolvedValue({ kind: 'branch', name: 'feature/my-branch' });
  });

  it('returns the next backlog item (no claim) when no identifier is provided', async () => {
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
    const printedOutput = consoleLog.mock.calls.map((call) => String(call[0])).join('\n');
    expect(printedOutput).toContain('Deprecated');
    consoleLog.mockRestore();
  });

  it('passes the current branch to the API when an identifier is provided', async () => {
    mockClaimStewardBacklog.mockResolvedValue({
      steward: { name: 'Agent Platform', slug: 'agent-platform' },
      backlog_item: {
        id: 'backlog-2',
        title: 'Triage docs',
        backlog_reference: 'agent-platform/triage-docs',
        objective: 'Review steward docs',
        rationale: 'Clarify usage',
        proposed_branch: 'feature/my-branch',
        repository_url: 'https://github.com/contextgraph/agent',
      },
    });
    await runStewardClaim({ identifier: 'agent-platform/triage-docs' });

    expect(mockClaimStewardBacklog).toHaveBeenCalledWith('agent-platform/triage-docs', 'feature/my-branch');
    expect(mockNextStewardWork).not.toHaveBeenCalled();
  });

  it('uses an explicit --branch override when provided', async () => {
    mockClaimStewardBacklog.mockResolvedValue({
      steward: { name: 'Agent Platform', slug: 'agent-platform' },
      backlog_item: {
        id: 'backlog-3',
        title: 'Explicit branch',
        backlog_reference: 'agent-platform/explicit-branch',
        objective: 'Override branch',
        rationale: 'CI sets explicit branch',
        proposed_branch: 'explicit/override',
        repository_url: 'https://github.com/contextgraph/agent',
      },
    });

    await runStewardClaim({ identifier: 'agent-platform/explicit-branch', branch: 'explicit/override' });

    expect(mockClaimStewardBacklog).toHaveBeenCalledWith('agent-platform/explicit-branch', 'explicit/override');
    expect(mockDetectCurrentBranch).not.toHaveBeenCalled();
  });

  it('fails fast with a clear message when HEAD is detached', async () => {
    mockDetectCurrentBranch.mockResolvedValue({ kind: 'detached' });
    await expect(
      runStewardClaim({ identifier: 'agent-platform/whatever' })
    ).rejects.toThrow(/detached/);
    expect(mockClaimStewardBacklog).not.toHaveBeenCalled();
  });

  it('fails fast when git is not available', async () => {
    mockDetectCurrentBranch.mockResolvedValue({ kind: 'not-a-repo', message: 'not a git repo' });
    await expect(
      runStewardClaim({ identifier: 'agent-platform/whatever' })
    ).rejects.toThrow(/git repository/);
    expect(mockClaimStewardBacklog).not.toHaveBeenCalled();
  });

  it('emits a steward_cli_claim_attempt success event with the resolved branch source', async () => {
    mockClaimStewardBacklog.mockResolvedValue({
      steward: { name: 'Agent Platform', slug: 'agent-platform' },
      backlog_item: {
        id: 'backlog-4',
        title: 'Event test',
        backlog_reference: 'agent-platform/event-test',
        objective: 'Emit events',
        rationale: 'Telemetry',
        proposed_branch: 'feature/my-branch',
        repository_url: 'https://github.com/contextgraph/agent',
      },
    });

    await runStewardClaim({ identifier: 'agent-platform/event-test' });

    expect(mockCaptureEvent).toHaveBeenCalledWith(
      'user-1',
      'steward_cli_claim_attempt',
      expect.objectContaining({
        outcome: 'success',
        branch_source: 'auto_detected',
        claimed_id: 'backlog-4',
      }),
    );
  });

  it('emits a steward_cli_claim_attempt event with outcome=branch_resolution_failed on detached HEAD', async () => {
    mockDetectCurrentBranch.mockResolvedValue({ kind: 'detached' });

    await expect(runStewardClaim({ identifier: 'agent-platform/whatever' })).rejects.toThrow();

    expect(mockCaptureEvent).toHaveBeenCalledWith(
      'user-1',
      'steward_cli_claim_attempt',
      expect.objectContaining({
        outcome: 'branch_resolution_failed',
        branch_source: 'detached_head',
      }),
    );
  });

  it('emits a steward_cli_claim_attempt event with outcome=api_error when the server rejects the claim', async () => {
    mockClaimStewardBacklog.mockRejectedValue(new Error('API error 409: branch_already_claimed'));

    await expect(runStewardClaim({ identifier: 'agent-platform/conflict' })).rejects.toThrow();

    expect(mockCaptureEvent).toHaveBeenCalledWith(
      'user-1',
      'steward_cli_claim_attempt',
      expect.objectContaining({
        outcome: 'api_error',
        branch_source: 'auto_detected',
        api_status: '409',
      }),
    );
  });
});
