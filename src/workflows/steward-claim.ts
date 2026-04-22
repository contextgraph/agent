import chalk from 'chalk';
import { ApiClient, type StewardNextResource } from '../api-client.js';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { PRIMARY_WEB_BASE_URL } from '../platform-urls.js';
import { printWrapped } from './render.js';
import { printFileSurfaceConjecture } from './steward-backlog-format.js';
import { preferredBranchMessage } from './steward-backlog-utils.js';

const DEFAULT_BASE_URL = PRIMARY_WEB_BASE_URL;

export interface StewardClaimOptions {
  identifier?: string;
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
  const next = options.identifier
    ? await apiClient.claimStewardBacklog(options.identifier)
    : await apiClient.nextStewardWork();

  if (!next) {
    console.log(chalk.yellow('No queued steward backlog items right now.'));
    return;
  }

  printClaim(next);

  if (!next.backlog_item.proposed_branch) {
    throw new Error('API contract violation: claim route returned a backlog item without proposed_branch');
  }

  const ref = next.backlog_item.backlog_reference ?? next.backlog_item.id ?? '';

  console.log('');
  console.log(chalk.bold('## Preferred Branch'));
  printWrapped(preferredBranchMessage(next.backlog_item.proposed_branch), { indent: '  ' });

  console.log('');
  console.log(chalk.bold('## Workspace Setup'));
  printWrapped(
    `Optional helper: run \`steward backlog setup ${ref}\` to create a clean worktree from \`origin/main\` on the preferred branch. Skip this if you are already on a branch you need to keep (e.g. one assigned by your harness).`,
    { indent: '  ' }
  );

  console.log('');
  console.log(chalk.bold('## PR Linking'));
  printWrapped(
    `PRs pushed from the preferred branch link automatically. From any other branch, link the PR after opening it with \`steward backlog link-pr ${ref} --pr <number-or-url>\` — this stamps a \`Steward-Backlog-Item:\` marker in the PR body so linkage does not depend on branch name.`,
    { indent: '  ' }
  );
  console.log('');
  console.log(chalk.bold('## Next Step'));
  printWrapped(
    `Do the work for this backlog item on the preferred branch \`${next.backlog_item.proposed_branch}\` if possible, or on your current branch if it is pinned — either is fine as long as the resulting PR is linked (automatically via branch name, or manually via \`steward backlog link-pr\`). After you open or update the PR, stop and wait for the user instead of claiming another backlog item.`,
    { indent: '  ' }
  );
}
