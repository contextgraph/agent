import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const originalAxiomToken = process.env.AXIOM_TOKEN;
const originalFetch = global.fetch;
const originalStewardApiToken = process.env.STEWARD_API_TOKEN;
const originalContextgraphApiToken = process.env.CONTEXTGRAPH_API_TOKEN;

const { runStewardHeartbeat } = await import('../../src/workflows/steward-heartbeat.js');

describe('runStewardHeartbeat', () => {
  beforeEach(async () => {
    process.env.AXIOM_TOKEN = 'axiom-token';
    process.env.STEWARD_API_TOKEN = 'steward-api-token';
  });

  afterEach(async () => {
    if (originalAxiomToken === undefined) {
      delete process.env.AXIOM_TOKEN;
    } else {
      process.env.AXIOM_TOKEN = originalAxiomToken;
    }

    if (originalStewardApiToken === undefined) {
      delete process.env.STEWARD_API_TOKEN;
    } else {
      process.env.STEWARD_API_TOKEN = originalStewardApiToken;
    }

    if (originalContextgraphApiToken === undefined) {
      delete process.env.CONTEXTGRAPH_API_TOKEN;
    } else {
      process.env.CONTEXTGRAPH_API_TOKEN = originalContextgraphApiToken;
    }

    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('loads the Axiom token from cloud integration surfaces and prints a heartbeat summary', async () => {
    global.fetch = jest.fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          success: true,
          data: {
            integrations: [
              {
                key: 'axiom',
                name: 'Axiom',
                defaultEndpoint: 'https://api.axiom.co',
                envVars: ['AXIOM_TOKEN'],
                description: 'Production logs',
              },
            ],
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          datasets: [
            { name: 'prod-errors' },
            { name: 'checkout-events' },
          ],
        }),
      } as Response);

    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runStewardHeartbeat({ steward: 'error-monitoring' });

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('https://www.steward.foo/api/integrations/surfaces?token='),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-authorization': expect.stringMatching(/^Bearer /),
        }),
      })
    );
    expect(global.fetch).toHaveBeenCalledWith(
      new URL('https://api.axiom.co/v2/datasets'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer axiom-token',
        }),
      })
    );
    expect(consoleLog).toHaveBeenCalledWith('# Steward Heartbeat');
    expect(consoleLog).toHaveBeenCalledWith('- Steward: error-monitoring');
    expect(consoleLog).toHaveBeenCalledWith('- Integration: Axiom (axiom)');
    expect(consoleLog).toHaveBeenCalledWith('- Endpoint: https://api.axiom.co');
    expect(consoleLog).toHaveBeenCalledWith('- Dataset Count: 2');
  });

  it('fails when no local env var matches the cloud-defined Axiom surface', async () => {
    delete process.env.AXIOM_TOKEN;

    global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        success: true,
        data: {
          integrations: [
            {
              key: 'axiom',
              name: 'Axiom',
              defaultEndpoint: 'https://api.axiom.co',
              envVars: ['AXIOM_TOKEN'],
              description: 'Production logs',
            },
          ],
        },
      }),
    } as Response);

    await expect(runStewardHeartbeat({ steward: 'error-monitoring' })).rejects.toThrow(
      'Axiom integration is available in steward.foo, but none of its env vars are available locally: AXIOM_TOKEN'
    );
  });
});
