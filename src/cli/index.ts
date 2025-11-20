import { Command } from 'commander';
import { runAuth } from '../workflows/auth.js';
import { runGitAuth } from '../workflows/git-auth.js';
import { runPrepare } from '../workflows/prepare.js';
import { runExecute } from '../workflows/execute.js';
import { runLocalAgent } from '../workflows/agent.js';
import { loadCredentials, loadGitCredentials, isExpired, isTokenExpired } from '../credentials.js';

const program = new Command();

program
  .name('contextgraph-agent')
  .description('Autonomous agent for contextgraph action execution')
  .version('0.1.0');

program
  .command('run')
  .argument('<action-id>', 'Action ID to execute autonomously')
  .description('Run autonomous prepare/execute cycle for an action. Automatically prepares and executes actions in dependency order. Supports repository cloning and workspace preparation when repository context is specified.')
  .action(async (actionId: string) => {
    try {
      await runLocalAgent(actionId);
    } catch (error) {
      console.error('Error running agent:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('auth')
  .description('Authenticate with contextgraph.dev')
  .action(async () => {
    try {
      await runAuth();
    } catch (error) {
      console.error('Error during authentication:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('auth:git')
  .description('Authenticate with git provider (GitHub or GitLab). Tries gh CLI, environment variables (GITHUB_TOKEN/GITLAB_TOKEN), or manual token entry. Required for private repositories.')
  .action(async () => {
    try {
      await runGitAuth();
    } catch (error) {
      console.error('Error during git authentication:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('prepare')
  .argument('<action-id>', 'Action ID to prepare')
  .description('Prepare a single action')
  .action(async (actionId: string) => {
    try {
      await runPrepare(actionId);
    } catch (error) {
      console.error('Error preparing action:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('execute')
  .argument('<action-id>', 'Action ID to execute')
  .description('Execute a single action. Automatically clones repository and prepares workspace if repository context is specified. Runs tests, commits changes, and marks action complete.')
  .action(async (actionId: string) => {
    try {
      await runExecute(actionId);
    } catch (error) {
      console.error('Error executing action:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('whoami')
  .description('Show current authentication status')
  .action(async () => {
    try {
      const credentials = await loadCredentials();

      if (!credentials) {
        console.log('Not authenticated. Run `contextgraph-agent auth` to authenticate.');
        process.exit(1);
      }

      if (isExpired(credentials) || isTokenExpired(credentials.clerkToken)) {
        console.log('⚠️  Token expired. Run `contextgraph-agent auth` to re-authenticate.');
        console.log(`User ID: ${credentials.userId}`);
        console.log(`Expired at: ${credentials.expiresAt}`);
        process.exit(1);
      }

      console.log('✅ Authenticated');
      console.log(`User ID: ${credentials.userId}`);
      console.log(`Expires at: ${credentials.expiresAt}`);

      // Check git authentication status
      const gitCreds = await loadGitCredentials();
      if (gitCreds) {
        console.log('\n🔐 Git Authentication:');
        console.log(`   Provider: ${gitCreds.provider || 'unknown'}`);
        console.log(`   Source: ${gitCreds.source}`);
        console.log(`   Acquired: ${gitCreds.acquiredAt}`);
      } else {
        console.log('\nℹ️  Not authenticated with git. Run `contextgraph-agent auth:git` to authenticate.');
      }
    } catch (error) {
      console.error('Error checking authentication:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.parse();
