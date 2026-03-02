/**
 * Langfuse Session Management for Steward Agent Execution
 *
 * Provides session initialization utilities for organizing Langfuse traces
 * around steward execution contexts. This enables PR-scoped observability
 * for all LLM interactions within the agent package.
 */

import { Langfuse } from 'langfuse';

export type StewardSessionContext = {
  /** Steward action ID coordinating this execution */
  stewardId: string;
  /** Unique claim ID for this execution step */
  claimId: string;
  /** Worker ID executing this claim */
  workerId?: string;
  /** PR number if this execution is tied to a specific pull request */
  prNumber?: number;
  /** Repository owner (e.g., 'contextgraph') */
  owner?: string;
  /** Repository name (e.g., 'actions') */
  repo?: string;
  /** Additional metadata for the session */
  metadata?: Record<string, unknown>;
};

/**
 * Generate a session ID for Langfuse that groups all traces within a steward
 * execution step. The session ID format ensures:
 * - All agent interactions within one claim are grouped together
 * - Sessions can be filtered by steward ID
 * - PR-specific sessions are easily identifiable
 *
 * Format: steward:{stewardId}:claim:{claimId}
 * PR-specific format: steward:{stewardId}:pr:{owner}/{repo}/pulls/{prNumber}
 */
export function buildStewardSessionId(context: StewardSessionContext): string {
  // If we have PR context, use PR-scoped session ID for better observability
  if (context.prNumber && context.owner && context.repo) {
    return `steward:${context.stewardId}:pr:${context.owner}/${context.repo}/pulls/${context.prNumber}`;
  }

  // Otherwise, use claim-scoped session ID
  return `steward:${context.stewardId}:claim:${context.claimId}`;
}

/**
 * Create session metadata for Langfuse traces.
 * This metadata enriches traces with steward and PR context for
 * session-level observability and filtering.
 */
export function buildStewardSessionMetadata(context: StewardSessionContext): Record<string, unknown> {
  return {
    stewardId: context.stewardId,
    claimId: context.claimId,
    ...(context.workerId ? { workerId: context.workerId } : {}),
    ...(context.prNumber ? { prNumber: context.prNumber } : {}),
    ...(context.owner ? { repositoryOwner: context.owner } : {}),
    ...(context.repo ? { repositoryName: context.repo } : {}),
    ...(context.owner && context.repo
      ? { repositoryUrl: `https://github.com/${context.owner}/${context.repo}` }
      : {}),
    executionType: 'steward-loop-v2',
    ...(context.metadata ?? {}),
  };
}

/**
 * Initialize a Langfuse client with steward session context.
 * This is the primary integration point for instrumenting steward execution.
 *
 * The agent should call this at the start of each execution step
 * to establish session context for all subsequent LLM calls.
 *
 * @param context Steward and PR context for this execution
 * @returns Configured Langfuse client with session context, or null if Langfuse is not configured
 *
 * @example
 * ```typescript
 * import { initializeStewardSession } from './langfuse-session.js';
 *
 * const langfuse = initializeStewardSession({
 *   stewardId: 'abc-123',
 *   claimId: 'xyz-789',
 *   workerId: 'worker-456',
 * });
 *
 * if (langfuse) {
 *   const trace = langfuse.trace({
 *     name: 'steward-decision',
 *     metadata: { step: 'analyze-backlog' },
 *   });
 * }
 * ```
 */
export function initializeStewardSession(context: StewardSessionContext): Langfuse | null {
  const hasLangfuseConfig = !!(
    process.env.LANGFUSE_SECRET_KEY &&
    process.env.LANGFUSE_PUBLIC_KEY
  );

  if (!hasLangfuseConfig) {
    console.log('[LangfuseSession] Langfuse not configured - skipping session initialization');
    return null;
  }

  try {
    const sessionId = buildStewardSessionId(context);
    const metadata = buildStewardSessionMetadata(context);

    // Create Langfuse client with session context
    const langfuse = new Langfuse({
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      baseUrl: process.env.LANGFUSE_BASEURL,
      release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? undefined,
    });

    console.log(`[LangfuseSession] Initialized session: ${sessionId}`, {
      ...metadata,
    });

    return langfuse;
  } catch (error) {
    console.warn(
      '[LangfuseSession] Failed to initialize Langfuse session:',
      error instanceof Error ? error.message : error
    );
    return null;
  }
}
