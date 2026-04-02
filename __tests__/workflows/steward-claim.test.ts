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
const mockGetIntegrationSurfaces = jest.fn<() => Promise<any[]>>();
jest.unstable_mockModule('../../src/api-client.js', () => ({
  ApiClient: jest.fn(() => ({
    nextStewardWork: mockNextStewardWork,
    claimStewardBacklog: mockClaimStewardBacklog,
    getIntegrationSurfaces: mockGetIntegrationSurfaces,
  })),
}));

const { runStewardClaim } = await import('../../src/workflows/steward-claim.js');

describe('runStewardClaim', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AXIOM_TOKEN;
    mockLoadCredentials.mockResolvedValue({
      clerkToken: 'test-token',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
    });
    mockIsExpired.mockReturnValue(false);
    mockIsTokenExpired.mockReturnValue(false);
    mockGetIntegrationSurfaces.mockResolvedValue([]);
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
    expect(consoleLog).toHaveBeenCalledWith('## Required Branch');
    expect(consoleLog).toHaveBeenCalledWith('## Workspace Setup');
    expect(consoleLog).toHaveBeenCalledWith('## PR Linking');
    expect(consoleLog).toHaveBeenCalledWith('## Next Step');
    consoleLog.mockRestore();
  });

  it('prints available integrations when matching env vars exist locally', async () => {
    process.env.AXIOM_TOKEN = 'axiom-token';
    mockClaimStewardBacklog.mockResolvedValue({
      steward: { name: 'Axiom Logging', slug: 'axiom-logging' },
      backlog_item: {
        id: 'backlog-3',
        title: 'Verify correlation IDs are queryable in production logs',
        backlog_reference: 'axiom-logging/verify-correlation-ids-queryable',
        objective: 'Inspect production logs and confirm correlation fields are present.',
        rationale: 'This backlog item requires real production evidence from Axiom.',
        proposed_branch: 'axiom/check-correlation-fields',
        repository_url: 'https://github.com/contextgraph/actions',
      },
    });
    mockGetIntegrationSurfaces.mockResolvedValue([
      {
        key: 'axiom',
        name: 'Axiom',
        defaultEndpoint: 'https://api.axiom.co',
        envVars: ['AXIOM_TOKEN'],
        description: 'Production log sink connected to Vercel for server logs and observability data.',
        usageReference: 'Inspect logs, traces, and queryable production evidence.',
      },
    ]);
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runStewardClaim({ identifier: 'axiom-logging/verify-correlation-ids-queryable' });

    expect(consoleLog).toHaveBeenCalledWith('## Available Integrations');
    expect(consoleLog).toHaveBeenCalledWith('- Axiom (axiom)');
    expect(consoleLog).toHaveBeenCalledWith('  Endpoint: https://api.axiom.co');
    expect(consoleLog).toHaveBeenCalledWith('  Available env vars: AXIOM_TOKEN');
    expect(consoleLog).toHaveBeenCalledWith('  Production log sink connected to Vercel for server logs and observability data.');
    expect(consoleLog).toHaveBeenCalledWith('  Use for: Inspect logs, traces, and queryable production evidence.');
    consoleLog.mockRestore();
  });

  it('continues when integration surface discovery fails', async () => {
    mockClaimStewardBacklog.mockResolvedValue({
      steward: { name: 'Axiom Logging', slug: 'axiom-logging' },
      backlog_item: {
        id: 'backlog-4',
        title: 'Check production evidence',
        backlog_reference: 'axiom-logging/check-production-evidence',
        objective: 'Use production evidence to verify a logging assumption.',
        rationale: 'The task should still be claimable if integration discovery fails.',
        proposed_branch: 'axiom/check-production-evidence',
        repository_url: 'https://github.com/contextgraph/actions',
      },
    });
    mockGetIntegrationSurfaces.mockRejectedValue(new Error('network down'));
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await runStewardClaim({ identifier: 'axiom-logging/check-production-evidence' });

    expect(consoleWarn).toHaveBeenCalledWith('Warning: failed to load integration surfaces: network down');
    consoleWarn.mockRestore();
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
