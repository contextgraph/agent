import chalk from 'chalk';
import { ApiClient, type StewardTopResource } from '../api-client.js';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { PRIMARY_WEB_BASE_URL } from '../platform-urls.js';
import { printWrapped } from './render.js';

const DEFAULT_BASE_URL = PRIMARY_WEB_BASE_URL;

export interface StewardTopOptions {
  baseUrl?: string;
}

function printTop(resource: StewardTopResource) {
  console.log(chalk.bold('# Top Backlog Item'));
  console.log(`- ${chalk.bold('Title:')} ${resource.backlog_item.title}`);
  console.log(`- ${chalk.bold('Steward:')} ${chalk.cyan(`${resource.steward.name} (${resource.steward.slug})`)}`);
  if (resource.backlog_item.id) {
    console.log(`- ${chalk.bold('Backlog ID:')} ${resource.backlog_item.id}`);
  }
  if (resource.backlog_item.backlog_reference) {
    console.log(`- ${chalk.bold('Backlog Ref:')} ${resource.backlog_item.backlog_reference}`);
  }
  if (resource.backlog_item.priority_score !== undefined && resource.backlog_item.priority_score !== null) {
    console.log(`- ${chalk.bold('Priority:')} ${resource.backlog_item.priority_score}`);
  }
  if (resource.backlog_item.repository_url) {
    console.log(`- ${chalk.bold('Repository:')} ${resource.backlog_item.repository_url}`);
  }

  console.log('');
  console.log(chalk.bold('## Objective'));
  printWrapped(resource.backlog_item.objective, { indent: '  ' });

  console.log('');
  console.log(chalk.bold('## Rationale'));
  printWrapped(resource.backlog_item.rationale, { indent: '  ' });

  console.log('');
  console.log(chalk.bold('## Next Step'));
  if (resource.workflow?.selection_rule) {
    printWrapped(resource.workflow.selection_rule, { indent: '  ' });
    console.log('');
  }
  if (resource.workflow?.claim_command) {
    console.log(chalk.bold('```bash'));
    console.log(resource.workflow.claim_command);
    console.log(chalk.bold('```'));
  } else {
    printWrapped('Claim this backlog item explicitly before doing any work on it.', { indent: '  ' });
  }

  if (resource.workflow?.session_rule) {
    console.log('');
    console.log(chalk.bold('## Session Rule'));
    printWrapped(resource.workflow.session_rule, { indent: '  ' });
  }
}

export async function runStewardTop(options: StewardTopOptions = {}): Promise<void> {
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
  const top = await apiClient.topStewardBacklog();

  if (!top) {
    console.log(chalk.yellow('No queued steward backlog items right now.'));
    return;
  }

  printTop(top);
}
