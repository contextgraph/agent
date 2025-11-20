import { createInterface } from 'readline';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { GitCredentials } from '../types/actions.js';
import {
  loadGitCredentials,
  saveGitCredentials,
  validateGitToken,
} from '../credentials.js';

const execAsync = promisify(exec);

/**
 * Check if GitHub CLI is installed and authenticated
 */
async function checkGitHubCLI(): Promise<{
  authenticated: boolean;
  error?: string;
}> {
  try {
    // Check if gh is installed
    await execAsync('which gh');

    // Check if authenticated
    const { stdout } = await execAsync('gh auth status');
    return { authenticated: stdout.includes('Logged in') };
  } catch (error) {
    return {
      authenticated: false,
      error:
        error instanceof Error ? error.message : 'GitHub CLI not available',
    };
  }
}

/**
 * Prompt for secure input (password-style, hidden input)
 */
async function promptSecure(message: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Acquire git credentials using tiered detection strategy
 *
 * Tier 1: GitHub CLI (gh auth token)
 * Tier 2: Environment variables (GITHUB_TOKEN, GITLAB_TOKEN)
 * Tier 3: Manual token prompt
 *
 * @returns GitCredentials object with token and metadata
 */
export async function acquireGitCredentials(): Promise<GitCredentials> {
  console.log('🔐 Acquiring git credentials...\n');

  // Check if credentials already exist
  const existing = await loadGitCredentials();
  if (existing) {
    console.log('✅ Found existing git credentials');
    console.log(`   Provider: ${existing.provider || 'unknown'}`);
    console.log(`   Source: ${existing.source}`);
    console.log(`   Acquired: ${existing.acquiredAt}`);

    // Validate existing token
    if (existing.githubToken && existing.provider === 'github') {
      const valid = await validateGitToken(existing.githubToken, 'github');
      if (valid) {
        console.log('   Status: ✅ Valid\n');
        return existing;
      }
      console.log('   Status: ❌ Invalid - acquiring new credentials\n');
    } else if (existing.gitlabToken && existing.provider === 'gitlab') {
      const valid = await validateGitToken(existing.gitlabToken, 'gitlab');
      if (valid) {
        console.log('   Status: ✅ Valid\n');
        return existing;
      }
      console.log('   Status: ❌ Invalid - acquiring new credentials\n');
    }
  }

  // Tier 1: GitHub CLI Detection
  console.log('🔍 Tier 1: Checking GitHub CLI...');
  const ghAuth = await checkGitHubCLI();

  if (ghAuth.authenticated) {
    console.log('✅ GitHub CLI authenticated');
    try {
      const { stdout: token } = await execAsync('gh auth token');
      const trimmedToken = token.trim();

      console.log('🔒 Validating token...');
      const valid = await validateGitToken(trimmedToken, 'github');

      if (valid) {
        const credentials: GitCredentials = {
          githubToken: trimmedToken,
          provider: 'github',
          source: 'gh-cli',
          acquiredAt: new Date().toISOString(),
        };

        await saveGitCredentials(credentials);
        console.log('✅ GitHub credentials saved\n');
        return credentials;
      }

      console.log('❌ GitHub CLI token is invalid');
    } catch (error) {
      console.log(
        `❌ Failed to get token from GitHub CLI: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  } else {
    console.log(`ℹ️  GitHub CLI not authenticated: ${ghAuth.error || 'Unknown'}`);
  }

  // Tier 2: Environment Variables
  console.log('\n🔍 Tier 2: Checking environment variables...');

  if (process.env.GITHUB_TOKEN) {
    console.log('✅ Found GITHUB_TOKEN environment variable');
    console.log('🔒 Validating token...');

    const valid = await validateGitToken(process.env.GITHUB_TOKEN, 'github');

    if (valid) {
      const credentials: GitCredentials = {
        githubToken: process.env.GITHUB_TOKEN,
        provider: 'github',
        source: 'env',
        acquiredAt: new Date().toISOString(),
      };

      await saveGitCredentials(credentials);
      console.log('✅ GitHub credentials saved\n');
      return credentials;
    }

    console.log('❌ GITHUB_TOKEN is invalid');
  }

  if (process.env.GITLAB_TOKEN) {
    console.log('✅ Found GITLAB_TOKEN environment variable');
    console.log('🔒 Validating token...');

    const valid = await validateGitToken(process.env.GITLAB_TOKEN, 'gitlab');

    if (valid) {
      const credentials: GitCredentials = {
        gitlabToken: process.env.GITLAB_TOKEN,
        provider: 'gitlab',
        source: 'env',
        acquiredAt: new Date().toISOString(),
      };

      await saveGitCredentials(credentials);
      console.log('✅ GitLab credentials saved\n');
      return credentials;
    }

    console.log('❌ GITLAB_TOKEN is invalid');
  }

  console.log('ℹ️  No valid environment variables found');

  // Tier 3: Manual Token Prompt
  console.log('\n🔍 Tier 3: Manual token entry');
  console.log('\n⚠️  No git credentials found. Manual token entry required.\n');
  console.log('📝 To create a GitHub token:');
  console.log('   1. Visit: https://github.com/settings/tokens');
  console.log('   2. Click "Generate new token (classic)"');
  console.log('   3. Required scopes: repo, read:org');
  console.log('   4. Copy the generated token\n');
  console.log('📝 To create a GitLab token:');
  console.log('   1. Visit: https://gitlab.com/-/profile/personal_access_tokens');
  console.log('   2. Required scopes: api, read_api, read_repository, write_repository');
  console.log('   3. Copy the generated token\n');

  const provider = await promptSecure(
    'Enter provider (github/gitlab) [github]: '
  );
  const selectedProvider =
    provider.toLowerCase() === 'gitlab' ? 'gitlab' : 'github';

  const token = await promptSecure(
    `Enter your ${selectedProvider === 'github' ? 'GitHub' : 'GitLab'} token: `
  );

  if (!token) {
    throw new Error('Token is required');
  }

  console.log('\n🔒 Validating token...');
  const valid = await validateGitToken(token, selectedProvider);

  if (!valid) {
    throw new Error(
      `Invalid ${selectedProvider === 'github' ? 'GitHub' : 'GitLab'} token. Please check the token and required scopes.`
    );
  }

  const credentials: GitCredentials = {
    ...(selectedProvider === 'github'
      ? { githubToken: token }
      : { gitlabToken: token }),
    provider: selectedProvider,
    source: 'manual',
    acquiredAt: new Date().toISOString(),
  };

  await saveGitCredentials(credentials);
  console.log(
    `✅ ${selectedProvider === 'github' ? 'GitHub' : 'GitLab'} credentials saved\n`
  );

  return credentials;
}

/**
 * Run the git authentication workflow
 * This is the main entry point for the git-auth CLI command
 */
export async function runGitAuth(): Promise<void> {
  try {
    const credentials = await acquireGitCredentials();

    console.log('✅ Git authentication successful!');
    console.log(`   Provider: ${credentials.provider || 'unknown'}`);
    console.log(`   Source: ${credentials.source}`);
    console.log(`   Acquired: ${credentials.acquiredAt}`);
  } catch (error) {
    console.error(
      '\n❌ Git authentication failed:',
      error instanceof Error ? error.message : 'Unknown error'
    );
    process.exit(1);
  }
}
