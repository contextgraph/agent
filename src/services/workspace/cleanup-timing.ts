import { homedir } from 'os';
import { join } from 'path';
import { readdir, stat, rm } from 'fs/promises';
import { HybridWorkspaceConfig } from './hybrid-workspace.js';

/**
 * Base directory for all persistent workspaces.
 */
const WORKSPACE_BASE_DIR = join(homedir(), '.contextgraph', 'workspaces');

/**
 * Cleanup timing strategies.
 */
export type CleanupTiming = 'immediate' | 'deferred' | 'background';

/**
 * Configuration for cleanup timing behavior.
 */
export interface CleanupTimingConfig extends HybridWorkspaceConfig {
  /**
   * When to perform cleanup:
   * - 'immediate': Synchronous cleanup blocks workspace access
   * - 'deferred': Async cleanup after returning workspace
   * - 'background': Periodic cleanup independent of operations
   */
  timing: CleanupTiming;

  /**
   * Whether to preserve workspaces on operation failure.
   * Useful for debugging failed operations.
   */
  preserveOnFailure: boolean;

  /**
   * Interval in milliseconds for background cleanup jobs.
   * Only used when timing is 'background'.
   * Default: 5 minutes (300000ms)
   */
  backgroundInterval?: number;
}

/**
 * Default cleanup timing configuration.
 */
export const DEFAULT_CLEANUP_CONFIG: CleanupTimingConfig = {
  sizeThreshold: 100 * 1024 * 1024, // 100MB
  maxWorkspaces: 10,
  timing: 'immediate',
  preserveOnFailure: false,
  backgroundInterval: 5 * 60 * 1000 // 5 minutes
};

/**
 * Metadata about a workspace for cache management.
 */
interface WorkspaceMetadata {
  path: string;
  lastAccessTime: number;
  sizeBytes: number;
}

/**
 * Gets metadata for all persistent workspaces.
 *
 * @returns Array of workspace metadata sorted by last access time (oldest first)
 */
async function getWorkspaceMetadata(): Promise<WorkspaceMetadata[]> {
  try {
    const entries = await readdir(WORKSPACE_BASE_DIR);
    const metadata: WorkspaceMetadata[] = [];

    for (const entry of entries) {
      const workspacePath = join(WORKSPACE_BASE_DIR, entry);
      try {
        const stats = await stat(workspacePath);
        if (stats.isDirectory()) {
          metadata.push({
            path: workspacePath,
            lastAccessTime: stats.atimeMs,
            sizeBytes: stats.size
          });
        }
      } catch {
        // Skip entries that can't be accessed
        continue;
      }
    }

    // Sort by last access time (oldest first)
    return metadata.sort((a, b) => a.lastAccessTime - b.lastAccessTime);
  } catch {
    // If workspace directory doesn't exist yet, return empty array
    return [];
  }
}

/**
 * Core cleanup logic shared by all timing strategies.
 *
 * @param config - Configuration including maxWorkspaces limit
 * @returns Number of workspaces evicted
 */
async function performCleanup(
  config: CleanupTimingConfig
): Promise<number> {
  const metadata = await getWorkspaceMetadata();

  // Calculate how many workspaces to evict
  const evictionCount = Math.max(0, metadata.length - config.maxWorkspaces);

  if (evictionCount === 0) {
    return 0;
  }

  // Evict oldest workspaces (already sorted by last access time)
  const workspacesToEvict = metadata.slice(0, evictionCount);

  let evictedCount = 0;
  for (const workspace of workspacesToEvict) {
    try {
      await rm(workspace.path, { recursive: true, force: true });
      evictedCount++;
    } catch (error) {
      console.warn(`Failed to evict workspace ${workspace.path}:`, error);
    }
  }

  return evictedCount;
}

// ============================================================================
// Timing Strategy 1: Immediate Cleanup
// ============================================================================

/**
 * Immediate cleanup: Synchronous eviction during workspace access.
 *
 * This is the current implementation's approach (hybrid-workspace.ts:327-353).
 *
 * **Advantages:**
 * - Simple and predictable behavior
 * - Immediate cache consistency
 * - No additional lifecycle management needed
 *
 * **Disadvantages:**
 * - Blocks workspace access during cleanup
 * - Can add latency to workspace operations
 * - Cleanup cost paid by the requesting operation
 *
 * @param config - Cleanup configuration
 * @returns Number of workspaces evicted
 */
export async function immediateCleanup(
  config: CleanupTimingConfig = DEFAULT_CLEANUP_CONFIG
): Promise<number> {
  // Directly perform cleanup, blocking until complete
  return await performCleanup(config);
}

// ============================================================================
// Timing Strategy 2: Deferred Cleanup
// ============================================================================

/**
 * Deferred cleanup: Async eviction after returning workspace to caller.
 *
 * Returns workspace immediately, then performs cleanup asynchronously.
 *
 * **Advantages:**
 * - Doesn't block workspace access
 * - Zero latency impact on caller
 * - Still maintains reasonable cache consistency
 *
 * **Disadvantages:**
 * - Cleanup errors happen in background (harder to track)
 * - Cache limit can temporarily exceed maxWorkspaces
 * - Race conditions if multiple operations trigger cleanup
 *
 * @param config - Cleanup configuration
 * @returns Promise that resolves when cleanup completes
 */
export async function deferredCleanup(
  config: CleanupTimingConfig = DEFAULT_CLEANUP_CONFIG
): Promise<void> {
  // Fire-and-forget: don't await cleanup
  performCleanup(config)
    .then(evictedCount => {
      if (evictedCount > 0) {
        console.log(`[Deferred cleanup] Evicted ${evictedCount} workspace(s)`);
      }
    })
    .catch(error => {
      console.error('[Deferred cleanup] Error during cleanup:', error);
    });

  // Return immediately without waiting for cleanup
}

// ============================================================================
// Timing Strategy 3: Background Job
// ============================================================================

/**
 * Background cleanup job manager.
 *
 * Manages a periodic cleanup interval that runs independent of workspace operations.
 *
 * **Advantages:**
 * - Zero impact on workspace operations
 * - Predictable cleanup schedule
 * - Centralized cleanup management
 *
 * **Disadvantages:**
 * - Requires lifecycle management (start/stop)
 * - Cache can grow between cleanup intervals
 * - May clean up during active operations
 * - Adds complexity to application lifecycle
 */
export class BackgroundCleanupManager {
  private intervalId?: NodeJS.Timeout;
  private config: CleanupTimingConfig;
  private isRunning = false;

  constructor(config: CleanupTimingConfig = DEFAULT_CLEANUP_CONFIG) {
    this.config = config;
  }

  /**
   * Starts the background cleanup job.
   *
   * @throws Error if already running
   */
  start(): void {
    if (this.isRunning) {
      throw new Error('Background cleanup is already running');
    }

    this.isRunning = true;
    const interval = this.config.backgroundInterval || 5 * 60 * 1000;

    // Run cleanup immediately on start
    this.runCleanup();

    // Schedule periodic cleanup
    this.intervalId = setInterval(() => {
      this.runCleanup();
    }, interval);

    console.log(`[Background cleanup] Started with ${interval}ms interval`);
  }

  /**
   * Stops the background cleanup job.
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    this.isRunning = false;
    console.log('[Background cleanup] Stopped');
  }

  /**
   * Runs a single cleanup cycle.
   */
  private async runCleanup(): Promise<void> {
    try {
      const evictedCount = await performCleanup(this.config);
      if (evictedCount > 0) {
        console.log(`[Background cleanup] Evicted ${evictedCount} workspace(s)`);
      }
    } catch (error) {
      console.error('[Background cleanup] Error during cleanup:', error);
    }
  }

  /**
   * Gets the current running state.
   */
  isActive(): boolean {
    return this.isRunning;
  }
}

// ============================================================================
// Conditional Preservation
// ============================================================================

/**
 * Context for tracking operation success/failure.
 */
export interface OperationContext {
  /** Repository URL being operated on */
  repositoryUrl: string;
  /** Whether the operation succeeded */
  succeeded: boolean;
  /** Optional error that occurred */
  error?: Error;
}

/**
 * Determines if a workspace should be preserved based on operation outcome.
 *
 * When preserveOnFailure is enabled, workspaces are protected from eviction
 * if their last operation failed. This helps preserve state for debugging.
 *
 * @param config - Cleanup configuration
 * @param context - Operation context
 * @returns true if workspace should be preserved
 */
export function shouldPreserveWorkspace(
  config: CleanupTimingConfig,
  context: OperationContext
): boolean {
  // If preservation is disabled, never preserve
  if (!config.preserveOnFailure) {
    return false;
  }

  // Preserve if operation failed
  return !context.succeeded;
}

// ============================================================================
// Example Usage
// ============================================================================

/**
 * Example 1: Immediate cleanup (current approach)
 */
export async function example1_ImmediateCleanup() {
  console.log('=== Immediate Cleanup ===');
  const start = Date.now();

  const evicted = await immediateCleanup();

  const duration = Date.now() - start;
  console.log(`Evicted ${evicted} workspace(s) in ${duration}ms`);
  console.log('Workspace access was blocked during cleanup');
}

/**
 * Example 2: Deferred cleanup (non-blocking)
 */
export async function example2_DeferredCleanup() {
  console.log('=== Deferred Cleanup ===');
  const start = Date.now();

  await deferredCleanup();

  const duration = Date.now() - start;
  console.log(`Returned workspace in ${duration}ms`);
  console.log('Cleanup happening in background...');
}

/**
 * Example 3: Background cleanup job
 */
export async function example3_BackgroundCleanup() {
  console.log('=== Background Cleanup ===');

  const manager = new BackgroundCleanupManager({
    ...DEFAULT_CLEANUP_CONFIG,
    backgroundInterval: 60000 // 1 minute for demo
  });

  // Start background job
  manager.start();
  console.log('Background cleanup started, runs every 60 seconds');

  // Simulate running for a while
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Stop when done
  manager.stop();
  console.log('Background cleanup stopped');
}

/**
 * Example 4: Conditional preservation
 */
export async function example4_ConditionalPreservation() {
  console.log('=== Conditional Preservation ===');

  const config: CleanupTimingConfig = {
    ...DEFAULT_CLEANUP_CONFIG,
    preserveOnFailure: true
  };

  // Successful operation - workspace can be evicted
  const successContext: OperationContext = {
    repositoryUrl: 'https://github.com/user/repo.git',
    succeeded: true
  };
  console.log('Success case:', shouldPreserveWorkspace(config, successContext));
  // Output: false - can be evicted

  // Failed operation - workspace should be preserved
  const failureContext: OperationContext = {
    repositoryUrl: 'https://github.com/user/repo.git',
    succeeded: false,
    error: new Error('Operation failed')
  };
  console.log('Failure case:', shouldPreserveWorkspace(config, failureContext));
  // Output: true - preserve for debugging
}

/**
 * Example 5: Comparing timing strategies performance
 */
export async function example5_CompareTimings() {
  console.log('=== Comparing Timing Strategies ===\n');

  // Immediate cleanup
  console.log('1. Immediate cleanup:');
  const start1 = Date.now();
  await immediateCleanup();
  console.log(`   Duration: ${Date.now() - start1}ms (blocks caller)\n`);

  // Deferred cleanup
  console.log('2. Deferred cleanup:');
  const start2 = Date.now();
  await deferredCleanup();
  console.log(`   Duration: ${Date.now() - start2}ms (non-blocking)\n`);

  // Background cleanup
  console.log('3. Background cleanup:');
  console.log('   Duration: 0ms (independent of operations)');
  console.log('   Runs periodically on schedule');
}
