import { randomUUID } from 'crypto';
import chalk from 'chalk';
import { ApiClient } from '../api-client.js';
import type { AgentProvider } from '../runners/index.js';
import type { RunnerExecutionMode } from '../runners/types.js';
import { PRIMARY_WEB_BASE_URL } from '../platform-urls.js';
import { runStewardStep } from './steward-step.js';

export interface StewardRunOptions {
  stewardId?: string;
  workerId?: string;
  dryRun?: boolean;
  provider?: AgentProvider;
  executionMode?: RunnerExecutionMode;
  skipSkills?: boolean;
  baseUrl?: string;
  intervalSeconds?: number;
  maxSteps?: number;
  stopOnError?: boolean;
}

const DEFAULT_INTERVAL_SECONDS = 30;
const DEFAULT_BASE_URL = PRIMARY_WEB_BASE_URL;

export interface StewardRunModeInfo {
  authSource: 'env-api-token' | 'stored-credentials';
  inferredScopeMode: 'global-worker' | 'user-scoped';
  detail: string;
}

function trimEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function getStewardRunModeInfo(): StewardRunModeInfo {
  const apiToken = trimEnv('CONTEXTGRAPH_API_TOKEN');
  const globalWorkerToken = trimEnv('STEWARD_GLOBAL_WORKER_TOKEN');

  if (!apiToken) {
    return {
      authSource: 'stored-credentials',
      inferredScopeMode: 'user-scoped',
      detail: 'No CONTEXTGRAPH_API_TOKEN set; using stored credentials.',
    };
  }

  if (globalWorkerToken && apiToken === globalWorkerToken) {
    return {
      authSource: 'env-api-token',
      inferredScopeMode: 'global-worker',
      detail: 'CONTEXTGRAPH_API_TOKEN matches STEWARD_GLOBAL_WORKER_TOKEN.',
    };
  }

  if (globalWorkerToken) {
    return {
      authSource: 'env-api-token',
      inferredScopeMode: 'user-scoped',
      detail: 'CONTEXTGRAPH_API_TOKEN differs from STEWARD_GLOBAL_WORKER_TOKEN.',
    };
  }

  return {
    authSource: 'env-api-token',
    inferredScopeMode: 'user-scoped',
    detail: 'STEWARD_GLOBAL_WORKER_TOKEN is not set locally.',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitWithStopCheck(ms: number, shouldStop: () => boolean): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (shouldStop()) {
      return;
    }
    const remaining = end - Date.now();
    await sleep(Math.min(500, Math.max(remaining, 0)));
  }
}

async function selectRunReadySteward(params: {
  baseUrl?: string;
  stewardId?: string;
}): Promise<{ id: string; name: string; title: string } | null> {
  const baseUrl = (params.baseUrl || process.env.CONTEXTGRAPH_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const apiClient = new ApiClient(baseUrl);
  const top = await apiClient.topStewardQueue(params.stewardId, { mode: 'run' });
  if (!top) {
    return null;
  }
  if (!top.steward.id) {
    throw new Error('Run-ready queue response missing steward id');
  }

  return {
    id: top.steward.id,
    name: top.steward.name,
    title: top.backlog_item.title,
  };
}

export async function runStewardLoop(options: StewardRunOptions = {}): Promise<void> {
  const intervalSeconds = options.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS;
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 0) {
    throw new Error('intervalSeconds must be a non-negative number');
  }

  if (options.maxSteps !== undefined && (!Number.isInteger(options.maxSteps) || options.maxSteps <= 0)) {
    throw new Error('maxSteps must be a positive integer when provided');
  }

  const workerId = options.workerId || randomUUID();
  let shouldStop = false;
  let stepCount = 0;
  const modeInfo = getStewardRunModeInfo();

  console.log(chalk.dim(`[steward:run] Mode (inferred): ${modeInfo.inferredScopeMode}`));
  console.log(chalk.dim(`[steward:run] Auth source: ${modeInfo.authSource}`));
  console.log(chalk.dim(`[steward:run] ${modeInfo.detail}`));

  const handleSignal = (signal: NodeJS.Signals) => {
    if (shouldStop) {
      return;
    }
    shouldStop = true;
    console.log(chalk.yellow(`Received ${signal}. Stopping steward loop after current step...`));
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);

  try {
    while (!shouldStop) {
      console.log(chalk.bold('\n[steward:run] Checking the run-ready steward queue...'));

      try {
        const selected = await selectRunReadySteward({
          baseUrl: options.baseUrl,
          stewardId: options.stewardId,
        });

        if (!selected) {
          if (options.stewardId) {
            console.log(chalk.yellow(`[steward:run] No run-ready work for steward ${options.stewardId}.`));
          } else {
            console.log(chalk.yellow('[steward:run] No run-ready steward work right now.'));
          }
        } else {
          console.log(chalk.dim(`[steward:run] Selected ${selected.name}: ${selected.title}`));
          const stepResult = await runStewardStep({
            stewardId: selected.id,
            workerId,
            dryRun: options.dryRun,
            provider: options.provider,
            executionMode: options.executionMode,
            skipSkills: options.skipSkills,
            baseUrl: options.baseUrl,
          });
          if (stepResult.claimed) {
            stepCount += 1;
            console.log(chalk.bold(`[steward:run] Completed step ${stepCount}`));
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`[steward:run] Step ${stepCount + 1} failed: ${message}`));
        if (options.stopOnError) {
          break;
        }
      }

      if (shouldStop) {
        break;
      }

      if (options.maxSteps !== undefined && stepCount >= options.maxSteps) {
        console.log(chalk.dim(`[steward:run] Reached max steps (${options.maxSteps}).`));
        break;
      }

      if (intervalSeconds > 0) {
        console.log(chalk.dim(`[steward:run] Waiting ${intervalSeconds}s before next check...`));
        await waitWithStopCheck(intervalSeconds * 1000, () => shouldStop);
      }
    }
  } finally {
    process.off('SIGINT', handleSignal);
    process.off('SIGTERM', handleSignal);
  }
}
