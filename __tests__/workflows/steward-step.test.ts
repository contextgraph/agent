import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('chalk', () => ({
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
jest.mock('../../src/credentials.js', () => ({
  loadCredentials: mockLoadCredentials,
  isExpired: mockIsExpired,
  isTokenExpired: mockIsTokenExpired,
}));

const mockClaimNextSteward = jest.fn() as jest.Mock;
const mockReleaseStewardClaim = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
jest.mock('../../src/api-client.js', () => ({
  ApiClient: jest.fn(() => ({
    claimNextSteward: mockClaimNextSteward,
    releaseStewardClaim: mockReleaseStewardClaim,
  })),
}));

const mockPrepareMultiRepoWorkspace = jest.fn() as jest.Mock;
jest.mock('../../src/workspace-prep.js', () => ({
  normalizeRepositoryUrlForClone: jest.fn((url: string) => url.replace(/\/tree\/.+$/, '')),
  prepareMultiRepoWorkspace: mockPrepareMultiRepoWorkspace,
}));

const mockRunnerExecute = jest.fn<() => Promise<{ exitCode: number }>>().mockResolvedValue({ exitCode: 0 });
jest.mock('../../src/runners/index.js', () => ({
  createAgentRunner: jest.fn(() => ({
    provider: 'codex',
    execute: mockRunnerExecute,
  })),
}));

jest.mock('../../src/workflows/execution-policy.js', () => ({
  resolveExecutionMode: jest.fn(() => 'safe'),
  assertRunnerCapabilities: jest.fn(),
}));

jest.mock('../../src/langfuse-session.js', () => ({
  initializeStewardSession: jest.fn(() => undefined),
}));

jest.mock('../../src/posthog-client.js', () => ({
  captureEvent: jest.fn(),
  shutdownPostHog: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

import { runStewardStep } from '../../src/workflows/steward-step.js';

describe('runStewardStep repository reduction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockPrepareMultiRepoWorkspace as any).mockResolvedValue({
      rootPath: '/tmp/cg-workspace-test',
      repos: [
        {
          name: 'mise',
          path: '/tmp/cg-workspace-test/mise',
          url: 'https://github.com/jettyio/mise',
          branch: 'feature/add-pr-comment-webhook',
          startingCommit: 'abc123',
        },
      ],
      cleanup: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });
    (mockClaimNextSteward as any).mockResolvedValue({
      steward: {
        id: 'a18b1ae8-4f4f-4a14-8e45-a4a3d0347cd4',
        name: 'Github App Integration',
        organization_id: 'org-1',
      },
      claim_id: 'claim-1',
      prompt: 'test prompt',
      prompt_version: 'steward-loop/v2',
      backlog_candidates: [
        {
          repositoryUrl: 'https://github.com/jettyio/mise',
          proposedBranch: 'feature/add-pr-comment-webhook',
          authenticatedCloneUrl: null,
        },
        {
          repositoryUrl: 'https://github.com/jettyio/mise',
          proposedBranch: 'feature/add-pr-comment-webhook',
          authenticatedCloneUrl: 'https://x-access-token:abc@github.com/jettyio/mise.git',
        },
      ],
    });
  });

  it('preserves authenticatedCloneUrl even when branch is already set on existing repo entry', async () => {
    await runStewardStep({ workerId: 'worker-1' });

    expect(mockPrepareMultiRepoWorkspace).toHaveBeenCalledWith(
      [
        {
          url: 'https://github.com/jettyio/mise',
          branch: 'feature/add-pr-comment-webhook',
          authenticatedCloneUrl: 'https://x-access-token:abc@github.com/jettyio/mise.git',
        },
      ],
      expect.objectContaining({ authToken: 'test-token' })
    );
  });
});
