import chalk from 'chalk';
import { ApiClient, type StewardCreateBacklogParams } from '../api-client.js';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { PRIMARY_WEB_BASE_URL } from '../platform-urls.js';

const DEFAULT_BASE_URL = PRIMARY_WEB_BASE_URL;

export interface StewardBacklogCreateOptions extends StewardCreateBacklogParams {
  baseUrl?: string;
}

export async function runStewardBacklogCreate(options: StewardBacklogCreateOptions): Promise<void> {
  if (!options.steward.trim()) throw new Error('steward is required');
  if (!options.title.trim()) throw new Error('title is required');
  if (!options.objective.trim()) throw new Error('objective is required');
  if (!options.rationale.trim()) throw new Error('rationale is required');
  if (!options.repository_url.trim()) throw new Error('repository_url is required');

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
  const created = await apiClient.createStewardBacklog({
    steward: options.steward.trim(),
    title: options.title.trim(),
    objective: options.objective.trim(),
    rationale: options.rationale.trim(),
    repository_url: options.repository_url.trim(),
    proposed_branch: options.proposed_branch?.trim() || undefined,
    priority_score: options.priority_score,
  });

  console.log(chalk.bold('Created:'), created.backlog_item.title);
  console.log(chalk.bold('Steward:'), chalk.cyan(`${created.steward.name} (${created.steward.slug})`));
  console.log(chalk.bold('Backlog ID:'), created.backlog_item.id ?? 'unknown');
  console.log(chalk.bold('Backlog Ref:'), created.backlog_item.backlog_reference ?? 'unknown');
  console.log(chalk.bold('State:'), created.backlog_item.state ?? 'queued');
  console.log(chalk.bold('Branch:'), created.backlog_item.proposed_branch ?? 'unknown');
}
