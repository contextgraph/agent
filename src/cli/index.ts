import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { basename, dirname, join } from 'path';
import { runAuth } from '../workflows/auth.js';
import { runPrepare } from '../workflows/prepare.js';
import { runExecute } from '../workflows/execute.js';
import { runLocalAgent } from '../workflows/agent.js';
import { runSetup } from '../workflows/setup.js';
import { runStewardStep } from '../workflows/steward-step.js';
import { runStewardLoop } from '../workflows/steward-run.js';
import { runStewardNext } from '../workflows/steward-next.js';
import { runStewardDismiss } from '../workflows/steward-dismiss.js';
import { runStewardClaim } from '../workflows/steward-claim.js';
import { runStewardClaimed } from '../workflows/steward-claimed.js';
import { runStewardUnclaim } from '../workflows/steward-unclaim.js';
import { runStewardTop } from '../workflows/steward-top.js';
import { runStewardBacklogCreate } from '../workflows/steward-backlog-create.js';
import { runStewardNoteCreate } from '../workflows/steward-note-create.js';
import { runStewardMission } from '../workflows/steward-mission.js';
import { runStewardConfigure } from '../workflows/steward-configure.js';
import { runStewardConfigureValidate } from '../workflows/steward-configure-validate.js';
import { runStewardHeartbeat } from '../workflows/steward-heartbeat.js';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { PRIMARY_WEB_BASE_URL } from '../platform-urls.js';
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
const invokedAs = basename(process.argv[1] || '');
const isStewardCli = invokedAs === 'steward' || invokedAs === 'steward.js';

program
  .name(isStewardCli ? 'steward' : 'contextgraph-agent')
  .description(isStewardCli ? 'Steward backlog CLI' : 'Autonomous agent for contextgraph action execution')
  .version(packageJson.version);

async function handleStewardNext(options: { baseUrl?: string }): Promise<void> {
  try {
    await runStewardNext({
      baseUrl: options.baseUrl,
    });
  } catch (error) {
    console.error('Error selecting steward work:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function handleStewardDismiss(identifier: string, options: { note: string; baseUrl?: string }): Promise<void> {
  try {
    await runStewardDismiss({
      identifier,
      note: options.note,
      baseUrl: options.baseUrl,
    });
  } catch (error) {
    console.error('Error dismissing steward backlog item:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function handleStewardClaim(identifier: string | undefined, options: { baseUrl?: string }): Promise<void> {
  try {
    await runStewardClaim({
      identifier,
      baseUrl: options.baseUrl,
    });
  } catch (error) {
    console.error('Error claiming steward backlog item:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function handleStewardClaimed(options: { baseUrl?: string }): Promise<void> {
  try {
    await runStewardClaimed({
      baseUrl: options.baseUrl,
    });
  } catch (error) {
    console.error('Error listing claimed steward backlog items:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function handleStewardTop(options: { steward?: string; baseUrl?: string }): Promise<void> {
  try {
    await runStewardTop({
      steward: options.steward,
      baseUrl: options.baseUrl,
    });
  } catch (error) {
    console.error('Error fetching top steward backlog item:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function handleStewardUnclaim(identifier: string, options: { baseUrl?: string }): Promise<void> {
  try {
    await runStewardUnclaim({
      identifier,
      baseUrl: options.baseUrl,
    });
  } catch (error) {
    console.error('Error unclaiming steward backlog item:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function handleStewardBacklogCreate(options: {
  steward: string;
  title: string;
  objective: string;
  rationale: string;
  repo: string;
  branch?: string;
  priority?: string;
  baseUrl?: string;
}): Promise<void> {
  try {
    const priorityScore = options.priority === undefined ? undefined : Number.parseInt(options.priority, 10);
    if (options.priority !== undefined && (priorityScore === undefined || !Number.isFinite(priorityScore) || priorityScore < 0)) {
      throw new Error('priority must be a non-negative integer');
    }

    await runStewardBacklogCreate({
      steward: options.steward,
      title: options.title,
      objective: options.objective,
      rationale: options.rationale,
      repository_url: options.repo,
      proposed_branch: options.branch,
      priority_score: priorityScore,
      baseUrl: options.baseUrl,
    });
  } catch (error) {
    console.error('Error creating steward backlog item:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function handleStewardNoteCreate(options: {
  steward: string;
  note: string;
  backlogItem?: string;
  baseUrl?: string;
}): Promise<void> {
  try {
    await runStewardNoteCreate({
      steward: options.steward,
      note: options.note,
      backlogItem: options.backlogItem,
      baseUrl: options.baseUrl,
    });
  } catch (error) {
    console.error('Error creating steward note:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function handleStewardMission(identifier: string, options: { baseUrl?: string }): Promise<void> {
  try {
    await runStewardMission({
      steward: identifier,
      baseUrl: options.baseUrl,
    });
  } catch (error) {
    console.error('Error fetching steward mission:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function handleStewardConfigure(): Promise<void> {
  try {
    await runStewardConfigure();
  } catch (error) {
    console.error('Error configuring steward:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function handleStewardConfigureValidate(): Promise<void> {
  try {
    await runStewardConfigureValidate();
  } catch (error) {
    console.error('Error validating steward config:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function handleStewardHeartbeat(steward: string): Promise<void> {
  try {
    await runStewardHeartbeat({ steward });
  } catch (error) {
    console.error('Error running steward heartbeat:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

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
  .description('Authenticate with steward.foo')
  .action(async () => {
    try {
      await runAuth();
    } catch (error) {
      console.error('Error during authentication:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

const configure = program
  .command('configure')
  .description('Create or inspect local steward configuration');

configure
  .command('validate')
  .description('Validate locally configured integrations')
  .action(handleStewardConfigureValidate);

configure
  .action(handleStewardConfigure);

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
  .command('next')
  .description('Pick the next queued steward backlog item for manual work')
  .option('--base-url <baseUrl>', 'ContextGraph API base URL', PRIMARY_WEB_BASE_URL)
  .action(handleStewardNext);

const backlog = program
  .command('backlog')
  .description('Steward backlog workflows');

backlog
  .command('top')
  .description('Inspect the highest-priority queued steward backlog item without claiming it')
  .option('--steward <steward>', 'Limit selection to a specific steward ID or steward slug')
  .option('--base-url <baseUrl>', 'ContextGraph API base URL', PRIMARY_WEB_BASE_URL)
  .action(handleStewardTop);

backlog
  .command('next')
  .description('Deprecated. Use `steward backlog top` then `steward backlog claim <identifier>`.')
  .option('--base-url <baseUrl>', 'ContextGraph API base URL', PRIMARY_WEB_BASE_URL)
  .action(async () => {
    console.error('Use `steward backlog top` then `steward backlog claim <identifier>`.');
    process.exit(1);
  });

const claim = backlog
  .command('claim')
  .description('Claim steward backlog work explicitly');

claim
  .command('next')
  .description('Claim the next queued steward backlog item for manual work (shortcut; prefer `steward backlog top`)')
  .option('--base-url <baseUrl>', 'ContextGraph API base URL', PRIMARY_WEB_BASE_URL)
  .action((options: { baseUrl?: string }) => handleStewardClaim(undefined, options));

claim
  .argument('<identifier>', 'Backlog item UUID or steward-slug/backlog-item-slug reference')
  .description('Claim a specific queued steward backlog item')
  .option('--base-url <baseUrl>', 'ContextGraph API base URL', PRIMARY_WEB_BASE_URL)
  .action((identifier: string, options: { baseUrl?: string }) => handleStewardClaim(identifier, options));

const queue = program
  .command('queue')
  .description('Steward queue workflows');

queue
  .command('top')
  .description('Inspect the highest-priority queued steward work item without claiming it')
  .option('--steward <steward>', 'Limit selection to a specific steward ID or steward slug')
  .option('--base-url <baseUrl>', 'ContextGraph API base URL', PRIMARY_WEB_BASE_URL)
  .action(handleStewardTop);

backlog
  .command('claimed')
  .description('List all currently claimed steward backlog items')
  .option('--base-url <baseUrl>', 'ContextGraph API base URL', PRIMARY_WEB_BASE_URL)
  .action(handleStewardClaimed);

backlog
  .command('unclaim')
  .argument('<identifier>', 'Backlog item UUID or steward-slug/backlog-item-slug reference')
  .description('Release a claimed steward backlog item back to the queue')
  .option('--base-url <baseUrl>', 'ContextGraph API base URL', PRIMARY_WEB_BASE_URL)
  .action(handleStewardUnclaim);

backlog
  .command('create')
  .requiredOption('--steward <steward>', 'Steward ID or steward slug')
  .requiredOption('--title <title>', 'Backlog item title')
  .requiredOption('--objective <objective>', 'Backlog item objective')
  .requiredOption('--rationale <rationale>', 'Why this backlog item matters')
  .requiredOption('--repo <repositoryUrl>', 'Repository URL for the backlog item')
  .option('--branch <proposedBranch>', 'Optional proposed branch; generated when omitted')
  .option('--priority <score>', 'Optional priority score')
  .option('--base-url <baseUrl>', 'ContextGraph API base URL', PRIMARY_WEB_BASE_URL)
  .action(handleStewardBacklogCreate);

backlog
  .command('dismiss')
  .argument('<identifier>', 'Backlog item UUID or steward-slug/backlog-item-slug reference')
  .requiredOption('--note <note>', 'Reason for dismissing the backlog item')
  .option('--base-url <baseUrl>', 'ContextGraph API base URL', PRIMARY_WEB_BASE_URL)
  .action(handleStewardDismiss);

const queueClaim = queue
  .command('claim')
  .description('Claim a queued steward work item');

queueClaim
  .argument('<identifier>', 'Backlog item UUID or steward-slug/backlog-item-slug reference')
  .option('--base-url <baseUrl>', 'ContextGraph API base URL', PRIMARY_WEB_BASE_URL)
  .action((identifier: string, options: { baseUrl?: string }) => handleStewardClaim(identifier, options));

queue
  .command('active')
  .description('List all currently active steward queue items')
  .option('--base-url <baseUrl>', 'ContextGraph API base URL', PRIMARY_WEB_BASE_URL)
  .action(handleStewardClaimed);

queue
  .command('unclaim')
  .argument('<identifier>', 'Queue item UUID')
  .description('Release a claimed steward queue item back to the queue')
  .option('--base-url <baseUrl>', 'ContextGraph API base URL', PRIMARY_WEB_BASE_URL)
  .action(handleStewardUnclaim);

const note = program
  .command('note')
  .description('Steward note operations');

note
  .command('create')
  .requiredOption('--steward <steward>', 'Steward ID or steward slug')
  .requiredOption('--note <note>', 'Note content')
  .option('--backlog-item <identifier>', 'Optional backlog item UUID or steward-slug/backlog-item-slug reference')
  .option('--base-url <baseUrl>', 'ContextGraph API base URL', PRIMARY_WEB_BASE_URL)
  .action(handleStewardNoteCreate);

program
  .command('mission')
  .argument('<steward>', 'Steward ID or steward slug')
  .description('Show the mission for an active steward')
  .option('--base-url <baseUrl>', 'ContextGraph API base URL', PRIMARY_WEB_BASE_URL)
  .action(handleStewardMission);

program
  .command('heartbeat')
  .argument('<steward>', 'Steward ID or steward slug')
  .description('Run a local steward heartbeat')
  .action(handleStewardHeartbeat);

steward
  .command('step')
  .description('Run one steward execution pass (claim -> execute -> release)')
  .option('--steward-id <stewardId>', 'Target a specific steward ID')
  .option('--worker-id <workerId>', 'Optional worker ID for claim/release correlation')
  .option('--dry-run', 'Claim and fetch prompt, but skip agent execution')
  .option('--provider <provider>', `Execution provider (${PROVIDER_VALUES.join('|')})`, 'claude')
  .option('--execution-mode <mode>', `Execution mode (${EXECUTION_MODE_VALUES.join('|')})`)
  .option('--skip-skills', 'Skip skill injection (for testing)')
  .option('--base-url <baseUrl>', 'ContextGraph API base URL', PRIMARY_WEB_BASE_URL)
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
  .option('--base-url <baseUrl>', 'ContextGraph API base URL', PRIMARY_WEB_BASE_URL)
  .option('--interval-seconds <seconds>', 'Delay between loop steps (default: 30)', '30')
  .option('--max-steps <count>', 'Maximum number of claimed steps before exiting')
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
