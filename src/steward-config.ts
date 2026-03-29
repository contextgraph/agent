import fs from 'fs/promises';
import path from 'path';
import { getStewardHomeDir } from './steward-home.js';

export type StewardIntegrationConfig = {
  name: string;
  endpoint: string;
  env: string[];
  auth_type?: 'bearer' | 'api_key' | 'basic' | 'custom';
  docs?: string;
  notes?: string[];
  validated_at?: string;
};

export type StewardConfigFile = {
  version: 1;
  integrations: StewardIntegrationConfig[];
};

function getBaseConfigDir(): string {
  return getStewardHomeDir();
}

export function getStewardConfigPath(): string {
  return process.env.STEWARD_CONFIG_PATH || path.join(getBaseConfigDir(), 'config.json');
}

export function defaultStewardConfig(): StewardConfigFile {
  return {
    version: 1,
    integrations: [
      {
        name: 'axiom',
        endpoint: 'https://api.axiom.co',
        env: ['AXIOM_API_TOKEN'],
        auth_type: 'bearer',
        docs: 'https://axiom.co/docs/restapi/introduction',
        notes: ['Replace or remove this example entry once your real integration is configured.'],
      },
      {
        name: 'github',
        endpoint: 'https://api.github.com',
        env: ['GITHUB_TOKEN'],
        auth_type: 'bearer',
        docs: 'https://docs.github.com/en/rest',
        notes: ['Use the token already available on this machine for local steward execution.'],
      },
    ],
  };
}

export async function loadStewardConfig(): Promise<StewardConfigFile | null> {
  const filePath = getStewardConfigPath();

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as StewardConfigFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

export async function saveStewardConfig(config: StewardConfigFile): Promise<void> {
  const filePath = getStewardConfigPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}
