import chalk from 'chalk';
import { ApiClient } from '../api-client.js';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { PRIMARY_WEB_BASE_URL } from '../platform-urls.js';
import { printWrapped } from './render.js';

const DEFAULT_BASE_URL = PRIMARY_WEB_BASE_URL;

export interface StewardListOptions {
  baseUrl?: string;
}

export async function runStewardList(options: StewardListOptions = {}): Promise<void> {
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
  const stewards = await apiClient.listStewards();

  if (stewards.length === 0) {
    console.log(chalk.yellow('No visible stewards right now.'));
    return;
  }

  console.log(chalk.bold('# Stewards'));
  console.log('- Use an id or slug from this list with `steward mission`, `steward backlog top --steward`, or `steward backlog create --steward`.');
  console.log('');

  for (const steward of stewards) {
    console.log(chalk.bold(`## ${steward.name}`));
    console.log(`- ${chalk.bold('ID:')} ${steward.id}`);
    console.log(`- ${chalk.bold('Slug:')} ${steward.slug}`);
    console.log(`- ${chalk.bold('Status:')} ${steward.status}`);
    if (steward.organizationId) {
      console.log(`- ${chalk.bold('Organization ID:')} ${steward.organizationId}`);
    } else {
      console.log(`- ${chalk.bold('Scope:')} personal`);
    }
    console.log(chalk.bold('Mission:'));
    printWrapped(steward.mission, { indent: '  ' });
    console.log('');
  }
}

