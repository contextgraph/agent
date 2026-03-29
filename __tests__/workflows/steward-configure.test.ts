import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const originalStewardHome = process.env.STEWARD_HOME;
let tempDir: string;

const { runStewardConfigure } = await import('../../src/workflows/steward-configure.js');
const { getStewardConfigPath } = await import('../../src/steward-config.js');

describe('runStewardConfigure', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'steward-config-'));
    process.env.STEWARD_HOME = tempDir;
  });

  afterEach(async () => {
    if (originalStewardHome === undefined) {
      delete process.env.STEWARD_HOME;
    } else {
      process.env.STEWARD_HOME = originalStewardHome;
    }

    await fs.rm(tempDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('creates a new config scaffold and prints the path', async () => {
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runStewardConfigure();

    const configPath = getStewardConfigPath();
    const saved = JSON.parse(await fs.readFile(configPath, 'utf8')) as {
      version: number;
      integrations: Array<{ name: string; env: string[] }>;
    };

    expect(saved.version).toBe(1);
    expect(saved.integrations[0]?.name).toBe('axiom');
    expect(saved.integrations[0]?.env).toEqual(['AXIOM_API_TOKEN']);
    expect(saved.integrations[1]?.name).toBe('github');
    expect(consoleLog).toHaveBeenCalledWith('# Steward Config');
    expect(consoleLog).toHaveBeenCalledWith(`- Path: ${configPath}`);
    expect(consoleLog).toHaveBeenCalledWith('- Status: Created new config scaffold');
  });

  it('does not overwrite an existing config file', async () => {
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

    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runStewardConfigure();

    const saved = JSON.parse(await fs.readFile(configPath, 'utf8')) as {
      integrations: Array<{ name: string; env: string[] }>;
    };

    expect(saved.integrations).toHaveLength(1);
    expect(saved.integrations[0]?.name).toBe('axiom');
    expect(consoleLog).toHaveBeenCalledWith('- Status: Loaded existing config');
  });
});
