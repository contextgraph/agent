/**
 * Integrated workspace management system.
 *
 * This module provides a unified interface for managing Git repository workspaces,
 * integrating:
 * - Persistent cache with LRU eviction
 * - Configurable cleanup timing (immediate, deferred, background)
 * - Workspace preservation for debugging
 * - Structured error handling with retry logic
 */

import { homedir } from 'os';
import { join } from 'path';
import { readdir, stat, rm, readFile, writeFile } from 'fs/promises';
import {
  WorkspaceManagerConfig,
  DEFAULT_WORKSPACE_MANAGER_CONFIG,
  DeepPartial,
  mergeConfig,
  validateConfig
} from './config.js';
import {
  createTempWorkspaceWithClone,
  TempWorkspace
} from './temporary-workspace.js';
import {
  getOrCreateWorkspace,
  getWorkspacePath,
  PersistentWorkspace
} from './persistent-workspace.js';
import { withRetry } from './retry.js';

/**
 * Base directory for all persistent workspaces.
 */
const WORKSPACE_BASE_DIR = join(homedir(), '.contextgraph', 'workspaces');

/**
 * Workspace strategy types.
 */
export type WorkspaceStrategy = 'temporary' | 'persistent';

/**
 * Preservation metadata stored with each workspace.
 */
export interface PreservationMetadata {
  /** Timestamp when workspace was preserved (milliseconds since epoch) */
  preservedAt: number;
  /** Reason for preservation */
  reason: string;
  /** Retention period in days (null = indefinite) */
  retentionDays: number | null;
  /** Error message if preservation was due to failure */
  error?: string;
  /** Stack trace if preservation was due to failure */
  stackTrace?: string;
  /** Operation context */
  context?: Record<string, any>;
}

/**
 * Workspace metadata for cache management.
 */
interface WorkspaceMetadata {
  path: string;
  lastAccessTime: number;
  sizeBytes: number;
  preservation?: PreservationMetadata;
}

/**
 * Result of getting a workspace through the manager.
 */
export interface WorkspaceResult {
  /** Absolute path to the workspace directory */
  path: string;
  /** Strategy used (temporary or persistent) */
  strategy: WorkspaceStrategy;
  /** Cleanup function (only for temporary workspaces) */
  cleanup?: () => Promise<void>;
  /** Whether the workspace was newly created (for persistent workspaces) */
  isNew?: boolean;
}

/**
 * Options for getting a workspace.
 */
export interface WorkspaceOptions {
  /** Repository URL to clone */
  repositoryUrl: string;
  /** Optional git environment variables (e.g., for authentication) */
  gitEnv?: NodeJS.ProcessEnv;
  /** Optional branch to checkout after cloning */
  branch?: string;
  /** Optional configuration override */
  config?: DeepPartial<WorkspaceManagerConfig>;
  /** Optional manual preservation override */
  preserve?: {
    enabled: boolean;
    reason?: string;
    retentionDays?: number | null;
  };
}

/**
 * Integrated workspace manager.
 *
 * Orchestrates all workspace management components:
 * - Cache management with LRU eviction
 * - Cleanup timing strategies
 * - Workspace preservation
 * - Error handling and retry logic
 */
export class WorkspaceManager {
  private config: WorkspaceManagerConfig;
  private backgroundCleanupInterval?: NodeJS.Timeout;
  private isRunning = false;

  constructor(config?: DeepPartial<WorkspaceManagerConfig>) {
    this.config = config
      ? mergeConfig(config)
      : DEFAULT_WORKSPACE_MANAGER_CONFIG;
    validateConfig(this.config);
  }

  /**
   * Starts the workspace manager.
   *
   * If background cleanup is enabled, starts the background cleanup job.
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    // Start background cleanup if configured
    if (this.config.cleanup.timing === 'background') {
      this.startBackgroundCleanup();
    }
  }

  /**
   * Stops the workspace manager.
   *
   * Stops background cleanup jobs if running.
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    // Stop background cleanup
    if (this.backgroundCleanupInterval) {
      clearInterval(this.backgroundCleanupInterval);
      this.backgroundCleanupInterval = undefined;
    }
  }

  /**
   * Gets a workspace for the specified repository.
   *
   * Automatically selects optimal strategy (temporary vs persistent),
   * applies configured cleanup timing, and handles preservation.
   *
   * @param options - Workspace options including repository URL
   * @returns WorkspaceResult with path, strategy, and optional cleanup
   */
  async getWorkspace(options: WorkspaceOptions): Promise<WorkspaceResult> {
    const { repositoryUrl, gitEnv, branch, config, preserve } = options;
    const effectiveConfig = config
      ? mergeConfig(config, this.config)
      : this.config;

    // Determine optimal strategy
    const strategy = await this.determineStrategy(repositoryUrl);

    if (strategy === 'temporary') {
      // Use temporary workspace pattern
      const workspace = await this.createTemporaryWorkspace({
        repositoryUrl,
        gitEnv,
        branch
      });

      return {
        path: workspace.path,
        strategy: 'temporary',
        cleanup: workspace.cleanup
      };
    } else {
      // Use persistent workspace pattern
      const workspace = await this.createPersistentWorkspace({
        repositoryUrl,
        gitEnv,
        branch
      });

      // Handle manual preservation
      if (preserve?.enabled) {
        await this.preserveWorkspace(workspace.path, {
          preservedAt: Date.now(),
          reason: preserve.reason || 'manual preservation',
          retentionDays: preserve.retentionDays ?? null
        });
      }

      // Perform cleanup based on timing strategy
      await this.performCleanup(effectiveConfig);

      return {
        path: workspace.path,
        strategy: 'persistent',
        isNew: workspace.isNew
      };
    }
  }

  /**
   * Executes an operation in a workspace with automatic management.
   *
   * Handles the complete lifecycle including cleanup and error handling.
   *
   * @param options - Workspace options
   * @param operation - Async function that receives the workspace result
   * @returns The result of the operation
   */
  async withWorkspace<T>(
    options: WorkspaceOptions,
    operation: (workspace: WorkspaceResult) => Promise<T>
  ): Promise<T> {
    const workspace = await this.getWorkspace(options);

    try {
      const result = await operation(workspace);

      // Success - no preservation needed
      return result;
    } catch (error) {
      // Handle failure - check if preservation is enabled
      if (
        workspace.strategy === 'persistent' &&
        this.config.preservation.preserveOnFailure
      ) {
        await this.preserveWorkspace(workspace.path, {
          preservedAt: Date.now(),
          reason: 'operation_failure',
          retentionDays: this.config.preservation.failureRetentionDays,
          error: error instanceof Error ? error.message : String(error),
          stackTrace: error instanceof Error ? error.stack : undefined
        });
      }

      throw error;
    } finally {
      // Cleanup only applies to temporary workspaces
      if (workspace.cleanup) {
        await workspace.cleanup();
      }
    }
  }

  /**
   * Determines the optimal workspace strategy based on repository characteristics.
   */
  private async determineStrategy(
    repositoryUrl: string
  ): Promise<WorkspaceStrategy> {
    // Check if workspace already exists
    const workspacePath = getWorkspacePath(repositoryUrl);
    try {
      await stat(workspacePath);
      // Workspace exists, use persistent strategy to leverage cache
      return 'persistent';
    } catch {
      // Workspace doesn't exist yet
      // Default to persistent to build up the cache
      // This could be made smarter by checking repo size first
      return 'persistent';
    }
  }

  /**
   * Creates a temporary workspace with retry logic.
   */
  private async createTemporaryWorkspace(options: {
    repositoryUrl: string;
    gitEnv?: NodeJS.ProcessEnv;
    branch?: string;
  }): Promise<TempWorkspace> {
    return withRetry(
      async () => {
        return await createTempWorkspaceWithClone(options);
      },
      {
        maxAttempts: this.config.errorHandling.maxRetries,
        initialDelay: this.config.errorHandling.initialRetryDelay,
        maxDelay: this.config.errorHandling.maxRetryDelay,
        onlyRecoverable: true // Retry on recoverable errors (CloneError, UpdateError)
      }
    );
  }

  /**
   * Creates a persistent workspace with retry logic.
   */
  private async createPersistentWorkspace(options: {
    repositoryUrl: string;
    gitEnv?: NodeJS.ProcessEnv;
    branch?: string;
  }): Promise<PersistentWorkspace> {
    return withRetry(
      async () => {
        return await getOrCreateWorkspace(options);
      },
      {
        maxAttempts: this.config.errorHandling.maxRetries,
        initialDelay: this.config.errorHandling.initialRetryDelay,
        maxDelay: this.config.errorHandling.maxRetryDelay,
        onlyRecoverable: true // Retry on recoverable errors (CloneError, UpdateError)
      }
    );
  }

  /**
   * Performs cleanup based on configured timing strategy.
   */
  private async performCleanup(config: WorkspaceManagerConfig): Promise<void> {
    // Check retention expiration if enabled
    if (config.preservation.checkRetentionOnAccess) {
      await this.expireRetentionPeriods();
    }

    switch (config.cleanup.timing) {
      case 'immediate':
        // Synchronous cleanup
        await this.evictOldWorkspaces(config);
        break;

      case 'deferred':
        // Async cleanup (fire-and-forget)
        this.evictOldWorkspaces(config)
          .then((evicted) => {
            if (evicted > 0 && config.preservation.logPreservationEvents) {
              console.log(`[Deferred cleanup] Evicted ${evicted} workspace(s)`);
            }
          })
          .catch((error) => {
            console.error('[Deferred cleanup] Error:', error);
          });
        break;

      case 'background':
        // Background cleanup runs independently
        break;
    }
  }

  /**
   * Starts background cleanup job.
   */
  private startBackgroundCleanup(): void {
    const interval = this.config.cleanup.backgroundInterval;

    // Run cleanup immediately on start
    this.runBackgroundCleanup();

    // Schedule periodic cleanup
    this.backgroundCleanupInterval = setInterval(() => {
      this.runBackgroundCleanup();
    }, interval);
  }

  /**
   * Runs a single background cleanup cycle.
   */
  private async runBackgroundCleanup(): Promise<void> {
    try {
      // Check retention expiration
      const expired = await this.expireRetentionPeriods();

      // Perform standard cleanup
      const evicted = await this.evictOldWorkspaces(this.config);

      if (
        (expired > 0 || evicted > 0) &&
        this.config.preservation.logPreservationEvents
      ) {
        console.log(
          `[Background cleanup] Expired ${expired}, evicted ${evicted}`
        );
      }
    } catch (error) {
      console.error('[Background cleanup] Error:', error);
    }
  }

  /**
   * Gets metadata for all persistent workspaces.
   */
  private async getWorkspaceMetadata(): Promise<WorkspaceMetadata[]> {
    try {
      const entries = await readdir(WORKSPACE_BASE_DIR);
      const metadata: WorkspaceMetadata[] = [];

      for (const entry of entries) {
        const workspacePath = join(WORKSPACE_BASE_DIR, entry);
        try {
          const stats = await stat(workspacePath);
          if (stats.isDirectory()) {
            const preservation = await this.getPreservationMetadata(
              workspacePath
            );
            metadata.push({
              path: workspacePath,
              lastAccessTime: stats.atimeMs,
              sizeBytes: stats.size,
              preservation
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
   * Evicts old persistent workspaces when the cache exceeds the maximum limit.
   */
  private async evictOldWorkspaces(
    config: WorkspaceManagerConfig
  ): Promise<number> {
    const allMetadata = await this.getWorkspaceMetadata();

    // Filter out preserved workspaces
    const eligibleForEviction = allMetadata.filter(
      (workspace) => !this.isPreserved(workspace)
    );

    // Calculate how many workspaces to evict
    const evictionCount = Math.max(
      0,
      eligibleForEviction.length - config.cache.maxWorkspaces
    );

    if (evictionCount === 0) {
      return 0;
    }

    // Evict oldest workspaces (already sorted by last access time)
    const workspacesToEvict = eligibleForEviction.slice(0, evictionCount);

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

  /**
   * Checks if a workspace is preserved.
   */
  private isPreserved(workspace: WorkspaceMetadata): boolean {
    return workspace.preservation !== undefined;
  }

  /**
   * Preserves a workspace by writing preservation metadata.
   */
  private async preserveWorkspace(
    workspacePath: string,
    metadata: PreservationMetadata
  ): Promise<void> {
    const metadataPath = join(
      workspacePath,
      this.config.preservation.metadataFileName
    );

    try {
      await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

      if (this.config.preservation.logPreservationEvents) {
        console.log(
          `[Preservation] Preserved workspace: ${workspacePath} (reason: ${metadata.reason})`
        );
      }
    } catch (error) {
      console.error(`Failed to preserve workspace ${workspacePath}:`, error);
    }
  }

  /**
   * Gets preservation metadata for a workspace.
   */
  private async getPreservationMetadata(
    workspacePath: string
  ): Promise<PreservationMetadata | undefined> {
    const metadataPath = join(
      workspacePath,
      this.config.preservation.metadataFileName
    );

    try {
      const content = await readFile(metadataPath, 'utf-8');
      return JSON.parse(content) as PreservationMetadata;
    } catch {
      // No preservation metadata or error reading it
      return undefined;
    }
  }

  /**
   * Expires retention periods for preserved workspaces.
   *
   * @returns Number of workspaces that had retention expired
   */
  private async expireRetentionPeriods(): Promise<number> {
    const allMetadata = await this.getWorkspaceMetadata();
    const now = Date.now();
    let expiredCount = 0;

    for (const workspace of allMetadata) {
      if (!workspace.preservation) {
        continue;
      }

      // Skip indefinite preservation
      if (workspace.preservation.retentionDays === null) {
        continue;
      }

      // Calculate expiration time
      const retentionMs =
        workspace.preservation.retentionDays * 24 * 60 * 60 * 1000;
      const preservedUntil = workspace.preservation.preservedAt + retentionMs;

      // Check if retention period has expired
      if (now > preservedUntil) {
        await this.removePreservationMetadata(workspace.path);
        expiredCount++;

        if (this.config.preservation.logPreservationEvents) {
          console.log(`[Preservation] Retention expired: ${workspace.path}`);
        }
      }
    }

    return expiredCount;
  }

  /**
   * Removes preservation metadata from a workspace.
   */
  private async removePreservationMetadata(
    workspacePath: string
  ): Promise<void> {
    const metadataPath = join(
      workspacePath,
      this.config.preservation.metadataFileName
    );

    try {
      await rm(metadataPath, { force: true });
    } catch {
      // Ignore errors - metadata may not exist
    }
  }

  /**
   * Gets the current configuration.
   */
  getConfig(): WorkspaceManagerConfig {
    return this.config;
  }

  /**
   * Updates the configuration.
   *
   * @param config - Partial configuration to merge with current config
   */
  updateConfig(config: DeepPartial<WorkspaceManagerConfig>): void {
    this.config = mergeConfig(config, this.config);
    validateConfig(this.config);

    // Restart background cleanup if timing strategy changed
    if (this.isRunning) {
      this.stop();
      this.start();
    }
  }
}

/**
 * Default workspace manager instance (singleton pattern).
 */
let defaultManager: WorkspaceManager | undefined;

/**
 * Gets the default workspace manager instance.
 *
 * Creates one if it doesn't exist.
 *
 * @param config - Optional configuration for the manager
 * @returns The default workspace manager instance
 */
export function getDefaultWorkspaceManager(
  config?: DeepPartial<WorkspaceManagerConfig>
): WorkspaceManager {
  if (!defaultManager) {
    defaultManager = new WorkspaceManager(config);
  }
  return defaultManager;
}

/**
 * Convenience function to get a workspace using the default manager.
 *
 * @param options - Workspace options
 * @returns WorkspaceResult with path, strategy, and optional cleanup
 */
export async function getWorkspace(
  options: WorkspaceOptions
): Promise<WorkspaceResult> {
  const manager = getDefaultWorkspaceManager(options.config);
  return manager.getWorkspace(options);
}

/**
 * Convenience function to execute an operation in a workspace using the default manager.
 *
 * @param options - Workspace options
 * @param operation - Async function that receives the workspace result
 * @returns The result of the operation
 */
export async function withWorkspace<T>(
  options: WorkspaceOptions,
  operation: (workspace: WorkspaceResult) => Promise<T>
): Promise<T> {
  const manager = getDefaultWorkspaceManager(options.config);
  return manager.withWorkspace(options, operation);
}
