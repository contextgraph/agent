import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const originalStewardHome = process.env.STEWARD_HOME;
const originalAxiomToken = process.env.AXIOM_TOKEN;
const originalFetch = global.fetch;

let tempDir: string;

const { runStewardHeartbeat } = await import('../../src/workflows/steward-heartbeat.js');
const { getStewardConfigPath } = await import('../../src/steward-config.js');

describe('runStewardHeartbeat', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'steward-heartbeat-'));
    process.env.STEWARD_HOME = tempDir;
    process.env.AXIOM_TOKEN = 'axiom-token';
  });

  afterEach(async () => {
    if (originalStewardHome === undefined) {
      delete process.env.STEWARD_HOME;
    } else {
      process.env.STEWARD_HOME = originalStewardHome;
    }

    if (originalAxiomToken === undefined) {
      delete process.env.AXIOM_TOKEN;
    } else {
      process.env.AXIOM_TOKEN = originalAxiomToken;
    }

    global.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('loads the Axiom token from local config and prints a heartbeat summary', async () => {
    const configPath = getStewardConfigPath();
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify(
        {
          version: 1,
          integrations: [
            {
              name: 'axiom',
              endpoint: 'https://api.axiom.co',
              env: ['AXIOM_TOKEN'],
              auth_type: 'bearer',
            },
          ],
        },
        null,
        2
      )
    );

    global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
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
    expect(consoleLog).toHaveBeenCalledWith('- Dataset Count: 2');
  });

  it('fails when no configured Axiom token env var is available', async () => {
    delete process.env.AXIOM_TOKEN;

    const configPath = getStewardConfigPath();
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify(
        {
          version: 1,
          integrations: [
            {
              name: 'axiom',
              endpoint: 'https://api.axiom.co',
              env: ['AXIOM_TOKEN'],
              auth_type: 'bearer',
            },
          ],
        },
        null,
        2
      )
    );

    await expect(runStewardHeartbeat({ steward: 'error-monitoring' })).rejects.toThrow(
      'Axiom integration is configured but none of its env vars are available: AXIOM_TOKEN'
    );
  });
});
