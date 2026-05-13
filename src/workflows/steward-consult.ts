import chalk from 'chalk';
import { ApiClient } from '../api-client.js';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { PRIMARY_WEB_BASE_URL } from '../platform-urls.js';

const DEFAULT_BASE_URL = PRIMARY_WEB_BASE_URL;

export interface StewardConsultOptions {
  repository: string;
  message: string;
  context?: string;
  baseUrl?: string;
}

function resolveAndValidateBaseUrl(explicit: string | undefined): string {
  const raw = (explicit || process.env.CONTEXTGRAPH_BASE_URL || DEFAULT_BASE_URL).trim();
  if (!raw) {
    throw new Error('Base URL is empty. Set --base-url or CONTEXTGRAPH_BASE_URL to a valid https:// URL.');
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid base URL '${raw}'. Provide a full http(s):// URL.`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsupported base URL protocol '${parsed.protocol}'. Only http:// and https:// are allowed.`);
  }
  return raw.replace(/\/+$/, '');
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return '';
  }
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', (error) => reject(error));
  });
}

export async function runStewardConsult(options: StewardConsultOptions): Promise<void> {
  const repository = options.repository.trim();
  const message = options.message.trim();
  const context = options.context !== undefined && options.context.trim().length > 0
    ? options.context.trim()
    : undefined;

  if (!repository) {
    throw new Error('repository is required');
  }
  if (!message) {
    throw new Error('message is required');
  }

  const baseUrl = resolveAndValidateBaseUrl(options.baseUrl);

  const credentials = await loadCredentials();
  if (!credentials) {
    console.error(chalk.red('Not authenticated.'), 'Run authentication first.');
    process.exit(1);
  }
  if (isExpired(credentials) || isTokenExpired(credentials.clerkToken)) {
    console.error(chalk.red('Token expired.'), 'Re-authenticate to continue.');
    process.exit(1);
  }

  const apiClient = new ApiClient(baseUrl);
  const consult = await apiClient.stewardConsult({
    repository,
    message,
    ...(context ? { context } : {}),
  });

  console.log(consult.markdown);
}

export async function readContextFromStdinIfAvailable(): Promise<string | undefined> {
  if (process.stdin.isTTY) {
    return undefined;
  }
  const data = await readStdin();
  const trimmed = data.trim();
  return trimmed.length > 0 ? data : undefined;
}
