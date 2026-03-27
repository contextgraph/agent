import chalk from 'chalk';
import { ApiClient } from '../api-client.js';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { PRIMARY_WEB_BASE_URL } from '../platform-urls.js';

const DEFAULT_BASE_URL = PRIMARY_WEB_BASE_URL;

export interface StewardMissionOptions {
  steward: string;
  baseUrl?: string;
}

export async function runStewardMission(options: StewardMissionOptions): Promise<void> {
  if (!options.steward.trim()) throw new Error('steward is required');

  const credentials = await loadCredentials();
  if (!credentials) {
    console.error(chalk.red('Not authenticated.'), 'Run authentication first.');
    process.exit(1);
  }
  if (isExpired(credentials) || isTokenExpired(credentials.clerkToken)) {
    console.error(chalk.red('Token expired.'), 'Re-authenticate to continue.');
    process.exit(1);
  }

  const baseUrl = (options.baseUrl || process.env.CONTEXTGRAPH_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const apiClient = new ApiClient(baseUrl);
  const mission = await apiClient.getStewardMission(options.steward.trim());

  console.log(chalk.bold('Steward:'), chalk.cyan(`${mission.steward.name} (${mission.steward.slug})`));
  console.log(chalk.bold('Mission:'), mission.steward.mission);
}
