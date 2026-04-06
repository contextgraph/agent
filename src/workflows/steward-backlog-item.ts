import chalk from 'chalk';
import { ApiClient, type StewardNextResource } from '../api-client.js';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { PRIMARY_WEB_BASE_URL } from '../platform-urls.js';
import { printWrapped } from './render.js';
import { printFileSurfaceConjecture } from './steward-backlog-format.js';

const DEFAULT_BASE_URL = PRIMARY_WEB_BASE_URL;

export interface StewardBacklogItemOptions {
  identifier: string;
  baseUrl?: string;
}

function printBacklogItem(resource: StewardNextResource) {
  console.log(chalk.bold('# Backlog Item'));
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
  if (resource.backlog_item.state) {
    console.log(`- ${chalk.bold('State:')} ${resource.backlog_item.state}`);
  }
  if (resource.backlog_item.proposed_branch) {
    console.log(`- ${chalk.bold('Branch:')} ${resource.backlog_item.proposed_branch}`);
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
  printFileSurfaceConjecture(resource.backlog_item.metadata);

  if (resource.backlog_item.state === 'queued' && resource.workflow?.claim_command) {
    console.log('');
    console.log(chalk.bold('## Next Step'));
    printWrapped('Claim this backlog item before doing any work on it.', { indent: '  ' });
    console.log('');
    console.log(chalk.bold('```bash'));
    console.log(resource.workflow.claim_command);
    console.log(chalk.bold('```'));
  } else if (resource.backlog_item.state === 'in_progress') {
    console.log('');
    console.log(chalk.bold('## Status'));
    printWrapped('This backlog item is already claimed and is useful for context recovery or continuation.', {
      indent: '  ',
    });
  } else if (resource.backlog_item.state === 'done' || resource.backlog_item.state === 'dismissed') {
    console.log('');
    console.log(chalk.bold('## Status'));
    printWrapped(`This backlog item is already ${resource.backlog_item.state}.`, {
      indent: '  ',
    });
  }
}

export async function runStewardBacklogItem(options: StewardBacklogItemOptions): Promise<void> {
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
    throw new Error('Backlog identifier is required.');
  }

  const baseUrl = (options.baseUrl || process.env.CONTEXTGRAPH_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const apiClient = new ApiClient(baseUrl);
  const backlogItem = await apiClient.getStewardBacklogItem(identifier);
  printBacklogItem(backlogItem);
}
