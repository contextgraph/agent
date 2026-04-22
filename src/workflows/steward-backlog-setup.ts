import { spawn } from 'child_process';
import { mkdirSync } from 'fs';
import { join, resolve } from 'path';
import chalk from 'chalk';
import { ApiClient } from '../api-client.js';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { PRIMARY_WEB_BASE_URL } from '../platform-urls.js';
import { printWrapped } from './render.js';
import { normalizeRepositoryUrl, resolveClaimedBacklogItem, sanitizeBranchForPath } from './steward-backlog-utils.js';

const DEFAULT_BASE_URL = PRIMARY_WEB_BASE_URL;

export interface StewardBacklogSetupOptions {
  identifier?: string;
  baseUrl?: string;
  path?: string;
  inPlace?: boolean;
  baseRef?: string;
}

function runCommand(command: string, args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(command, args, { cwd });
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

async function getGitRoot(): Promise<string> {
  const { stdout } = await runCommand('git', ['rev-parse', '--show-toplevel']);
  return stdout.trim();
}

async function getOriginUrl(cwd: string): Promise<string> {
  const { stdout } = await runCommand('git', ['remote', 'get-url', 'origin'], cwd);
  return stdout.trim();
}

export async function runStewardBacklogSetup(options: StewardBacklogSetupOptions = {}): Promise<void> {
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
  const item = resolveClaimedBacklogItem(claimed, options.identifier);

  if (!item.backlog_item.proposed_branch) {
    throw new Error('Claimed backlog item does not include a proposed branch.');
  }
  if (!item.backlog_item.repository_url) {
    throw new Error('Claimed backlog item does not include a repository URL.');
  }

  const repoRoot = await getGitRoot();
  const originUrl = normalizeRepositoryUrl(await getOriginUrl(repoRoot));
  const expectedUrl = normalizeRepositoryUrl(item.backlog_item.repository_url);

  if (originUrl !== expectedUrl) {
    throw new Error(
      `Current repository does not match the claimed backlog item. Expected ${expectedUrl}, found ${originUrl}.`
    );
  }

  const baseRef = options.baseRef?.trim() || 'origin/main';
  await runCommand('git', ['fetch', 'origin', 'main'], repoRoot);

  console.log(chalk.bold('# Steward Workspace Setup'));
  console.log(`- ${chalk.bold('Backlog Ref:')} ${item.backlog_item.backlog_reference ?? item.backlog_item.id ?? 'unknown'}`);
  console.log(`- ${chalk.bold('Preferred Branch:')} ${item.backlog_item.proposed_branch}`);
  console.log(`- ${chalk.bold('Base Ref:')} ${baseRef}`);

  if (options.inPlace) {
    await runCommand('git', ['checkout', '-b', item.backlog_item.proposed_branch, baseRef], repoRoot);
    console.log(`- ${chalk.bold('Mode:')} in-place branch setup`);
    console.log('');
    console.log(chalk.bold('## Result'));
    printWrapped(`Created and checked out \`${item.backlog_item.proposed_branch}\` in the current repository checkout.`, {
      indent: '  ',
    });
    return;
  }

  const defaultPath = join(repoRoot, '.worktrees', sanitizeBranchForPath(item.backlog_item.proposed_branch));
  const worktreePath = resolve(options.path?.trim() || defaultPath);
  mkdirSync(join(repoRoot, '.worktrees'), { recursive: true });
  await runCommand('git', ['worktree', 'add', worktreePath, '-b', item.backlog_item.proposed_branch, baseRef], repoRoot);

  console.log(`- ${chalk.bold('Mode:')} clean worktree`);
  console.log(`- ${chalk.bold('Worktree:')} ${worktreePath}`);
  console.log('');
  console.log(chalk.bold('## Result'));
  printWrapped(`Created a clean worktree at \`${worktreePath}\` with branch \`${item.backlog_item.proposed_branch}\` from \`${baseRef}\`.`, {
    indent: '  ',
  });
}

