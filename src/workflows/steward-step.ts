import { randomUUID } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import chalk from 'chalk';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { ApiClient, type StewardClaimResource } from '../api-client.js';
import { prepareMultiRepoWorkspace } from '../workspace-prep.js';
import { createAgentRunner } from '../runners/index.js';
import type { AgentProvider } from '../runners/index.js';
import type { RunnerExecutionMode } from '../runners/types.js';
import { assertRunnerCapabilities, resolveExecutionMode } from './execution-policy.js';
import { captureEvent } from '../posthog.js';

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

export interface StewardStepResult {
  claimed: boolean;
}

export async function runStewardStep(options: StewardStepOptions = {}): Promise<StewardStepResult> {
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
      return { claimed: false };
    }

    console.log(chalk.bold(`Steward:`), chalk.cyan(`${claim.steward.name} (${claim.steward.id})`));
    if (claim.prompt_version) {
      console.log(chalk.dim(`Prompt version: ${claim.prompt_version}`));
    }
    console.log(chalk.dim(`Backlog candidates: ${claim.backlog_candidates.length}`));

    // Track work acquisition
    await captureEvent(workerId, 'steward_work_acquired', {
      steward_id: claim.steward.id,
      steward_name: claim.steward.name,
      backlog_count: claim.backlog_candidates.length,
      prompt_version: claim.prompt_version,
      claim_id: claim.claim_id,
    });

    if (options.dryRun) {
      console.log(chalk.dim('Dry run complete. Agent execution skipped.'));
      return { claimed: true };
    }

    const repoCandidates = claim.backlog_candidates.filter((candidate) => candidate.repositoryUrl?.length > 0);
    const repositories = Array.from(
      repoCandidates.reduce((acc, candidate) => {
        const key = candidate.repositoryUrl!;
        const existing = acc.get(key);
        if (!existing) {
          acc.set(key, { url: key, branch: candidate.proposedBranch ?? undefined });
        } else if (!existing.branch && candidate.proposedBranch) {
          // Prefer the first non-empty proposed branch for this repository.
          existing.branch = candidate.proposedBranch;
        }
        return acc;
      }, new Map<string, { url: string; branch?: string }>())
        .values()
    );

    let workspacePath: string;
    let promptPrefix = '';

    if (repositories.length > 0) {
      const workspace = await prepareMultiRepoWorkspace(repositories, {
        authToken: credentials.clerkToken,
        skipSkills: options.skipSkills,
      });

      workspacePath = workspace.rootPath;
      cleanupWorkspace = workspace.cleanup;

      const repoLines = workspace.repos
        .map((repo) => `- ${repo.url} -> \`${repo.name}\`${repo.branch ? ` (branch \`${repo.branch}\`)` : ''}`)
        .join('\n');

      promptPrefix = `## Workspace Repositories
The workspace root contains one directory per backlog repository. Use the repository that matches your selected backlog item.

${repoLines}

When your selected item includes a proposed branch, you MUST use that exact branch for git operations in that repository.`;
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

    const startTime = Date.now();
    const runResult = await runner.execute({
      prompt,
      cwd: workspacePath,
      authToken: credentials.clerkToken,
      executionActionId: claim.steward.id,
      executionMode,
    });
    const duration = Date.now() - startTime;

    if (runResult.exitCode !== 0) {
      // Track task failure
      await captureEvent(workerId, 'steward_task_completed', {
        steward_id: claim.steward.id,
        steward_name: claim.steward.name,
        claim_id: claim.claim_id,
        outcome: 'failed',
        exit_code: runResult.exitCode,
        duration_ms: duration,
        provider: runner.provider,
        execution_mode: executionMode,
      });
      throw new Error(`${providerName} execution failed with exit code ${runResult.exitCode}`);
    }

    // Track task success
    await captureEvent(workerId, 'steward_task_completed', {
      steward_id: claim.steward.id,
      steward_name: claim.steward.name,
      claim_id: claim.claim_id,
      outcome: 'success',
      duration_ms: duration,
      provider: runner.provider,
      execution_mode: executionMode,
    });

    console.log('\n' + chalk.green('Steward step complete'));
    return { claimed: true };
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
