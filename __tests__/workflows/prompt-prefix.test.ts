import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('chalk', () => ({
  default: {
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

const mockExecuteClaude = jest.fn<(opts: Record<string, unknown>) => Promise<{ exitCode: number }>>().mockResolvedValue({ exitCode: 0 });
jest.mock('../../src/claude-sdk.js', () => ({
  executeClaude: mockExecuteClaude,
}));

const mockSetupResult = {
  workspacePath: '/tmp/workspace',
  cleanup: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  startingCommit: 'abc123',
  runId: 'run-1',
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
    createRun: jest.fn<() => Promise<string>>().mockResolvedValue('run-1'),
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
  json: jest.fn<() => Promise<{ prompt: string }>>().mockResolvedValue({ prompt: 'Server prompt content' }),
  text: jest.fn<() => Promise<string>>().mockResolvedValue(''),
};
const mockFetch = jest.fn<() => Promise<typeof mockFetchResponse>>().mockResolvedValue(mockFetchResponse);
jest.mock('../../src/fetch-with-retry.js', () => ({
  fetchWithRetry: mockFetch,
}));

import { runPrepare } from '../../src/workflows/prepare.js';
import { runExecute } from '../../src/workflows/execute.js';

describe('promptPrefix in workflows', () => {
  beforeEach(() => {
    mockExecuteClaude.mockReset().mockResolvedValue({ exitCode: 0 });
    mockFetchResponse.json.mockReset().mockResolvedValue({ prompt: 'Server prompt content' });
    mockFetch.mockReset().mockResolvedValue(mockFetchResponse);
    mockSetupResult.logTransport.updateRunState.mockReset().mockResolvedValue(undefined);
    mockSetupResult.logTransport.finishRun.mockReset().mockResolvedValue(undefined);
    mockSetupResult.cleanup.mockReset().mockResolvedValue(undefined);
  });

  it('should prepend promptPrefix to server prompt in prepare workflow', async () => {
    await runPrepare('action-1', {
      cwd: '/tmp/workspace',
      runId: 'run-1',
      promptPrefix: '## Workspace Layout\nMultiple repos here.',
    });

    expect(mockExecuteClaude).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '## Workspace Layout\nMultiple repos here.\n\nServer prompt content',
      })
    );
  });

  it('should prepend promptPrefix to server prompt in execute workflow', async () => {
    await runExecute('action-1', {
      cwd: '/tmp/workspace',
      runId: 'run-1',
      promptPrefix: '## Workspace Layout\nMultiple repos here.',
    });

    expect(mockExecuteClaude).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '## Workspace Layout\nMultiple repos here.\n\nServer prompt content',
      })
    );
  });

  it('should pass prompt unchanged when no promptPrefix', async () => {
    await runPrepare('action-1', {
      cwd: '/tmp/workspace',
      runId: 'run-1',
    });

    expect(mockExecuteClaude).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Server prompt content',
      })
    );
  });
});
