import chalk from 'chalk';
import { ApiClient } from '../api-client.js';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { PRIMARY_WEB_BASE_URL } from '../platform-urls.js';

const DEFAULT_BASE_URL = PRIMARY_WEB_BASE_URL;

export interface StewardClaimedOptions {
  baseUrl?: string;
}

function printClaim(resource: Awaited<ReturnType<ApiClient['listClaimedStewardBacklog']>>[number]) {
  console.log(chalk.bold('## Claimed Item'));
  console.log(`- ${chalk.bold('Steward:')} ${chalk.cyan(`${resource.steward.name} (${resource.steward.slug})`)}`);
  console.log(`- ${chalk.bold('Backlog ID:')} ${resource.backlog_item.id ?? 'unknown'}`);
  if (resource.backlog_item.backlog_reference) {
    console.log(`- ${chalk.bold('Backlog Ref:')} ${resource.backlog_item.backlog_reference}`);
  }
  console.log(`- ${chalk.bold('Title:')} ${resource.backlog_item.title}`);
  console.log(`- ${chalk.bold('State:')} ${resource.backlog_item.state ?? 'in_progress'}`);
  if (resource.backlog_item.proposed_branch) {
    console.log(`- ${chalk.bold('Branch:')} ${resource.backlog_item.proposed_branch}`);
  }
  console.log('');
}

export async function runStewardClaimed(options: StewardClaimedOptions = {}): Promise<void> {
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
  const claimed = await apiClient.listClaimedStewardBacklog();

  if (claimed.length === 0) {
    console.log(chalk.yellow('No claimed steward backlog items right now.'));
    return;
  }

  console.log(chalk.bold('# Claimed Steward Backlog'));
  console.log('');
  for (const item of claimed) {
    printClaim(item);
  }
}
