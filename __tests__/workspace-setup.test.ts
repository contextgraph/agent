import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { ActionDetailResource } from '../src/types/actions.js';

const mockPrepareWorkspace = jest.fn() as any;
const mockPrepareMultiRepo = jest.fn() as any;
const mockMkdtemp = jest.fn() as any;
const mockCreateRun = jest.fn<() => Promise<string>>().mockResolvedValue('run-123');

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

jest.unstable_mockModule('../src/log-transport.js', () => ({
  LogTransportService: jest.fn(() => ({ createRun: mockCreateRun })),
}));

jest.unstable_mockModule('../src/api-client.js', () => ({
  ApiClient: jest.fn().mockImplementation(() => ({
    getActionDetail: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
  })),
}));

jest.unstable_mockModule('fs/promises', () => ({
  mkdtemp: mockMkdtemp,
  rm: jest.fn(),
}));

const { setupWorkspaceForAction } = await import('../src/workspace-setup.js');

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

describe('setupWorkspaceForAction', () => {
  beforeEach(() => {
    mockPrepareWorkspace.mockReset();
    mockPrepareMultiRepo.mockReset();
    mockMkdtemp.mockReset();
    mockCreateRun.mockReset().mockResolvedValue('run-123');
    mockMkdtemp.mockResolvedValue('/tmp/cg-workspace-blank' as any);
  });

  it('should use prepareWorkspace for single repo via resolved_repositories', async () => {
    const actionDetail = makeActionDetail({
      graphId: 'graph-abc',
      resolved_repositories: [{ url: 'https://github.com/org/repo', branch: 'main' }],
      resolved_repository_url: 'https://github.com/org/repo',
      resolved_branch: 'main',
    });

    const mockCleanup = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    mockPrepareWorkspace.mockResolvedValue({
      path: '/tmp/cg-workspace-single',
      startingCommit: 'abc123',
      cleanup: mockCleanup,
    });

    const result = await setupWorkspaceForAction('action-1', {
      authToken: 'token',
      phase: 'execute',
      actionDetail,
    });

    expect(result.workspacePath).toBe('/tmp/cg-workspace-single');
    expect(result.startingCommit).toBe('abc123');
    expect(result.graphId).toBe('graph-abc');
    expect(result.repos).toBeUndefined();
    expect(mockPrepareWorkspace).toHaveBeenCalledWith(
      'https://github.com/org/repo',
      expect.objectContaining({ graphId: 'graph-abc' })
    );
    expect(mockPrepareMultiRepo).not.toHaveBeenCalled();
  });

  it('should use prepareMultiRepoWorkspace for multiple repos', async () => {
    const actionDetail = makeActionDetail({
      graphId: 'graph-xyz',
      resolved_repositories: [
        { url: 'https://github.com/org/actions', branch: 'main' },
        { url: 'https://github.com/org/agent', branch: 'develop' },
      ],
      resolved_repository_url: 'https://github.com/org/actions',
      resolved_branch: 'main',
    });

    const mockCleanup = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    mockPrepareMultiRepo.mockResolvedValue({
      rootPath: '/tmp/cg-workspace-multi',
      repos: [
        { name: 'actions', path: '/tmp/cg-workspace-multi/actions', url: 'https://github.com/org/actions', branch: 'main', startingCommit: 'aaa' },
        { name: 'agent', path: '/tmp/cg-workspace-multi/agent', url: 'https://github.com/org/agent', branch: 'develop', startingCommit: 'bbb' },
      ],
      cleanup: mockCleanup,
    });

    const result = await setupWorkspaceForAction('action-1', {
      authToken: 'token',
      phase: 'execute',
      actionDetail,
    });

    expect(result.workspacePath).toBe('/tmp/cg-workspace-multi');
    expect(result.startingCommit).toBe('aaa');
    expect(result.repos).toHaveLength(2);
    expect(result.repos![0].name).toBe('actions');
    expect(result.repos![0].startingCommit).toBe('aaa');
    expect(result.repos![1].name).toBe('agent');
    expect(result.repos![1].startingCommit).toBe('bbb');
    expect(mockPrepareMultiRepo).toHaveBeenCalledWith(
      actionDetail.resolved_repositories!,
      expect.objectContaining({ authToken: 'token', graphId: 'graph-xyz' })
    );
    expect(mockPrepareWorkspace).not.toHaveBeenCalled();
  });

  it('should fall through to single-repo for legacy actions without resolved_repositories', async () => {
    const actionDetail = makeActionDetail({
      resolved_repository_url: 'https://github.com/org/repo',
      resolved_branch: 'main',
    });

    const mockCleanup = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    mockPrepareWorkspace.mockResolvedValue({
      path: '/tmp/cg-workspace-legacy',
      startingCommit: 'legacy123',
      cleanup: mockCleanup,
    });

    const result = await setupWorkspaceForAction('action-1', {
      authToken: 'token',
      phase: 'prepare',
      actionDetail,
    });

    expect(result.workspacePath).toBe('/tmp/cg-workspace-legacy');
    expect(result.repos).toBeUndefined();
    expect(mockPrepareWorkspace).toHaveBeenCalled();
  });

  it('should create blank workspace when no repos configured', async () => {
    const actionDetail = makeActionDetail();

    const result = await setupWorkspaceForAction('action-1', {
      authToken: 'token',
      phase: 'execute',
      actionDetail,
    });

    expect(result.workspacePath).toBe('/tmp/cg-workspace-blank');
    expect(result.repos).toBeUndefined();
    expect(result.branch).toBeUndefined();
    expect(mockPrepareWorkspace).not.toHaveBeenCalled();
    expect(mockPrepareMultiRepo).not.toHaveBeenCalled();
  });

  it('should return resolved branch for single-repo workspace', async () => {
    const actionDetail = makeActionDetail({
      resolved_repository_url: 'https://github.com/org/repo',
      resolved_branch: 'feature/auth-system',
    });

    mockPrepareWorkspace.mockResolvedValue({
      path: '/tmp/cg-workspace-branch',
      startingCommit: 'def456',
      cleanup: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });

    const result = await setupWorkspaceForAction('action-1', {
      authToken: 'token',
      phase: 'execute',
      actionDetail,
    });

    expect(result.branch).toBe('feature/auth-system');
  });

  it('should fall back to action branch when resolved_branch is not set', async () => {
    const actionDetail = makeActionDetail({
      resolved_repository_url: 'https://github.com/org/repo',
      branch: 'fix/bug-123',
    });

    mockPrepareWorkspace.mockResolvedValue({
      path: '/tmp/cg-workspace-branch',
      startingCommit: 'ghi789',
      cleanup: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });

    const result = await setupWorkspaceForAction('action-1', {
      authToken: 'token',
      phase: 'execute',
      actionDetail,
    });

    expect(result.branch).toBe('fix/bug-123');
  });

  it('should not return branch when no branch is configured', async () => {
    const actionDetail = makeActionDetail({
      resolved_repository_url: 'https://github.com/org/repo',
    });

    mockPrepareWorkspace.mockResolvedValue({
      path: '/tmp/cg-workspace-no-branch',
      startingCommit: 'jkl012',
      cleanup: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });

    const result = await setupWorkspaceForAction('action-1', {
      authToken: 'token',
      phase: 'execute',
      actionDetail,
    });

    expect(result.branch).toBeUndefined();
  });
});
