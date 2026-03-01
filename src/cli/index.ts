import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runAuth } from '../workflows/auth.js';
import { runPrepare } from '../workflows/prepare.js';
import { runExecute } from '../workflows/execute.js';
import { runLocalAgent } from '../workflows/agent.js';
import { runSetup } from '../workflows/setup.js';
import { runStewardStep } from '../workflows/steward-step.js';
import { runStewardLoop } from '../workflows/steward-run.js';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import type { AgentProvider } from '../runners/index.js';
import type { RunnerExecutionMode } from '../runners/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf-8')
);

const program = new Command();
const PROVIDER_VALUES: AgentProvider[] = ['claude', 'codex'];
const EXECUTION_MODE_VALUES: RunnerExecutionMode[] = ['restricted', 'full-access'];

program
  .name('contextgraph-agent')
  .description('Autonomous agent for contextgraph action execution')
  .version(packageJson.version);

program
  .command('setup')
  .description('Interactive setup wizard for new users')
  .action(async () => {
    try {
      await runSetup();
    } catch (error) {
      console.error('Error during setup:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('run')
  .description('Run continuous worker loop (claims and executes actions until Ctrl+C)')
  .option('--provider <provider>', `Execution provider (${PROVIDER_VALUES.join('|')})`, 'claude')
  .option('--execution-mode <mode>', `Execution mode (${EXECUTION_MODE_VALUES.join('|')})`)
  .option('--force-haiku', 'Force all workflows to use claude-haiku-4-5 instead of default models')
  .option('--skip-skills', 'Skip skill injection (for testing)')
  .action(async (options: { provider: string; executionMode?: string; forceHaiku?: boolean; skipSkills?: boolean }) => {
    try {
      if (!PROVIDER_VALUES.includes(options.provider as AgentProvider)) {
        console.error(`Invalid provider "${options.provider}". Expected one of: ${PROVIDER_VALUES.join(', ')}`);
        process.exit(1);
      }
      if (options.executionMode && !EXECUTION_MODE_VALUES.includes(options.executionMode as RunnerExecutionMode)) {
        console.error(`Invalid execution mode "${options.executionMode}". Expected one of: ${EXECUTION_MODE_VALUES.join(', ')}`);
        process.exit(1);
      }
      if (options.forceHaiku && options.provider !== 'claude') {
        console.warn('--force-haiku is only supported with --provider claude; ignoring flag.');
      }

      await runLocalAgent({
        forceModel: options.forceHaiku && options.provider === 'claude' ? 'claude-haiku-4-5-20251001' : undefined,
        provider: options.provider as AgentProvider,
        executionMode: options.executionMode as RunnerExecutionMode | undefined,
        skipSkills: options.skipSkills,
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
  .option('--provider <provider>', `Execution provider (${PROVIDER_VALUES.join('|')})`, 'claude')
  .option('--execution-mode <mode>', `Execution mode (${EXECUTION_MODE_VALUES.join('|')})`)
  .option('--skip-skills', 'Skip skill injection (for testing)')
  .action(async (actionId: string, options: { provider: string; executionMode?: string; skipSkills?: boolean }) => {
    try {
      if (!PROVIDER_VALUES.includes(options.provider as AgentProvider)) {
        console.error(`Invalid provider "${options.provider}". Expected one of: ${PROVIDER_VALUES.join(', ')}`);
        process.exit(1);
      }
      if (options.executionMode && !EXECUTION_MODE_VALUES.includes(options.executionMode as RunnerExecutionMode)) {
        console.error(`Invalid execution mode "${options.executionMode}". Expected one of: ${EXECUTION_MODE_VALUES.join(', ')}`);
        process.exit(1);
      }
      await runPrepare(actionId, {
        provider: options.provider as AgentProvider,
        executionMode: options.executionMode as RunnerExecutionMode | undefined,
        skipSkills: options.skipSkills,
      });
    } catch (error) {
      console.error('Error preparing action:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('execute')
  .argument('<action-id>', 'Action ID to execute')
  .description('Execute a single action')
  .option('--provider <provider>', `Execution provider (${PROVIDER_VALUES.join('|')})`, 'claude')
  .option('--execution-mode <mode>', `Execution mode (${EXECUTION_MODE_VALUES.join('|')})`)
  .option('--skip-skills', 'Skip skill injection (for testing)')
  .action(async (actionId: string, options: { provider: string; executionMode?: string; skipSkills?: boolean }) => {
    try {
      if (!PROVIDER_VALUES.includes(options.provider as AgentProvider)) {
        console.error(`Invalid provider "${options.provider}". Expected one of: ${PROVIDER_VALUES.join(', ')}`);
        process.exit(1);
      }
      if (options.executionMode && !EXECUTION_MODE_VALUES.includes(options.executionMode as RunnerExecutionMode)) {
        console.error(`Invalid execution mode "${options.executionMode}". Expected one of: ${EXECUTION_MODE_VALUES.join(', ')}`);
        process.exit(1);
      }
      await runExecute(actionId, {
        provider: options.provider as AgentProvider,
        executionMode: options.executionMode as RunnerExecutionMode | undefined,
        skipSkills: options.skipSkills,
      });
    } catch (error) {
      console.error('Error executing action:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

const steward = program
  .command('steward')
  .description('Steward execution workflows');

steward
  .command('step')
  .description('Run one steward execution pass (claim -> execute -> release)')
  .option('--steward-id <stewardId>', 'Target a specific steward ID')
  .option('--worker-id <workerId>', 'Optional worker ID for claim/release correlation')
  .option('--dry-run', 'Claim and fetch prompt, but skip agent execution')
  .option('--provider <provider>', `Execution provider (${PROVIDER_VALUES.join('|')})`, 'claude')
  .option('--execution-mode <mode>', `Execution mode (${EXECUTION_MODE_VALUES.join('|')})`)
  .option('--skip-skills', 'Skip skill injection (for testing)')
  .option('--base-url <baseUrl>', 'ContextGraph API base URL', process.env.CONTEXTGRAPH_BASE_URL || 'https://www.contextgraph.dev')
  .action(async (options: {
    stewardId?: string;
    workerId?: string;
    dryRun?: boolean;
    provider: string;
    executionMode?: string;
    skipSkills?: boolean;
    baseUrl?: string;
  }) => {
    try {
      if (!PROVIDER_VALUES.includes(options.provider as AgentProvider)) {
        console.error(`Invalid provider "${options.provider}". Expected one of: ${PROVIDER_VALUES.join(', ')}`);
        process.exit(1);
      }
      if (options.executionMode && !EXECUTION_MODE_VALUES.includes(options.executionMode as RunnerExecutionMode)) {
        console.error(`Invalid execution mode "${options.executionMode}". Expected one of: ${EXECUTION_MODE_VALUES.join(', ')}`);
        process.exit(1);
      }

      await runStewardStep({
        stewardId: options.stewardId,
        workerId: options.workerId,
        dryRun: options.dryRun,
        provider: options.provider as AgentProvider,
        executionMode: options.executionMode as RunnerExecutionMode | undefined,
        skipSkills: options.skipSkills,
        baseUrl: options.baseUrl,
      });
    } catch (error) {
      console.error('Error running steward step:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

steward
  .command('run')
  .description('Run steward execution loop (repeated steward step until stopped)')
  .option('--steward-id <stewardId>', 'Target a specific steward ID')
  .option('--worker-id <workerId>', 'Optional worker ID for claim/release correlation')
  .option('--dry-run', 'Claim and fetch prompt each loop, but skip agent execution')
  .option('--provider <provider>', `Execution provider (${PROVIDER_VALUES.join('|')})`, 'claude')
  .option('--execution-mode <mode>', `Execution mode (${EXECUTION_MODE_VALUES.join('|')})`)
  .option('--skip-skills', 'Skip skill injection (for testing)')
  .option('--base-url <baseUrl>', 'ContextGraph API base URL', process.env.CONTEXTGRAPH_BASE_URL || 'https://www.contextgraph.dev')
  .option('--interval-seconds <seconds>', 'Delay between loop steps (default: 30)', '30')
  .option('--max-steps <count>', 'Maximum number of steps before exiting')
  .option('--stop-on-error', 'Exit loop on first step error')
  .action(async (options: {
    stewardId?: string;
    workerId?: string;
    dryRun?: boolean;
    provider: string;
    executionMode?: string;
    skipSkills?: boolean;
    baseUrl?: string;
    intervalSeconds: string;
    maxSteps?: string;
    stopOnError?: boolean;
  }) => {
    try {
      if (!PROVIDER_VALUES.includes(options.provider as AgentProvider)) {
        console.error(`Invalid provider "${options.provider}". Expected one of: ${PROVIDER_VALUES.join(', ')}`);
        process.exit(1);
      }
      if (options.executionMode && !EXECUTION_MODE_VALUES.includes(options.executionMode as RunnerExecutionMode)) {
        console.error(`Invalid execution mode "${options.executionMode}". Expected one of: ${EXECUTION_MODE_VALUES.join(', ')}`);
        process.exit(1);
      }

      const intervalSeconds = Number.parseInt(options.intervalSeconds, 10);
      if (!Number.isFinite(intervalSeconds) || intervalSeconds < 0) {
        console.error(`Invalid interval-seconds "${options.intervalSeconds}". Expected a non-negative integer.`);
        process.exit(1);
      }

      const maxSteps = options.maxSteps !== undefined ? Number.parseInt(options.maxSteps, 10) : undefined;
      if (options.maxSteps !== undefined && (maxSteps === undefined || !Number.isInteger(maxSteps) || maxSteps <= 0)) {
        console.error(`Invalid max-steps "${options.maxSteps}". Expected a positive integer.`);
        process.exit(1);
      }

      await runStewardLoop({
        stewardId: options.stewardId,
        workerId: options.workerId,
        dryRun: options.dryRun,
        provider: options.provider as AgentProvider,
        executionMode: options.executionMode as RunnerExecutionMode | undefined,
        skipSkills: options.skipSkills,
        baseUrl: options.baseUrl,
        intervalSeconds,
        maxSteps,
        stopOnError: options.stopOnError,
      });
    } catch (error) {
      console.error('Error running steward loop:', error instanceof Error ? error.message : error);
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
