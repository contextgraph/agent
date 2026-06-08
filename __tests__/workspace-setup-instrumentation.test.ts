import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { prepareWorkspace, prepareMultiRepoWorkspace } from '../src/workspace-prep.js';
import type { mkdtemp } from 'fs/promises';

// Mock dependencies
const mockPrepareWorkspace = jest.fn() as jest.MockedFunction<typeof prepareWorkspace>;
const mockPrepareMultiRepo = jest.fn() as jest.MockedFunction<typeof prepareMultiRepoWorkspace>;
jest.unstable_mockModule('../src/workspace-prep.js', () => ({
  prepareWorkspace: mockPrepareWorkspace,
  prepareMultiRepoWorkspace: mockPrepareMultiRepo,
}));

jest.unstable_mockModule('chalk', () => ({
  default: {
    cyan: (s: string) => s,
    dim: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
  },
  __esModule: true,
}));

const mockCreateRun = jest.fn<() => Promise<string>>().mockResolvedValue('run-123');
jest.unstable_mockModule('../src/log-transport.js', () => ({
  LogTransportService: jest.fn(() => ({ createRun: mockCreateRun })),
}));

jest.unstable_mockModule('../src/api-client.js', () => ({
  ApiClient: jest.fn().mockImplementation(() => ({
    getActionDetail: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
  })),
}));

const mockMkdtemp = jest.fn() as jest.MockedFunction<typeof mkdtemp>;
jest.unstable_mockModule('fs/promises', () => ({
  mkdtemp: mockMkdtemp,
  rm: jest.fn(),
}));

const mockCaptureEvent = jest.fn();
jest.unstable_mockModule('../src/posthog-client.js', () => ({
  captureEvent: mockCaptureEvent,
}));

const mockLoadCredentials = jest.fn<() => Promise<any>>();
jest.unstable_mockModule('../src/credentials.js', () => ({
  loadCredentials: mockLoadCredentials,
}));

const { setupWorkspaceForAction } = await import('../src/workspace-setup.js');
import type { ActionDetailResource } from '../src/types/actions.js';

function makeActionDetail(overrides: Partial<ActionDetailResource> = {}): ActionDetailResource {
  return {
    id: 'action-1',
    title: 'Test Action',
    done: false,
    version: 1,
    created_at: '2025-01-01',
    updated_at: '2025-01-01',
    parent_chain: [],
    children: [],
    dependencies: [],
    dependents: [],
    siblings: [],
    relationship_flags: {},
    dependency_completion_context: [],
    ...overrides,
  };
}

describe('workspace setup instrumentation', () => {
  beforeEach(() => {
    mockPrepareWorkspace.mockReset();
    mockPrepareMultiRepo.mockReset();
    mockMkdtemp.mockReset();
    mockCreateRun.mockReset().mockResolvedValue('run-123');
    mockCaptureEvent.mockReset();
    mockLoadCredentials.mockReset();
    mockMkdtemp.mockResolvedValue('/tmp/cg-workspace-blank' as any);
  });

  it('should capture workspace_initialized event for single-repo workspace', async () => {
    const actionDetail = makeActionDetail({
      graphId: 'graph-abc',
      resolved_repository_url: 'https://github.com/org/repo',
      resolved_branch: 'main',
    });

    mockLoadCredentials.mockResolvedValue({
      userId: 'user-123',
      clerkToken: 'token',
    });

    const mockCleanup = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    mockPrepareWorkspace.mockResolvedValue({
      path: '/tmp/cg-workspace-single',
      startingCommit: 'abc123',
      cleanup: mockCleanup,
    });

    await setupWorkspaceForAction('action-1', {
      authToken: 'token',
      phase: 'execute',
      actionDetail,
    });

    expect(mockCaptureEvent).toHaveBeenCalledWith(
      'user-123',
      'workspace_initialized',
      expect.objectContaining({
        action_id: 'action-1',
        run_id: 'run-123',
        phase: 'execute',
        workspace_type: 'single_repo',
        graph_id: 'graph-abc',
        repository_url: 'https://github.com/org/repo',
        branch: 'main',
        has_starting_commit: true,
      })
    );
  });

  it('should capture workspace_initialized event for multi-repo workspace', async () => {
    const actionDetail = makeActionDetail({
      graphId: 'graph-xyz',
      resolved_repositories: [
        { url: 'https://github.com/org/actions', branch: 'main' },
        { url: 'https://github.com/org/agent', branch: 'develop' },
      ],
    });

    mockLoadCredentials.mockResolvedValue({
      userId: 'user-456',
      clerkToken: 'token',
    });

    const mockCleanup = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    mockPrepareMultiRepo.mockResolvedValue({
      rootPath: '/tmp/cg-workspace-multi',
      repos: [
        { name: 'actions', path: '/tmp/multi/actions', url: 'https://github.com/org/actions', branch: 'main', startingCommit: 'aaa' },
        { name: 'agent', path: '/tmp/multi/agent', url: 'https://github.com/org/agent', branch: 'develop', startingCommit: 'bbb' },
      ],
      cleanup: mockCleanup,
    });

    await setupWorkspaceForAction('action-1', {
      authToken: 'token',
      phase: 'prepare',
      actionDetail,
    });

    expect(mockCaptureEvent).toHaveBeenCalledWith(
      'user-456',
      'workspace_initialized',
      expect.objectContaining({
        action_id: 'action-1',
        run_id: 'run-123',
        phase: 'prepare',
        workspace_type: 'multi_repo',
        graph_id: 'graph-xyz',
        repos_count: 2,
        has_starting_commit: true,
      })
    );
  });

  it('should capture workspace_initialized event for blank workspace', async () => {
    const actionDetail = makeActionDetail();

    mockLoadCredentials.mockResolvedValue({
      userId: 'user-789',
      clerkToken: 'token',
    });

    await setupWorkspaceForAction('action-1', {
      authToken: 'token',
      phase: 'execute',
      actionDetail,
    });

    expect(mockCaptureEvent).toHaveBeenCalledWith(
      'user-789',
      'workspace_initialized',
      expect.objectContaining({
        action_id: 'action-1',
        run_id: 'run-123',
        phase: 'execute',
        workspace_type: 'blank',
      })
    );
  });

  it('should include has_starting_commit even with empty string commit', async () => {
    const actionDetail = makeActionDetail({
      resolved_repository_url: 'https://github.com/org/repo',
    });

    mockLoadCredentials.mockResolvedValue({
      userId: 'user-123',
      clerkToken: 'token',
    });

    const mockCleanup = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    mockPrepareWorkspace.mockResolvedValue({
      path: '/tmp/cg-workspace-single',
      startingCommit: '',
      cleanup: mockCleanup,
    });

    await setupWorkspaceForAction('action-1', {
      authToken: 'token',
      phase: 'execute',
      actionDetail,
    });

    const captureCall = mockCaptureEvent.mock.calls[0];
    // Empty string is falsy, so has_starting_commit should not be included
    expect(captureCall[2]).not.toHaveProperty('has_starting_commit');
  });

  it('should gracefully skip event capture when credentials are unavailable', async () => {
    const actionDetail = makeActionDetail({
      resolved_repository_url: 'https://github.com/org/repo',
    });

    mockLoadCredentials.mockResolvedValue(null);

    const mockCleanup = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    mockPrepareWorkspace.mockResolvedValue({
      path: '/tmp/cg-workspace-single',
      startingCommit: 'abc123',
      cleanup: mockCleanup,
    });

    await setupWorkspaceForAction('action-1', {
      authToken: 'token',
      phase: 'execute',
      actionDetail,
    });

    expect(mockCaptureEvent).not.toHaveBeenCalled();
  });

  it('should not include repository_url or branch for non-single-repo workspaces', async () => {
    const actionDetail = makeActionDetail({
      graphId: 'graph-xyz',
      resolved_repositories: [
        { url: 'https://github.com/org/actions', branch: 'main' },
        { url: 'https://github.com/org/agent', branch: 'develop' },
      ],
    });

    mockLoadCredentials.mockResolvedValue({
      userId: 'user-456',
      clerkToken: 'token',
    });

    const mockCleanup = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    mockPrepareMultiRepo.mockResolvedValue({
      rootPath: '/tmp/cg-workspace-multi',
      repos: [
        { name: 'actions', path: '/tmp/multi/actions', url: 'https://github.com/org/actions', branch: 'main', startingCommit: 'aaa' },
        { name: 'agent', path: '/tmp/multi/agent', url: 'https://github.com/org/agent', branch: 'develop', startingCommit: 'bbb' },
      ],
      cleanup: mockCleanup,
    });

    await setupWorkspaceForAction('action-1', {
      authToken: 'token',
      phase: 'prepare',
      actionDetail,
    });

    const captureCall = mockCaptureEvent.mock.calls[0];
    expect(captureCall[2]).not.toHaveProperty('repository_url');
    expect(captureCall[2]).not.toHaveProperty('branch');
  });
});
