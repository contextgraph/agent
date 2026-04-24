import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockFetchResponse = {
  ok: true,
  status: 200,
  statusText: 'OK',
  json: jest.fn<() => Promise<unknown>>(),
  text: jest.fn<() => Promise<string>>().mockResolvedValue(''),
};
const mockFetch = jest.fn<(url: string, init?: Record<string, unknown>) => Promise<typeof mockFetchResponse>>()
  .mockResolvedValue(mockFetchResponse);

jest.unstable_mockModule('../src/fetch-with-retry.js', () => ({
  fetchWithRetry: mockFetch,
}));

jest.unstable_mockModule('../src/credentials.js', () => ({
  loadCredentials: jest.fn<() => Promise<unknown>>().mockResolvedValue({
    clerkToken: 'test-token',
    userId: 'user-1',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: new Date().toISOString(),
  }),
  isExpired: jest.fn<() => boolean>().mockReturnValue(false),
  isTokenExpired: jest.fn<() => boolean>().mockReturnValue(false),
}));

const { ApiClient } = await import('../src/api-client.js');

describe('ApiClient.claimStewardBacklog request contract', () => {
  beforeEach(() => {
    mockFetch.mockReset().mockResolvedValue(mockFetchResponse);
    mockFetchResponse.json.mockReset().mockResolvedValue({
      success: true,
      data: {
        steward: { name: 'Test', slug: 'test' },
        backlog_item: {
          id: 'backlog-1',
          title: 'Test item',
          objective: 'Obj',
          rationale: 'Rat',
          proposed_branch: 'feature/my-branch',
          repository_url: 'https://github.com/contextgraph/agent',
        },
      },
    });
    mockFetchResponse.ok = true;
    mockFetchResponse.status = 200;
  });

  it('POSTs both identifier and branch to /api/steward/backlog/claim', async () => {
    const client = new ApiClient('https://contextgraph.dev');

    await client.claimStewardBacklog('agent-platform/wire-cli-command', 'feature/my-branch');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0];
    expect(init?.method).toBe('POST');

    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.['Content-Type']).toBe('application/json');
    expect(headers?.['x-authorization']).toMatch(/^Bearer /);

    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({
      identifier: 'agent-platform/wire-cli-command',
      branch: 'feature/my-branch',
    });
  });

  it('surfaces server validation errors verbatim (400 branch_required)', async () => {
    mockFetchResponse.ok = false;
    mockFetchResponse.status = 400;
    mockFetchResponse.statusText = 'Bad Request';
    mockFetchResponse.text.mockResolvedValueOnce(
      JSON.stringify({ success: false, error: 'branch_required', message: 'branch is required' }),
    );

    const client = new ApiClient('https://contextgraph.dev');
    await expect(
      client.claimStewardBacklog('agent-platform/wire-cli-command', 'feature/my-branch'),
    ).rejects.toThrow(/API error 400: .*branch_required/);
  });

  it('surfaces branch_already_claimed conflicts from the server (409)', async () => {
    mockFetchResponse.ok = false;
    mockFetchResponse.status = 409;
    mockFetchResponse.statusText = 'Conflict';
    mockFetchResponse.text.mockResolvedValueOnce(
      JSON.stringify({ success: false, error: 'branch_already_claimed' }),
    );

    const client = new ApiClient('https://contextgraph.dev');
    await expect(
      client.claimStewardBacklog('agent-platform/wire-cli-command', 'feature/my-branch'),
    ).rejects.toThrow(/API error 409: .*branch_already_claimed/);
  });
});
