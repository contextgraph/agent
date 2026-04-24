import chalk from 'chalk';
import { ApiClient, type StewardNextResource } from '../api-client.js';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { PRIMARY_WEB_BASE_URL } from '../platform-urls.js';
import { printWrapped } from './render.js';
import { printFileSurfaceConjecture } from './steward-backlog-format.js';
import { detectCurrentBranch } from '../git-current-branch.js';

const DEFAULT_BASE_URL = PRIMARY_WEB_BASE_URL;

export interface StewardClaimOptions {
  identifier?: string;
  branch?: string;
  baseUrl?: string;
}

function printClaim(next: StewardNextResource) {
  console.log(chalk.bold('# Steward Claim'));
  console.log(`- ${chalk.bold('Steward:')} ${chalk.cyan(`${next.steward.name} (${next.steward.slug})`)}`);
  if (next.backlog_item.id) {
    console.log(`- ${chalk.bold('Backlog ID:')} ${next.backlog_item.id}`);
  }
  if (next.backlog_item.backlog_reference) {
    console.log(`- ${chalk.bold('Backlog Ref:')} ${next.backlog_item.backlog_reference}`);
  }
  console.log(`- ${chalk.bold('Title:')} ${next.backlog_item.title}`);
  if (next.backlog_item.repository_url) {
    console.log(`- ${chalk.bold('Repository:')} ${next.backlog_item.repository_url}`);
  }

  console.log('');
  console.log(chalk.bold('## Objective'));
  printWrapped(next.backlog_item.objective, { indent: '  ' });

  console.log('');
  console.log(chalk.bold('## Rationale'));
  printWrapped(next.backlog_item.rationale, { indent: '  ' });
  printFileSurfaceConjecture(next.backlog_item.metadata);

  if (next.workflow?.dismissal_rule || next.workflow?.dismissal_command || next.workflow?.completion_rule) {
    console.log('');
    console.log(chalk.bold('## Workflow'));
    if (next.workflow?.dismissal_rule) {
      console.log(`- ${chalk.bold('Dismissal rule:')}`);
      printWrapped(next.workflow.dismissal_rule, { indent: '  ' });
    }
    if (next.workflow?.dismissal_command) {
      console.log(`- ${chalk.bold('Dismiss command:')}`);
      printWrapped(next.workflow.dismissal_command, { indent: '  ' });
    }
    if (next.workflow?.completion_rule) {
      console.log(`- ${chalk.bold('Completion rule:')}`);
      printWrapped(next.workflow.completion_rule, { indent: '  ' });
    }
  }

  if (next.workflow?.session_rule) {
    console.log('');
    console.log(chalk.bold('## Stop Rule'));
    printWrapped(next.workflow.session_rule, { indent: '  ' });
  }
}

async function resolveBranchForClaim(explicit: string | undefined): Promise<string> {
  if (explicit) {
    const trimmed = explicit.trim();
    if (!trimmed) {
      throw new Error('--branch value must not be empty');
    }
    return trimmed;
  }

  const detected = await detectCurrentBranch();
  if (detected.kind === 'branch') {
    return detected.name;
  }
  if (detected.kind === 'detached') {
    throw new Error(
      'steward backlog claim requires a branch checkout. HEAD is detached. ' +
        'Run `git checkout -b <branch>` first, or pass `--branch <name>` explicitly.'
    );
  }
  throw new Error(
    'steward backlog claim requires a git repository. Could not detect current branch ' +
      `(${detected.message}). Run the command from inside a git checkout, or pass \`--branch <name>\` explicitly.`
  );
}

export async function runStewardClaim(options: StewardClaimOptions = {}): Promise<void> {
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

  if (!options.identifier) {
    const next = await apiClient.nextStewardWork();
    if (!next) {
      console.log(chalk.yellow('No queued steward backlog items right now.'));
      return;
    }
    printClaim(next);
    console.log('');
    console.log(chalk.yellow('Deprecated: shortcut `steward backlog claim` without an identifier returns the top queued item but does not register a branch.'));
    console.log(chalk.yellow('Run `steward backlog top` to inspect, then `steward backlog claim <identifier>` from the branch you will push from.'));
    return;
  }

  const branch = await resolveBranchForClaim(options.branch);
  const next = await apiClient.claimStewardBacklog(options.identifier, branch);

  printClaim(next);

  console.log('');
  console.log(chalk.bold('## Registered Branch'));
  printWrapped(
    `This claim is registered to branch \`${branch}\`. Any PR pushed from this branch in ${next.backlog_item.repository_url ?? 'this repository'} will link automatically.`,
    { indent: '  ' }
  );

  console.log('');
  console.log(chalk.bold('## Next Step'));
  printWrapped(
    `Do the work on \`${branch}\` and open a PR from it. If you switch branches before opening the PR, re-run \`steward backlog claim ${options.identifier}\` from the new branch to update the registration. Do not claim another backlog item until this one is done, dismissed, or unclaimed.`,
    { indent: '  ' }
  );
}
