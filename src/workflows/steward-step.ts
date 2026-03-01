import { randomUUID } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import chalk from 'chalk';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { ApiClient, type StewardClaimResource } from '../api-client.js';
import { prepareWorkspace } from '../workspace-prep.js';
import { createAgentRunner } from '../runners/index.js';
import type { AgentProvider } from '../runners/index.js';
import type { RunnerExecutionMode } from '../runners/types.js';
import { assertRunnerCapabilities, resolveExecutionMode } from './execution-policy.js';

const DEFAULT_BASE_URL = 'https://www.contextgraph.dev';

export interface StewardStepOptions {
  stewardId?: string;
  workerId?: string;
  dryRun?: boolean;
  provider?: AgentProvider;
  executionMode?: RunnerExecutionMode;
  skipSkills?: boolean;
  baseUrl?: string;
}

export async function runStewardStep(options: StewardStepOptions = {}): Promise<void> {
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
  const workerId = options.workerId || randomUUID();
  const apiClient = new ApiClient(baseUrl);

  let claim: StewardClaimResource | null = null;
  let cleanupWorkspace: (() => Promise<void>) | undefined;

  try {
    claim = await apiClient.claimNextSteward(workerId, options.stewardId);

    if (!claim) {
      if (options.stewardId) {
        console.log(chalk.yellow(`No claimable work for steward ${options.stewardId}.`));
      } else {
        console.log(chalk.yellow('No claimable steward work right now.'));
      }
      return;
    }

    console.log(chalk.bold(`Steward:`), chalk.cyan(`${claim.steward.name} (${claim.steward.id})`));
    if (claim.prompt_version) {
      console.log(chalk.dim(`Prompt version: ${claim.prompt_version}`));
    }
    console.log(chalk.dim(`Backlog candidates: ${claim.backlog_candidates.length}`));

    if (options.dryRun) {
      console.log(chalk.dim('Dry run complete. Agent execution skipped.'));
      return;
    }

    const primaryCandidate = claim.backlog_candidates.find((candidate) => candidate.repositoryUrl?.length > 0);

    let workspacePath: string;
    let promptPrefix = '';

    if (primaryCandidate) {
      const workspace = await prepareWorkspace(primaryCandidate.repositoryUrl, {
        branch: primaryCandidate.proposedBranch ?? undefined,
        authToken: credentials.clerkToken,
        skipSkills: options.skipSkills,
      });

      workspacePath = workspace.path;
      cleanupWorkspace = workspace.cleanup;

      if (primaryCandidate.proposedBranch) {
        promptPrefix = `## Workspace Branch\nThe workspace has been checked out to branch \`${primaryCandidate.proposedBranch}\`. You MUST use this exact branch name for all git operations (checkout, push, PR creation). Do NOT create a different branch name.`;
      }
    } else {
      workspacePath = await mkdtemp(join(tmpdir(), 'cg-workspace-'));
      cleanupWorkspace = async () => {
        await rm(workspacePath, { recursive: true, force: true });
      };
      console.log(chalk.dim('No repository URL in backlog candidates. Using blank temp workspace.'));
      console.log(chalk.dim(`   ${workspacePath}`));
    }

    const prompt = promptPrefix ? `${promptPrefix}\n\n${claim.prompt}` : claim.prompt;

    const runner = createAgentRunner(options.provider);
    const providerName = runner.provider === 'codex' ? 'Codex' : 'Claude';
    const executionMode = resolveExecutionMode({ executionMode: options.executionMode }, runner.provider);
    assertRunnerCapabilities(runner, executionMode, 'Steward step workflow');

    console.log(`Spawning ${providerName} for steward step...\n`);

    const runResult = await runner.execute({
      prompt,
      cwd: workspacePath,
      authToken: credentials.clerkToken,
      executionActionId: claim.steward.id,
      executionMode,
    });

    if (runResult.exitCode !== 0) {
      throw new Error(`${providerName} execution failed with exit code ${runResult.exitCode}`);
    }

    console.log('\n' + chalk.green('Steward step complete'));
  } finally {
    if (cleanupWorkspace) {
      await cleanupWorkspace();
    }

    if (claim) {
      try {
        await apiClient.releaseStewardClaim({
          steward_id: claim.steward.id,
          worker_id: workerId,
          claim_id: claim.claim_id,
        });
        console.log(chalk.dim(`Released steward claim ${claim.claim_id}`));
      } catch (releaseError) {
        console.error(chalk.yellow('Failed to release steward claim:'), (releaseError as Error).message);
      }
    }
  }
}
