import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const originalStewardHome = process.env.STEWARD_HOME;
const originalAxiomToken = process.env.AXIOM_API_TOKEN;
const originalGithubToken = process.env.GITHUB_TOKEN;
const originalFetch = global.fetch;

let tempDir: string;

const { runStewardConfigureValidate } = await import('../../src/workflows/steward-configure-validate.js');
const { getStewardConfigPath } = await import('../../src/steward-config.js');

describe('runStewardConfigureValidate', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'steward-config-validate-'));
    process.env.STEWARD_HOME = tempDir;
    process.env.AXIOM_API_TOKEN = 'axiom-token';
    process.env.GITHUB_TOKEN = 'github-token';
  });

  afterEach(async () => {
    if (originalStewardHome === undefined) {
      delete process.env.STEWARD_HOME;
    } else {
      process.env.STEWARD_HOME = originalStewardHome;
    }

    if (originalAxiomToken === undefined) {
      delete process.env.AXIOM_API_TOKEN;
    } else {
      process.env.AXIOM_API_TOKEN = originalAxiomToken;
    }

    if (originalGithubToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalGithubToken;
    }

    global.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('validates integrations and persists validated_at on success', async () => {
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
              env: ['AXIOM_API_TOKEN'],
              auth_type: 'bearer',
            },
          ],
        },
        null,
        2
      )
    );

    global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      status: 401,
    } as Response);

    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runStewardConfigureValidate();

    const saved = JSON.parse(await fs.readFile(configPath, 'utf8')) as {
      integrations: Array<{ validated_at?: string }>;
    };

    expect(global.fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      method: 'GET',
      headers: expect.any(Headers),
    }));
    expect(saved.integrations[0]?.validated_at).toBeDefined();
    expect(consoleLog).toHaveBeenCalledWith('# Steward Config Validation');
  });

  it('fails when required env vars are missing', async () => {
    delete process.env.AXIOM_API_TOKEN;

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
              env: ['AXIOM_API_TOKEN'],
            },
          ],
        },
        null,
        2
      )
    );

    global.fetch = jest.fn<typeof fetch>();
    jest.spyOn(console, 'log').mockImplementation(() => {});

    await expect(runStewardConfigureValidate()).rejects.toThrow('One or more integrations failed validation.');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
