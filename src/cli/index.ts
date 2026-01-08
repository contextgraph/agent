import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runAuth } from '../workflows/auth.js';
import { runPrepare } from '../workflows/prepare.js';
import { runExecute } from '../workflows/execute.js';
import { runLocalAgent } from '../workflows/agent.js';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf-8')
);

const program = new Command();

program
  .name('contextgraph-agent')
  .description('Autonomous agent for contextgraph action execution')
  .version(packageJson.version);

program
  .command('run')
  .description('Run continuous worker loop (claims and executes actions until Ctrl+C)')
  .option('--force-haiku', 'Force all workflows to use claude-haiku-4-5 instead of default models')
  .action(async (options) => {
    try {
      await runLocalAgent({
        forceModel: options.forceHaiku ? 'claude-haiku-4-5-20251001' : undefined,
      });
    } catch (error) {
      if (error instanceof Error) {
        console.error('Error running agent:', error.message || '(no message)');
        if (error.stack) {
          console.error('\nStack trace:');
          console.error(error.stack);
        }
      } else {
        console.error('Error running agent:', error);
      }
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
  .description('Execute a single action')
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
    } catch (error) {
      console.error('Error checking authentication:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.parse();
