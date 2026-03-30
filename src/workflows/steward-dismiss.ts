import chalk from 'chalk';
import { ApiClient } from '../api-client.js';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { PRIMARY_WEB_BASE_URL } from '../platform-urls.js';
import { printWrapped } from './render.js';

const DEFAULT_BASE_URL = PRIMARY_WEB_BASE_URL;

export interface StewardDismissOptions {
  identifier: string;
  note: string;
  baseUrl?: string;
}

export async function runStewardDismiss(options: StewardDismissOptions): Promise<void> {
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
  const note = options.note.trim();

  if (!identifier) {
    throw new Error('identifier is required');
  }
  if (!note) {
    throw new Error('note is required');
  }

  const baseUrl = (options.baseUrl || process.env.CONTEXTGRAPH_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const apiClient = new ApiClient(baseUrl);
  const result = await apiClient.dismissStewardBacklog(identifier, note);

  console.log(chalk.bold('# Steward Dismissal'));
  console.log(`- ${chalk.bold('Title:')} ${result.backlog_item.title}`);
  console.log(`- ${chalk.bold('Backlog Ref:')} ${result.backlog_item.backlog_reference}`);
  console.log(`- ${chalk.bold('State:')} ${result.backlog_item.state}`);
  console.log(`- ${chalk.bold('Note ID:')} ${result.note.id}`);
  console.log(`- ${chalk.bold('Created At:')} ${result.note.createdAt}`);
  console.log(`- ${chalk.bold('Result:')} This backlog item is closed and will not be worked.`);
  console.log('');
  console.log(chalk.bold('## Note'));
  printWrapped(result.note.content, { indent: '  ' });
}
