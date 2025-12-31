import { spawn } from 'child_process';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { fetchWithRetry } from './fetch-with-retry.js';
import type { GitHubCredentials } from './types/actions.js';

const API_BASE_URL = 'https://www.contextgraph.dev';

export interface WorkspaceResult {
  path: string;
  startingCommit: string;
  cleanup: () => Promise<void>;
}

export interface PrepareWorkspaceOptions {
  branch?: string;
  authToken: string;
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

function buildAuthenticatedUrl(repoUrl: string, token: string): string {
  // Handle https://github.com/... URLs
  if (repoUrl.startsWith('https://github.com/')) {
    return repoUrl.replace('https://github.com/', `https://${token}@github.com/`);
  }

  // Handle https://github.com URLs without trailing slash
  if (repoUrl.startsWith('https://github.com')) {
    return repoUrl.replace('https://github.com', `https://${token}@github.com`);
  }

  // For other URLs, return as-is (might be SSH or other provider)
  return repoUrl;
}

export async function prepareWorkspace(
  repoUrl: string,
  options: PrepareWorkspaceOptions
): Promise<WorkspaceResult> {
  const { branch, authToken } = options;

  // Fetch GitHub credentials
  const credentials = await fetchGitHubCredentials(authToken);

  // Create temp directory
  const workspacePath = await mkdtemp(join(tmpdir(), 'cg-workspace-'));

  const cleanup = async () => {
    try {
      await rm(workspacePath, { recursive: true, force: true });
    } catch (error) {
      console.error(`Warning: Failed to cleanup workspace at ${workspacePath}:`, error);
    }
  };

  try {
    // Build authenticated clone URL
    const cloneUrl = buildAuthenticatedUrl(repoUrl, credentials.githubToken);

    // Clone the repository
    console.log(`📂 Cloning ${repoUrl}`);
    console.log(`   → ${workspacePath}`);
    await runGitCommand(['clone', cloneUrl, workspacePath]);
    console.log(`✅ Repository cloned`);

    // Configure git identity if we have the info
    if (credentials.githubUsername) {
      await runGitCommand(['config', 'user.name', credentials.githubUsername], workspacePath);
    }
    if (credentials.githubEmail) {
      await runGitCommand(['config', 'user.email', credentials.githubEmail], workspacePath);
    }

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
        console.log(`🌿 Checking out branch: ${branch}`);
        await runGitCommand(['checkout', branch], workspacePath);
      } else {
        // Create new branch
        console.log(`🌱 Creating new branch: ${branch}`);
        await runGitCommand(['checkout', '-b', branch], workspacePath);
      }
    }

    // Capture starting commit for historical accuracy
    const { stdout: commitHash } = await runGitCommand(['rev-parse', 'HEAD'], workspacePath);
    const startingCommit = commitHash.trim();

    return { path: workspacePath, startingCommit, cleanup };
  } catch (error) {
    // Cleanup on failure
    await cleanup();
    throw error;
  }
}
