/**
 * Retry utilities for workspace operations.
 *
 * Implements exponential backoff retry strategy with configurable
 * attempts and delay for handling transient failures.
 */

import { isRecoverable } from './errors.js';

/**
 * Configuration for retry behavior.
 */
export interface RetryConfig {
  /**
   * Maximum number of retry attempts.
   * Default: 3
   */
  maxAttempts: number;

  /**
   * Initial delay in milliseconds before first retry.
   * Default: 1000ms (1 second)
   */
  initialDelay: number;

  /**
   * Multiplier for exponential backoff.
   * Default: 2 (doubles delay each retry)
   */
  backoffMultiplier: number;

  /**
   * Maximum delay in milliseconds.
   * Default: 10000ms (10 seconds)
   */
  maxDelay: number;

  /**
   * Whether to only retry recoverable errors.
   * Default: true
   */
  onlyRecoverable: boolean;
}

/**
 * Default retry configuration.
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelay: 1000,
  backoffMultiplier: 2,
  maxDelay: 10000,
  onlyRecoverable: true,
};

/**
 * Context passed to each retry attempt.
 */
export interface RetryContext {
  /**
   * Current attempt number (1-indexed).
   */
  attempt: number;

  /**
   * Total number of attempts that will be made.
   */
  maxAttempts: number;

  /**
   * Error from previous attempt (undefined on first attempt).
   */
  previousError?: Error;
}

/**
 * Executes an operation with automatic retry on failure.
 *
 * Uses exponential backoff strategy to handle transient failures.
 * Retries are only attempted for recoverable errors by default.
 *
 * @param operation - Async function to execute
 * @param config - Retry configuration
 * @returns Result of the operation
 * @throws Last error if all retries are exhausted
 *
 * @example
 * const result = await withRetry(
 *   async () => {
 *     return await cloneRepository(url);
 *   },
 *   { maxAttempts: 3 }
 * );
 *
 * @example
 * // With context
 * const result = await withRetry(
 *   async (ctx) => {
 *     console.log(`Attempt ${ctx.attempt} of ${ctx.maxAttempts}`);
 *     return await cloneRepository(url);
 *   }
 * );
 */
export async function withRetry<T>(
  operation: (context: RetryContext) => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | undefined;
  let delay = fullConfig.initialDelay;

  for (let attempt = 1; attempt <= fullConfig.maxAttempts; attempt++) {
    try {
      const context: RetryContext = {
        attempt,
        maxAttempts: fullConfig.maxAttempts,
        previousError: lastError,
      };

      return await operation(context);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry this error
      const shouldRetry =
        attempt < fullConfig.maxAttempts &&
        (!fullConfig.onlyRecoverable || isRecoverable(error));

      if (!shouldRetry) {
        throw lastError;
      }

      // Wait before retrying with exponential backoff
      await sleep(delay);
      delay = Math.min(delay * fullConfig.backoffMultiplier, fullConfig.maxDelay);
    }
  }

  // This shouldn't be reached, but TypeScript needs it
  throw lastError || new Error('Retry exhausted without error');
}

/**
 * Sleeps for the specified duration.
 *
 * @param ms - Milliseconds to sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Checks if an error is a transient network error that should be retried.
 *
 * @param error - Error to check
 * @returns true if error appears to be transient
 */
export function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  // Common transient error patterns
  const transientPatterns = [
    'timeout',
    'timed out',
    'econnrefused',
    'econnreset',
    'enotfound',
    'network error',
    'connection reset',
    'socket hang up',
    'temporary failure',
  ];

  return transientPatterns.some((pattern) => message.includes(pattern));
}

/**
 * Wraps an operation with retry logic and logging.
 *
 * This is a higher-level helper that adds logging to retry attempts.
 *
 * @param operationName - Name of the operation for logging
 * @param operation - Async function to execute
 * @param config - Retry configuration
 * @returns Result of the operation
 *
 * @example
 * const workspace = await retryOperation(
 *   'clone repository',
 *   async () => await cloneRepo(url),
 *   { maxAttempts: 3 }
 * );
 */
export async function retryOperation<T>(
  operationName: string,
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  return withRetry(
    async (context) => {
      if (context.attempt > 1) {
        console.log(
          `Retrying ${operationName} (attempt ${context.attempt}/${context.maxAttempts})`
        );
      }
      return await operation();
    },
    config
  );
}
