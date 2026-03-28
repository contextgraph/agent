import chalk from 'chalk';
import { ApiClient } from '../api-client.js';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { PRIMARY_WEB_BASE_URL } from '../platform-urls.js';

const DEFAULT_BASE_URL = PRIMARY_WEB_BASE_URL;

export interface StewardNoteCreateOptions {
  steward: string;
  note: string;
  backlogItem?: string;
  baseUrl?: string;
}

export async function runStewardNoteCreate(options: StewardNoteCreateOptions): Promise<void> {
  if (!options.steward.trim()) throw new Error('steward is required');
  if (!options.note.trim()) throw new Error('note is required');

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
  const created = await apiClient.createStewardNote({
    steward: options.steward.trim(),
    note: options.note.trim(),
    backlog_item: options.backlogItem?.trim() || undefined,
  });

  console.log(chalk.bold('# Steward Note'));
  console.log(`- ${chalk.bold('Steward:')} ${chalk.cyan(`${created.steward.name} (${created.steward.slug})`)}`);
  console.log(`- ${chalk.bold('Note ID:')} ${created.note.id}`);
  console.log(`- ${chalk.bold('Created At:')} ${created.note.createdAt}`);
  if (created.note.metadata && 'backlogReference' in created.note.metadata) {
    console.log(`- ${chalk.bold('Backlog Ref:')} ${String(created.note.metadata.backlogReference)}`);
  }
}
