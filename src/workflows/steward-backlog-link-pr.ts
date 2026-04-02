import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import chalk from 'chalk';
import { ApiClient } from '../api-client.js';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { PRIMARY_WEB_BASE_URL } from '../platform-urls.js';
import { buildLinkedPrBody, extractLinkedBacklogItemId, normalizeRepositoryUrl, resolveClaimedBacklogItem } from './steward-backlog-utils.js';

const DEFAULT_BASE_URL = PRIMARY_WEB_BASE_URL;

export interface StewardBacklogLinkPrOptions {
  identifier?: string;
  pr: string;
  baseUrl?: string;
}

function runCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(command, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed (exit ${code}): ${stderr || stdout}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn ${command}: ${err.message}`));
    });
  });
}

function parseRepoName(repositoryUrl: string): string {
  const normalized = normalizeRepositoryUrl(repositoryUrl);
  const prefix = 'https://github.com/';
  if (!normalized.startsWith(prefix)) {
    throw new Error(`Unsupported repository URL for PR linking: ${repositoryUrl}`);
  }
  return normalized.slice(prefix.length);
}

export async function runStewardBacklogLinkPr(options: StewardBacklogLinkPrOptions): Promise<void> {
  const credentials = await loadCredentials();

  if (!credentials) {
    console.error(chalk.red('Not authenticated.'), 'Run authentication first.');
    process.exit(1);
  }

  if (isExpired(credentials) || isTokenExpired(credentials.clerkToken)) {
    console.error(chalk.red('Token expired.'), 'Re-authenticate to continue.');
    process.exit(1);
  }

  const identifier = options.identifier?.trim();
  const pr = options.pr.trim();
  if (!pr) {
    throw new Error('pr is required');
  }

  const baseUrl = (options.baseUrl || process.env.CONTEXTGRAPH_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const apiClient = new ApiClient(baseUrl);
  const claimed = await apiClient.listClaimedStewardBacklog();
  const item = resolveClaimedBacklogItem(claimed, identifier);

  if (!item.backlog_item.id) {
    throw new Error('Claimed backlog item does not include an ID.');
  }
  if (!item.backlog_item.repository_url) {
    throw new Error('Claimed backlog item does not include a repository URL.');
  }

  const repo = parseRepoName(item.backlog_item.repository_url);
  const viewResult = await runCommand('gh', ['pr', 'view', pr, '--repo', repo, '--json', 'body,number,url']);
  const prData = JSON.parse(viewResult.stdout) as { body?: string | null; number: number; url: string };
  const existingLinkedId = extractLinkedBacklogItemId(prData.body);
  const targetId = item.backlog_item.id.toLowerCase();

  if (existingLinkedId && existingLinkedId !== targetId) {
    throw new Error(`PR already links a different backlog item (${existingLinkedId}).`);
  }

  if (existingLinkedId === targetId) {
    console.log(chalk.bold('# Steward PR Link'));
    console.log(`- ${chalk.bold('PR:')} ${prData.url}`);
    console.log(`- ${chalk.bold('Backlog Ref:')} ${item.backlog_item.backlog_reference ?? item.backlog_item.id}`);
    console.log(`- ${chalk.bold('Result:')} PR already links this backlog item.`);
    return;
  }

  const updatedBody = buildLinkedPrBody(prData.body, targetId);
  const tmpPath = join(tmpdir(), `steward-pr-body-${item.backlog_item.id}.md`);
  await fs.writeFile(tmpPath, updatedBody, 'utf8');
  try {
    await runCommand('gh', ['pr', 'edit', pr, '--repo', repo, '--body-file', tmpPath]);
  } finally {
    await fs.rm(tmpPath, { force: true });
  }

  console.log(chalk.bold('# Steward PR Link'));
  console.log(`- ${chalk.bold('PR:')} ${prData.url}`);
  console.log(`- ${chalk.bold('Backlog Ref:')} ${item.backlog_item.backlog_reference ?? item.backlog_item.id}`);
  console.log(`- ${chalk.bold('Result:')} Added backlog link marker to the PR body.`);
}

