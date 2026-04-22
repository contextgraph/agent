import chalk from 'chalk';
import { ApiClient } from '../api-client.js';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { PRIMARY_WEB_BASE_URL } from '../platform-urls.js';

const DEFAULT_BASE_URL = PRIMARY_WEB_BASE_URL;

const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

export interface StewardReviewOptions {
  repository: string;
  sha: string;
  baseUrl?: string;
}

export async function runStewardReview(options: StewardReviewOptions): Promise<void> {
  const repository = options.repository.trim();
  const sha = options.sha.trim();

  if (!repository) {
    throw new Error('repository is required');
  }
  if (!sha) {
    throw new Error('sha is required');
  }
  if (!SHA_PATTERN.test(sha)) {
    throw new Error(`'${sha}' does not look like a commit SHA. Provide a hexadecimal SHA (7–40 chars).`);
  }

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
  const review = await apiClient.stewardReview({ repository, sha });

  console.log(review.markdown);
}
