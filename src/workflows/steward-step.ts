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
import { initializeStewardSession, type StewardSessionContext } from '../langfuse-session.js';
import { captureEvent, shutdownPostHog } from '../posthog-client.js';

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

function parseGitHubRepoFromUrl(url: string | null | undefined): { owner?: string; repo?: string } {
  if (!url) return {};
  const match = url.match(/github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/|$)/i);
  if (!match) return {};
  return {
    owner: match[1],
    repo: match[2],
  };
}

function parsePrContextFromUrl(url: string | null | undefined): { owner?: string; repo?: string; prNumber?: number } {
  if (!url) return {};
  const match = url.match(/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/i);
  if (!match) return {};
  const parsed = Number.parseInt(match[3], 10);
  return {
    owner: match[1],
    repo: match[2],
    prNumber: Number.isInteger(parsed) ? parsed : undefined,
  };
}

function inferPrContext(claim: StewardClaimResource): { owner?: string; repo?: string; prNumber?: number } {
  const fromClaim = claim.pr_context;
  if (fromClaim) {
    const prNumber = typeof fromClaim.prNumber === 'number' && Number.isInteger(fromClaim.prNumber)
      ? fromClaim.prNumber
      : undefined;
    const owner = fromClaim.owner || undefined;
    const repo = fromClaim.repo || undefined;
    if (owner && repo && prNumber) {
      return { owner, repo, prNumber };
    }
    const fromClaimUrl = parsePrContextFromUrl(fromClaim.url || undefined);
    if (fromClaimUrl.owner && fromClaimUrl.repo && fromClaimUrl.prNumber) {
      return fromClaimUrl;
    }
  }

  for (const candidate of claim.backlog_candidates) {
    const parsedCandidateNumber = typeof candidate.prNumber === 'number' && Number.isInteger(candidate.prNumber)
      ? candidate.prNumber
      : undefined;
    const owner = candidate.pullRequest?.owner || candidate.repositoryOwner || parseGitHubRepoFromUrl(candidate.repositoryUrl).owner;
    const repo = candidate.pullRequest?.repo || candidate.repositoryName || parseGitHubRepoFromUrl(candidate.repositoryUrl).repo;
    const prNumber = (typeof candidate.pullRequest?.number === 'number' && Number.isInteger(candidate.pullRequest.number))
      ? candidate.pullRequest.number
      : parsedCandidateNumber;
    if (owner && repo && prNumber) {
      return { owner, repo, prNumber };
    }
    const fromCandidatePrUrl = parsePrContextFromUrl(candidate.pullRequest?.url || undefined);
    if (fromCandidatePrUrl.owner && fromCandidatePrUrl.repo && fromCandidatePrUrl.prNumber) {
      return fromCandidatePrUrl;
    }
  }

  return parsePrContextFromUrl(claim.prompt);
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

    // Analyze backlog composition for repository routing insights
    const repositoriesInBacklog = new Set(
      claim.backlog_candidates
        .filter((c) => c.repositoryUrl)
        .map((c) => c.repositoryUrl)
    );
    const candidatesWithBranches = claim.backlog_candidates.filter((c) => c.proposedBranch);
    const candidatesWithPRs = claim.backlog_candidates.filter((c) => c.prNumber || c.pullRequest);
    const priorityScores = claim.backlog_candidates
      .filter((c) => typeof c.priorityScore === 'number')
      .map((c) => c.priorityScore);
    const avgPriority = priorityScores.length > 0
      ? priorityScores.reduce((sum, score) => sum + score, 0) / priorityScores.length
      : null;

    // Capture backlog discovery event - what work characteristics are presented
    captureEvent(workerId, 'steward_backlog_discovered', {
      steward_id: claim.steward.id,
      claim_id: claim.claim_id,
      worker_id: workerId,
      total_candidates: claim.backlog_candidates.length,
      unique_repositories: repositoriesInBacklog.size,
      candidates_with_branches: candidatesWithBranches.length,
      candidates_with_prs: candidatesWithPRs.length,
      avg_priority_score: avgPriority,
      has_multi_repo_backlog: repositoriesInBacklog.size > 1,
      organization_id: claim.steward.organization_id,
    });

    // Capture claim submission event - user has accepted a steward claim
    captureEvent(workerId, 'steward_claim_accepted', {
      steward_id: claim.steward.id,
      steward_name: claim.steward.name,
      claim_id: claim.claim_id,
      worker_id: workerId,
      backlog_candidate_count: claim.backlog_candidates.length,
      organization_id: claim.steward.organization_id,
      prompt_version: claim.prompt_version,
      explicitly_selected: !!options.stewardId,
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

      // Capture repository routing decision - track which repositories are prepared
      captureEvent(workerId, 'steward_repositories_prepared', {
        steward_id: claim.steward.id,
        claim_id: claim.claim_id,
        worker_id: workerId,
        repository_count: repositories.length,
        repositories: repositories.map((r) => ({
          url: r.url,
          branch: r.branch,
        })),
        has_proposed_branches: repositories.some((r) => r.branch),
      });
    } else {
      workspacePath = await mkdtemp(join(tmpdir(), 'cg-workspace-'));
      cleanupWorkspace = async () => {
        await rm(workspacePath, { recursive: true, force: true });
      };
      console.log(chalk.dim('No repository URL in backlog candidates. Using blank temp workspace.'));
      console.log(chalk.dim(`   ${workspacePath}`));
    }

    const prompt = promptPrefix ? `${promptPrefix}\n\n${claim.prompt}` : claim.prompt;
    const inferredPrContext = inferPrContext(claim);

    // Initialize Langfuse session for observability
    const sessionContext: StewardSessionContext = {
      stewardId: claim.steward.id,
      claimId: claim.claim_id,
      workerId,
      ...(inferredPrContext.owner && inferredPrContext.repo && inferredPrContext.prNumber
        ? {
          owner: inferredPrContext.owner,
          repo: inferredPrContext.repo,
          prNumber: inferredPrContext.prNumber,
        }
        : {}),
      metadata: {
        promptVersion: claim.prompt_version,
        backlogCandidatesCount: claim.backlog_candidates.length,
      },
    };

    const langfuse = initializeStewardSession(sessionContext);

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
      langfuse,
      sessionContext,
    });

    if (runResult.exitCode !== 0) {
      // Capture execution failure event
      captureEvent(workerId, 'steward_execution_failed', {
        steward_id: claim.steward.id,
        claim_id: claim.claim_id,
        worker_id: workerId,
        provider: runner.provider,
        execution_mode: executionMode,
        exit_code: runResult.exitCode,
      });
      throw new Error(`${providerName} execution failed with exit code ${runResult.exitCode}`);
    }

    // Capture successful execution completion
    captureEvent(workerId, 'steward_execution_completed', {
      steward_id: claim.steward.id,
      claim_id: claim.claim_id,
      worker_id: workerId,
      provider: runner.provider,
      execution_mode: executionMode,
      exit_code: runResult.exitCode,
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

    // Flush PostHog events before process exit
    await shutdownPostHog();
  }
}
