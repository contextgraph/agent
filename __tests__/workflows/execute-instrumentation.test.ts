import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('chalk', () => ({
  default: {
    cyan: (s: string) => s,
    dim: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    bold: (s: string) => s,
  },
  __esModule: true,
}));

const mockLoadCredentials = jest.fn<() => Promise<unknown>>().mockResolvedValue({
  clerkToken: 'test-token',
  userId: 'test-user-id',
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  createdAt: new Date().toISOString(),
});
const mockIsExpired = jest.fn<() => boolean>().mockReturnValue(false);
const mockIsTokenExpired = jest.fn<() => boolean>().mockReturnValue(false);

jest.mock('../../src/credentials.js', () => ({
  loadCredentials: mockLoadCredentials,
  isExpired: mockIsExpired,
  isTokenExpired: mockIsTokenExpired,
}));

const mockRunnerExecute = jest.fn<(opts: Record<string, unknown>) => Promise<{ exitCode: number; cost?: number; usage?: unknown }>>()
  .mockResolvedValue({ exitCode: 0, cost: 0.05, usage: { input: 100, output: 50 } });
const mockCreateAgentRunner = jest.fn((_provider?: string) => ({
  provider: 'claude',
  capabilities: { fullAccessExecution: true },
  execute: mockRunnerExecute,
}));
jest.mock('../../src/runners/index.js', () => ({
  createAgentRunner: mockCreateAgentRunner,
}));

const mockSetupResult = {
  workspacePath: '/tmp/workspace',
  cleanup: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  startingCommit: 'abc123',
  runId: 'run-123',
  logTransport: {
    updateRunState: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    finishRun: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  },
};
jest.mock('../../src/workspace-setup.js', () => ({
  setupWorkspaceForAction: jest.fn(() => Promise.resolve(mockSetupResult)),
}));

jest.mock('../../src/log-transport.js', () => ({
  LogTransportService: jest.fn(() => ({
    createRun: jest.fn<() => Promise<string>>().mockResolvedValue('run-123'),
    updateRunState: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    finishRun: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  })),
}));
jest.mock('../../src/log-buffer.js', () => ({
  LogBuffer: jest.fn(() => ({
    start: jest.fn(),
    stop: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    push: jest.fn(),
  })),
}));
jest.mock('../../src/heartbeat-manager.js', () => ({
  HeartbeatManager: jest.fn(() => ({
    start: jest.fn(),
    stop: jest.fn(),
  })),
}));

const mockFetchResponse = {
  ok: true,
  json: jest.fn<() => Promise<{ success: boolean; data: { prompt: string; claim_id: string; id: string } }>>()
    .mockResolvedValue({
      success: true,
      data: {
        prompt: 'Test execution prompt',
        claim_id: 'claim-123',
        id: 'action-1',
      },
    }),
  text: jest.fn<() => Promise<string>>().mockResolvedValue(''),
};
const mockFetch = jest.fn<() => Promise<typeof mockFetchResponse>>().mockResolvedValue(mockFetchResponse);
jest.mock('../../src/fetch-with-retry.js', () => ({
  fetchWithRetry: mockFetch,
}));

jest.mock('../../src/workflows/execution-policy.js', () => ({
  assertRunnerCapabilities: jest.fn(),
  resolveExecutionMode: jest.fn(() => 'full-access'),
}));

const mockCaptureEvent = jest.fn();
const mockShutdownPostHog = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
jest.mock('../../src/posthog-client.js', () => ({
  captureEvent: mockCaptureEvent,
  shutdownPostHog: mockShutdownPostHog,
}));

import { runExecute } from '../../src/workflows/execute.js';

describe('Execute workflow PostHog instrumentation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunnerExecute.mockReset().mockResolvedValue({ exitCode: 0, cost: 0.05, usage: { input: 100, output: 50 } });
    mockFetchResponse.json.mockReset().mockResolvedValue({
      success: true,
      data: {
        prompt: 'Test execution prompt',
        claim_id: 'claim-123',
        id: 'action-1',
      },
    });
  });

  it('should capture agent_execution_started event when execution begins', async () => {
    await runExecute('action-1');

    expect(mockCaptureEvent).toHaveBeenCalledWith(
      'test-user-id',
      'agent_execution_started',
      expect.objectContaining({
        action_id: 'action-1',
        run_id: expect.any(String),
        provider: 'claude',
        execution_mode: 'full-access',
      })
    );
  });

  it('should capture agent_execution_completed event on success', async () => {
    await runExecute('action-1');

    expect(mockCaptureEvent).toHaveBeenCalledWith(
      'test-user-id',
      'agent_execution_completed',
      expect.objectContaining({
        action_id: 'action-1',
        run_id: expect.any(String),
        provider: 'claude',
        execution_mode: 'full-access',
        exit_code: 0,
        status: 'success',
        cost_usd: 0.05,
        duration_seconds: expect.any(Number),
      })
    );
  });

  it('should capture agent_execution_completed event with failure status on non-zero exit', async () => {
    mockRunnerExecute.mockResolvedValue({ exitCode: 1, cost: 0.02 });

    await expect(runExecute('action-1')).rejects.toThrow('Claude execution failed with exit code 1');

    expect(mockCaptureEvent).toHaveBeenCalledWith(
      'test-user-id',
      'agent_execution_completed',
      expect.objectContaining({
        action_id: 'action-1',
        exit_code: 1,
        status: 'failed',
        cost_usd: 0.02,
        error_message: 'Claude execution failed with exit code 1',
      })
    );
  });

  it('should capture agent_execution_completed event with error status on exception', async () => {
    mockRunnerExecute.mockRejectedValue(new Error('Network timeout'));

    await expect(runExecute('action-1')).rejects.toThrow('Network timeout');

    expect(mockCaptureEvent).toHaveBeenCalledWith(
      'test-user-id',
      'agent_execution_completed',
      expect.objectContaining({
        action_id: 'action-1',
        status: 'error',
        error_message: 'Network timeout',
        duration_seconds: expect.any(Number),
      })
    );
  });

  it('should shutdown PostHog client in finally block', async () => {
    await runExecute('action-1');

    expect(mockShutdownPostHog).toHaveBeenCalled();
  });

  it('should shutdown PostHog client even on error', async () => {
    mockRunnerExecute.mockRejectedValue(new Error('Test error'));

    await expect(runExecute('action-1')).rejects.toThrow('Test error');

    expect(mockShutdownPostHog).toHaveBeenCalled();
  });

  it('should include duration_seconds in all completion events', async () => {
    await runExecute('action-1');

    const completionCall = mockCaptureEvent.mock.calls.find(
      (call) => call[1] === 'agent_execution_completed'
    );

    expect(completionCall).toBeDefined();
    expect(completionCall![2]).toHaveProperty('duration_seconds');
    expect(typeof completionCall![2].duration_seconds).toBe('number');
    expect(completionCall![2].duration_seconds).toBeGreaterThanOrEqual(0);
  });

  it('should include model in started event when provided', async () => {
    await runExecute('action-1', { model: 'claude-3-5-sonnet-20241022' });

    expect(mockCaptureEvent).toHaveBeenCalledWith(
      'test-user-id',
      'agent_execution_started',
      expect.objectContaining({
        model: 'claude-3-5-sonnet-20241022',
      })
    );
  });

  it('should track has_custom_prompt when prompt option provided', async () => {
    await runExecute('action-1', {
      cwd: '/tmp/test',
      runId: 'run-456',
      prompt: 'Custom user prompt',
    });

    expect(mockCaptureEvent).toHaveBeenCalledWith(
      'test-user-id',
      'agent_execution_started',
      expect.objectContaining({
        has_custom_prompt: true,
      })
    );
  });
});
