import { spawn } from 'child_process';
import { mkdtemp, rm, appendFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { fetchWithRetry } from './fetch-with-retry.js';
import type { GitHubCredentials } from './types/actions.js';
import { injectSkills } from './skill-injection.js';
import { fetchSkillsLibrary } from './skills-library-fetch.js';
import chalk from 'chalk';

const API_BASE_URL = 'https://www.contextgraph.dev';

export interface WorkspaceResult {
  path: string;
  startingCommit: string;
  cleanup: () => Promise<void>;
}

export interface PrepareWorkspaceOptions {
  branch?: string;
  authToken: string;
  runId?: string; // Optional runId to record which skills were loaded
  skipSkills?: boolean; // Skip skill injection (for testing)
}

async function fetchGitHubCredentials(authToken: string): Promise<GitHubCredentials> {
  const response = await fetchWithRetry(`${API_BASE_URL}/api/cli/credentials`, {
    headers: {
      'x-authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (response.status === 401) {
    throw new Error('Authentication failed. Please re-authenticate.');
  }

  if (response.status === 404) {
    throw new Error(
      'GitHub not connected. Please connect your GitHub account at https://contextgraph.dev/settings.'
    );
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch GitHub credentials: ${response.statusText}\n${errorText}`);
  }

  return response.json() as Promise<GitHubCredentials>;
}

function runGitCommand(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd });
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
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`git ${args[0]} failed (exit ${code}): ${stderr || stdout}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn git: ${err.message}`));
    });
  });
}

function buildAuthenticatedUrl(repoUrl: string, token: string, username?: string): string {
  // Build auth string: if username provided, use username:token format (required for GitHub App tokens)
  // Otherwise, use just token (for backward compatibility with OAuth tokens)
  const authString = username ? `${username}:${token}` : token;

  // Handle https://github.com/... URLs
  if (repoUrl.startsWith('https://github.com/')) {
    return repoUrl.replace('https://github.com/', `https://${authString}@github.com/`);
  }

  // Handle https://github.com URLs without trailing slash
  if (repoUrl.startsWith('https://github.com')) {
    return repoUrl.replace('https://github.com', `https://${authString}@github.com`);
  }

  // For other URLs, return as-is (might be SSH or other provider)
  return repoUrl;
}

export function extractRepoName(url: string): string {
  const cleaned = url.replace(/\.git\/?$/, '').replace(/\/$/, '');
  const segments = cleaned.split('/');
  return segments[segments.length - 1];
}

export interface MultiRepoWorkspaceResult {
  rootPath: string;
  repos: Array<{name: string; path: string; url: string; branch?: string; startingCommit: string}>;
  cleanup: () => Promise<void>;
}

export async function prepareMultiRepoWorkspace(
  repositories: Array<{url: string; branch?: string}>,
  options: PrepareWorkspaceOptions
): Promise<MultiRepoWorkspaceResult> {
  const { authToken, runId, skipSkills } = options;

  const credentials = await fetchGitHubCredentials(authToken);
  const rootPath = await mkdtemp(join(tmpdir(), 'cg-workspace-'));

  const cleanup = async () => {
    try {
      await rm(rootPath, { recursive: true, force: true });
    } catch (error) {
      console.error(chalk.yellow(`Warning: Failed to cleanup workspace at ${rootPath}:`), error);
    }
  };

  try {
    const repos: MultiRepoWorkspaceResult['repos'] = [];

    // Deduplicate repo names (e.g. org-a/utils and org-b/utils)
    const rawNames = repositories.map(r => extractRepoName(r.url));
    const nameOccurrences = new Map<string, number>();
    for (const n of rawNames) {
      nameOccurrences.set(n, (nameOccurrences.get(n) || 0) + 1);
    }
    const nameIndex = new Map<string, number>();
    const uniqueNames = rawNames.map(n => {
      if ((nameOccurrences.get(n) || 0) > 1) {
        const idx = (nameIndex.get(n) || 0) + 1;
        nameIndex.set(n, idx);
        return `${n}-${idx}`;
      }
      return n;
    });

    for (let i = 0; i < repositories.length; i++) {
      const repo = repositories[i];
      const name = uniqueNames[i];
      const repoPath = join(rootPath, name);
      const cloneUrl = buildAuthenticatedUrl(repo.url, credentials.githubToken, credentials.gitCredentialsUsername);

      console.log(`Cloning ${chalk.cyan(repo.url)}`);
      console.log(chalk.dim(`   ${repoPath}`));
      await runGitCommand(['clone', cloneUrl, repoPath]);
      console.log(chalk.green('Repository cloned'));

      if (credentials.githubUsername) {
        await runGitCommand(['config', 'user.name', credentials.githubUsername], repoPath);
      }
      if (credentials.githubEmail) {
        await runGitCommand(['config', 'user.email', credentials.githubEmail], repoPath);
      }

      await appendFile(join(repoPath, '.git', 'info', 'exclude'), '\n.claude/skills/\n');

      if (repo.branch) {
        const { stdout } = await runGitCommand(
          ['ls-remote', '--heads', 'origin', repo.branch],
          repoPath
        );

        if (stdout.trim().length > 0) {
          console.log(`Checking out branch: ${chalk.cyan(repo.branch)}`);
          await runGitCommand(['checkout', repo.branch], repoPath);
        } else {
          console.log(`Creating new branch: ${chalk.cyan(repo.branch)}`);
          await runGitCommand(['checkout', '-b', repo.branch], repoPath);
        }
      }

      const { stdout: commitHash } = await runGitCommand(['rev-parse', 'HEAD'], repoPath);

      repos.push({
        name,
        path: repoPath,
        url: repo.url,
        branch: repo.branch,
        startingCommit: commitHash.trim(),
      });
    }

    console.log('');
    if (skipSkills) {
      console.log(chalk.dim('Skipping skill injection (--no-skills flag)'));
    } else {
      try {
        const librarySkills = await fetchSkillsLibrary({ authToken, runId });
        if (librarySkills.length > 0) {
          await injectSkills(rootPath, librarySkills);
        } else {
          console.log(chalk.dim('No skills to inject (empty library)'));
        }
      } catch (skillError) {
        console.warn(chalk.yellow('Skill injection failed (agent will continue):'), skillError);
      }
    }

    return { rootPath, repos, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function prepareWorkspace(
  repoUrl: string,
  options: PrepareWorkspaceOptions
): Promise<WorkspaceResult> {
  const { branch, authToken, runId, skipSkills } = options;

  // Fetch GitHub credentials
  const credentials = await fetchGitHubCredentials(authToken);

  // Create temp directory
  const workspacePath = await mkdtemp(join(tmpdir(), 'cg-workspace-'));

  const cleanup = async () => {
    try {
      await rm(workspacePath, { recursive: true, force: true });
    } catch (error) {
      console.error(chalk.yellow(`Warning: Failed to cleanup workspace at ${workspacePath}:`), error);
    }
  };

  try {
    // Build authenticated clone URL
    const cloneUrl = buildAuthenticatedUrl(repoUrl, credentials.githubToken, credentials.gitCredentialsUsername);

    // Clone the repository
    console.log(`Cloning ${chalk.cyan(repoUrl)}`);
    console.log(chalk.dim(`   ${workspacePath}`));
    await runGitCommand(['clone', cloneUrl, workspacePath]);
    console.log(chalk.green('Repository cloned'));

    // Configure git identity if we have the info
    if (credentials.githubUsername) {
      await runGitCommand(['config', 'user.name', credentials.githubUsername], workspacePath);
    }
    if (credentials.githubEmail) {
      await runGitCommand(['config', 'user.email', credentials.githubEmail], workspacePath);
    }

    // Add .claude/skills/ to git exclude to prevent injected skills from being committed
    // This ensures skills we inject (or modify) don't accidentally end up in PRs
    await appendFile(join(workspacePath, '.git', 'info', 'exclude'), '\n.claude/skills/\n');

    // Handle branch checkout if specified
    if (branch) {
      // Check if branch exists remotely
      const { stdout } = await runGitCommand(
        ['ls-remote', '--heads', 'origin', branch],
        workspacePath
      );

      const branchExists = stdout.trim().length > 0;

      if (branchExists) {
        // Checkout existing branch
        console.log(`Checking out branch: ${chalk.cyan(branch)}`);
        await runGitCommand(['checkout', branch], workspacePath);
      } else {
        // Create new branch
        console.log(`Creating new branch: ${chalk.cyan(branch)}`);
        await runGitCommand(['checkout', '-b', branch], workspacePath);
      }
    }

    // Capture starting commit for historical accuracy
    const { stdout: commitHash } = await runGitCommand(['rev-parse', 'HEAD'], workspacePath);
    const startingCommit = commitHash.trim();

    // Fetch and inject skills from ContextGraph library into workspace
    // This happens AFTER repo clone but BEFORE Claude Code starts
    console.log('');  // Blank line for better log readability
    if (skipSkills) {
      console.log(chalk.dim('Skipping skill injection (--no-skills flag)'));
    } else {
      try {
        // Fetch user's skills library from ContextGraph API
        // If runId is provided, the server will record which skills were loaded for this run
        const librarySkills = await fetchSkillsLibrary({ authToken, runId });

        if (librarySkills.length > 0) {
          await injectSkills(workspacePath, librarySkills);
        } else {
          console.log(chalk.dim('No skills to inject (empty library)'));
        }
      } catch (skillError) {
        // Log but don't fail - agent can still work without skills
        console.warn(chalk.yellow('Skill injection failed (agent will continue):'), skillError);
      }
    }

    return { path: workspacePath, startingCommit, cleanup };
  } catch (error) {
    // Cleanup on failure
    await cleanup();
    throw error;
  }
}
