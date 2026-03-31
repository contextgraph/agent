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

const mockLoadCredentials = jest.fn<() => Promise<unknown>>();
const mockIsExpired = jest.fn<() => boolean>();
const mockIsTokenExpired = jest.fn<() => boolean>();
jest.unstable_mockModule('../../src/credentials.js', () => ({
  loadCredentials: mockLoadCredentials,
  isExpired: mockIsExpired,
  isTokenExpired: mockIsTokenExpired,
}));

const mockClaimNextSteward = jest.fn();
const mockReleaseStewardClaim = jest.fn<() => Promise<void>>();
const mockGetIntegrationSurfaces = jest.fn();
jest.unstable_mockModule('../../src/api-client.js', () => ({
  ApiClient: jest.fn(() => ({
    claimNextSteward: mockClaimNextSteward,
    releaseStewardClaim: mockReleaseStewardClaim,
    getIntegrationSurfaces: mockGetIntegrationSurfaces,
  })),
}));

const mockPrepareMultiRepoWorkspace = jest.fn();
jest.unstable_mockModule('../../src/workspace-prep.js', () => ({
  normalizeRepositoryUrlForClone: jest.fn((url: string) => url.replace(/\/tree\/.+$/, '')),
  prepareMultiRepoWorkspace: mockPrepareMultiRepoWorkspace,
}));

const mockRunnerExecute = jest.fn<(opts: Record<string, unknown>) => Promise<{ exitCode: number }>>();
jest.unstable_mockModule('../../src/runners/index.js', () => ({
  createAgentRunner: jest.fn(() => ({
    provider: 'codex',
    execute: mockRunnerExecute,
  })),
}));

jest.unstable_mockModule('../../src/workflows/execution-policy.js', () => ({
  resolveExecutionMode: jest.fn(() => 'safe'),
  assertRunnerCapabilities: jest.fn(),
}));

jest.unstable_mockModule('../../src/langfuse-session.js', () => ({
  initializeStewardSession: jest.fn(() => undefined),
}));

const mockCaptureEvent = jest.fn();
const mockShutdownPostHog = jest.fn<() => Promise<void>>();
jest.unstable_mockModule('../../src/posthog-client.js', () => ({
  captureEvent: mockCaptureEvent,
  shutdownPostHog: mockShutdownPostHog,
}));

const { runStewardStep } = await import('../../src/workflows/steward-step.js');

describe('runStewardStep integration prompt context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AXIOM_TOKEN = 'axiom-token';

    mockLoadCredentials.mockResolvedValue({
      clerkToken: 'test-token',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
    });
    mockIsExpired.mockReturnValue(false);
    mockIsTokenExpired.mockReturnValue(false);
    mockReleaseStewardClaim.mockResolvedValue(undefined);
    mockRunnerExecute.mockResolvedValue({ exitCode: 0 });
    mockShutdownPostHog.mockResolvedValue(undefined);

    (mockPrepareMultiRepoWorkspace as any).mockResolvedValue({
      rootPath: '/tmp/cg-workspace-test',
      repos: [
        {
          name: 'actions',
          path: '/tmp/cg-workspace-test/actions',
          url: 'https://github.com/contextgraph/actions',
          branch: 'steward/test-branch',
          startingCommit: 'abc123',
        },
      ],
      cleanup: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });

    (mockClaimNextSteward as any).mockResolvedValue({
      steward: {
        id: 'steward-1',
        name: 'Axiom Logging',
        organization_id: 'org-1',
      },
      claim_id: 'claim-1',
      prompt: 'Investigate whether production logs include queryable correlation IDs.',
      prompt_version: 'steward-loop/v2',
      backlog_candidates: [
        {
          repositoryUrl: 'https://github.com/contextgraph/actions',
          proposedBranch: 'steward/test-branch',
          authenticatedCloneUrl: null,
        },
      ],
    });
  });

  it('injects available integrations into the execution prompt when matching env vars exist', async () => {
    (mockGetIntegrationSurfaces as any).mockResolvedValue([
      {
        key: 'axiom',
        name: 'Axiom',
        defaultEndpoint: 'https://api.axiom.co',
        envVars: ['AXIOM_TOKEN'],
        description: 'Production logs and observability evidence.',
        usageReference: 'Use Axiom to inspect logs and traces.',
      },
    ]);

    await runStewardStep({ workerId: 'worker-1' });

    const firstCall = mockRunnerExecute.mock.calls[0]?.[0] as { prompt?: string } | undefined;
    expect(firstCall?.prompt).toContain('## Available Integrations');
    expect(firstCall?.prompt).toContain('Axiom (axiom)');
    expect(firstCall?.prompt).toContain('Available env vars: AXIOM_TOKEN');
    expect(firstCall?.prompt).toContain('Use Axiom to inspect logs and traces.');
  });

  it('continues execution when integration discovery fails', async () => {
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (mockGetIntegrationSurfaces as any).mockRejectedValue(new Error('surface lookup failed'));

    await runStewardStep({ workerId: 'worker-1' });

    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('failed to load integration surfaces'));
    expect(mockRunnerExecute).toHaveBeenCalled();
  });
});
