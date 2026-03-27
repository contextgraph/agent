import chalk from 'chalk';
import { ApiClient } from '../api-client.js';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { PRIMARY_WEB_BASE_URL } from '../platform-urls.js';

const DEFAULT_BASE_URL = PRIMARY_WEB_BASE_URL;

export interface StewardUnclaimOptions {
  identifier: string;
  baseUrl?: string;
}

export async function runStewardUnclaim(options: StewardUnclaimOptions): Promise<void> {
  const credentials = await loadCredentials();

  if (!credentials) {
    console.error(chalk.red('Not authenticated.'), 'Run authentication first.');
    process.exit(1);
  }

  if (isExpired(credentials) || isTokenExpired(credentials.clerkToken)) {
    console.error(chalk.red('Token expired.'), 'Re-authenticate to continue.');
    process.exit(1);
  }

  const identifier = options.identifier.trim();
  if (!identifier) {
    throw new Error('identifier is required');
  }

  const baseUrl = (options.baseUrl || process.env.CONTEXTGRAPH_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const apiClient = new ApiClient(baseUrl);
  const result = await apiClient.unclaimStewardBacklog(identifier);

  console.log(chalk.bold('Unclaimed:'), result.backlog_item.title);
  console.log(chalk.bold('Reference:'), result.backlog_item.backlog_reference);
  console.log(chalk.bold('State:'), result.backlog_item.state);
}
