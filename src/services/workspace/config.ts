/**
 * Unified configuration for the integrated workspace management system.
 *
 * This module consolidates configuration from all workspace components:
 * - Persistent cache (LRU, size thresholds)
 * - Cleanup timing (immediate, deferred, background)
 * - Preservation policy (retention, triggers)
 * - Error handling (retry, validation)
 */

/**
 * Helper type for deep partial configuration.
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Cleanup timing strategies.
 */
export type CleanupTiming = 'immediate' | 'deferred' | 'background';

/**
 * Workspace preservation eviction strategies.
 */
export type PreservationEvictionStrategy = 'oldest-first' | 'largest-first';

/**
 * Policy for handling oversized workspaces.
 */
export type OversizedWorkspacePolicy = 'reject' | 'warn' | 'allow';

/**
 * Remote storage providers for workspace artifacts.
 */
export type RemoteStorageProvider = 's3' | 'gcs' | 'azure';

/**
 * Cache configuration settings.
 */
export interface CacheConfig {
  /**
   * Size threshold in bytes for deciding between temporary and persistent workspaces.
   * Repositories larger than this threshold will use persistent workspaces.
   * Default: 100MB
   */
  sizeThreshold: number;

  /**
   * Maximum number of persistent workspaces to keep in the cache.
   * When exceeded, oldest workspaces (by access time) are evicted.
   * Default: 10 workspaces
   */
  maxWorkspaces: number;
}

/**
 * Cleanup timing configuration settings.
 */
export interface CleanupConfig {
  /**
   * When to perform cleanup:
   * - 'immediate': Synchronous cleanup blocks workspace access
   * - 'deferred': Async cleanup after returning workspace
   * - 'background': Periodic cleanup independent of operations
   * Default: 'immediate'
   */
  timing: CleanupTiming;

  /**
   * Interval in milliseconds for background cleanup jobs.
   * Only used when timing is 'background'.
   * Default: 5 minutes (300000ms)
   */
  backgroundInterval: number;
}

/**
 * Preservation policy configuration settings.
 */
export interface PreservationConfig {
  /**
   * Preserve workspaces when operations fail.
   * Default: true (in dev), false (in production)
   */
  preserveOnFailure: boolean;

  /**
   * Preserve workspaces when operations timeout.
   * Default: true
   */
  preserveOnTimeout: boolean;

  /**
   * Preserve workspaces when tests fail.
   * Default: true (in dev), false (in CI)
   */
  preserveOnTestFailure: boolean;

  /**
   * Retention period for failed operations (in days).
   * Default: 7
   */
  failureRetentionDays: number;

  /**
   * Retention period for timeout failures (in days).
   * Default: 3
   */
  timeoutRetentionDays: number;

  /**
   * Retention period for test failures (in days).
   * Default: 7
   */
  testFailureRetentionDays: number;

  /**
   * Maximum retention period across all types (in days).
   * Prevents indefinite accumulation.
   * Default: 30
   */
  maxRetentionDays: number;

  /**
   * Minimum retention period (in hours).
   * Prevents immediate eviction.
   * Default: 24
   */
  minRetentionHours: number;

  /**
   * Maximum number of preserved workspaces to keep.
   * When exceeded, oldest preserved workspace is evicted.
   * Default: 5
   */
  maxPreservedWorkspaces: number;

  /**
   * Maximum total size of preserved workspaces (in bytes).
   * When exceeded, workspaces are evicted based on evictionStrategy.
   * Default: 5GB
   */
  maxPreservedTotalSize: number;

  /**
   * Maximum size for a single workspace (in bytes).
   * Controls behavior via oversizedWorkspacePolicy.
   * Default: 2GB
   */
  maxWorkspaceSize: number;

  /**
   * Policy for handling oversized workspaces.
   * Default: 'warn'
   */
  oversizedWorkspacePolicy: OversizedWorkspacePolicy;

  /**
   * Eviction strategy when preservation limits are exceeded.
   * Default: 'oldest-first'
   */
  evictionStrategy: PreservationEvictionStrategy;

  /**
   * How often to check for expired retention periods (in milliseconds).
   * Used when cleanup timing strategy is 'background'.
   * Default: 1 hour (3600000ms)
   */
  retentionCheckInterval: number;

  /**
   * Whether to check retention expiration on every workspace access.
   * Adds minimal overhead but ensures timely cleanup.
   * Default: true
   */
  checkRetentionOnAccess: boolean;

  /**
   * Store detailed metadata about preserved workspaces.
   * Includes error messages, stack traces, operation context.
   * Default: true
   */
  storeDetailedMetadata: boolean;

  /**
   * Log preservation events (workspace preserved, evicted, expired).
   * Default: true (in dev), false (in production)
   */
  logPreservationEvents: boolean;

  /**
   * Path to preservation metadata file (relative to workspace).
   * Default: '.contextgraph-preservation.json'
   */
  metadataFileName: string;
}

/**
 * Error handling configuration settings.
 */
export interface ErrorHandlingConfig {
  /**
   * Maximum number of retry attempts for transient failures.
   * Default: 3
   */
  maxRetries: number;

  /**
   * Initial delay in milliseconds for exponential backoff.
   * Default: 1000ms (1 second)
   */
  initialRetryDelay: number;

  /**
   * Maximum delay in milliseconds for exponential backoff.
   * Default: 30000ms (30 seconds)
   */
  maxRetryDelay: number;

  /**
   * Enable pre-flight checks before workspace operations.
   * Checks disk space, permissions, etc.
   * Default: true
   */
  enablePreFlightChecks: boolean;

  /**
   * Required free disk space in bytes before creating workspace.
   * Default: 1GB
   */
  requiredDiskSpace: number;

  /**
   * Enable workspace corruption detection and recovery.
   * Default: true
   */
  enableCorruptionDetection: boolean;

  /**
   * Enable structured logging with operation context.
   * Default: true (in dev), false (in production)
   */
  enableStructuredLogging: boolean;
}

/**
 * Complete workspace manager configuration.
 */
export interface WorkspaceManagerConfig {
  /** Cache configuration */
  cache: CacheConfig;

  /** Cleanup configuration */
  cleanup: CleanupConfig;

  /** Preservation configuration */
  preservation: PreservationConfig;

  /** Error handling configuration */
  errorHandling: ErrorHandlingConfig;
}

/**
 * Default cache configuration.
 */
export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  sizeThreshold: 100 * 1024 * 1024, // 100MB
  maxWorkspaces: 10
};

/**
 * Default cleanup configuration.
 */
export const DEFAULT_CLEANUP_CONFIG: CleanupConfig = {
  timing: 'immediate',
  backgroundInterval: 5 * 60 * 1000 // 5 minutes
};

/**
 * Default preservation configuration.
 */
export const DEFAULT_PRESERVATION_CONFIG: PreservationConfig = {
  preserveOnFailure: true,
  preserveOnTimeout: true,
  preserveOnTestFailure: true,
  failureRetentionDays: 7,
  timeoutRetentionDays: 3,
  testFailureRetentionDays: 7,
  maxRetentionDays: 30,
  minRetentionHours: 24,
  maxPreservedWorkspaces: 5,
  maxPreservedTotalSize: 5 * 1024 * 1024 * 1024, // 5GB
  maxWorkspaceSize: 2 * 1024 * 1024 * 1024, // 2GB
  oversizedWorkspacePolicy: 'warn',
  evictionStrategy: 'oldest-first',
  retentionCheckInterval: 60 * 60 * 1000, // 1 hour
  checkRetentionOnAccess: true,
  storeDetailedMetadata: true,
  logPreservationEvents: true,
  metadataFileName: '.contextgraph-preservation.json'
};

/**
 * Default error handling configuration.
 */
export const DEFAULT_ERROR_HANDLING_CONFIG: ErrorHandlingConfig = {
  maxRetries: 3,
  initialRetryDelay: 1000, // 1 second
  maxRetryDelay: 30000, // 30 seconds
  enablePreFlightChecks: true,
  requiredDiskSpace: 1024 * 1024 * 1024, // 1GB
  enableCorruptionDetection: true,
  enableStructuredLogging: true
};

/**
 * Default workspace manager configuration.
 */
export const DEFAULT_WORKSPACE_MANAGER_CONFIG: WorkspaceManagerConfig = {
  cache: DEFAULT_CACHE_CONFIG,
  cleanup: DEFAULT_CLEANUP_CONFIG,
  preservation: DEFAULT_PRESERVATION_CONFIG,
  errorHandling: DEFAULT_ERROR_HANDLING_CONFIG
};

/**
 * Environment-specific configuration presets.
 */
export const WORKSPACE_CONFIG_PRESETS: Record<string, DeepPartial<WorkspaceManagerConfig>> = {
  development: {
    cleanup: {
      timing: 'deferred', // Non-blocking for better dev experience
      backgroundInterval: 5 * 60 * 1000
    },
    preservation: {
      preserveOnFailure: true,
      preserveOnTimeout: true,
      preserveOnTestFailure: true,
      failureRetentionDays: 7,
      maxPreservedWorkspaces: 5,
      logPreservationEvents: true,
      storeDetailedMetadata: true
    },
    errorHandling: {
      enableStructuredLogging: true,
      enablePreFlightChecks: true,
      enableCorruptionDetection: true
    }
  },

  ci: {
    cleanup: {
      timing: 'deferred',
      backgroundInterval: 5 * 60 * 1000
    },
    preservation: {
      preserveOnFailure: true,
      preserveOnTimeout: true,
      preserveOnTestFailure: false, // Too noisy in CI
      failureRetentionDays: 1, // Short retention for CI
      maxPreservedWorkspaces: 3,
      maxPreservedTotalSize: 2 * 1024 * 1024 * 1024, // 2GB
      logPreservationEvents: false
    },
    errorHandling: {
      enableStructuredLogging: false,
      enablePreFlightChecks: true,
      maxRetries: 2 // Fewer retries in CI
    }
  },

  production: {
    cleanup: {
      timing: 'background', // Separate from request handling
      backgroundInterval: 10 * 60 * 1000 // 10 minutes
    },
    preservation: {
      preserveOnFailure: false, // Don't preserve in production
      preserveOnTimeout: false,
      preserveOnTestFailure: false,
      maxPreservedWorkspaces: 0,
      logPreservationEvents: false,
      storeDetailedMetadata: false
    },
    errorHandling: {
      enableStructuredLogging: false,
      enablePreFlightChecks: true,
      maxRetries: 3
    }
  },

  test: {
    cleanup: {
      timing: 'immediate', // Cleanup immediately in tests
      backgroundInterval: 60 * 1000
    },
    preservation: {
      preserveOnFailure: false, // Immediate cleanup in tests
      preserveOnTimeout: false,
      preserveOnTestFailure: false,
      maxPreservedWorkspaces: 0,
      logPreservationEvents: false
    },
    errorHandling: {
      enableStructuredLogging: false,
      enablePreFlightChecks: false, // Skip checks in tests for speed
      maxRetries: 1
    }
  }
};

/**
 * Merges partial configuration with defaults.
 *
 * @param partial - Partial configuration to merge
 * @param base - Base configuration (defaults to DEFAULT_WORKSPACE_MANAGER_CONFIG)
 * @returns Complete configuration with all required fields
 */
export function mergeConfig(
  partial: DeepPartial<WorkspaceManagerConfig>,
  base: WorkspaceManagerConfig = DEFAULT_WORKSPACE_MANAGER_CONFIG
): WorkspaceManagerConfig {
  return {
    cache: { ...base.cache, ...(partial.cache || {}) },
    cleanup: { ...base.cleanup, ...(partial.cleanup || {}) },
    preservation: { ...base.preservation, ...(partial.preservation || {}) },
    errorHandling: { ...base.errorHandling, ...(partial.errorHandling || {}) }
  };
}

/**
 * Gets configuration for a specific environment.
 *
 * @param environment - Environment name ('development', 'ci', 'production', 'test')
 * @param overrides - Additional overrides to apply
 * @returns Complete configuration for the environment
 */
export function getEnvironmentConfig(
  environment: 'development' | 'ci' | 'production' | 'test',
  overrides?: DeepPartial<WorkspaceManagerConfig>
): WorkspaceManagerConfig {
  const preset = WORKSPACE_CONFIG_PRESETS[environment];
  const merged = mergeConfig(preset || {});
  return overrides ? mergeConfig(overrides, merged) : merged;
}

/**
 * Validates workspace manager configuration.
 *
 * @param config - Configuration to validate
 * @throws Error if configuration is invalid
 */
export function validateConfig(config: WorkspaceManagerConfig): void {
  // Cache validation
  if (config.cache.sizeThreshold <= 0) {
    throw new Error('cache.sizeThreshold must be positive');
  }
  if (config.cache.maxWorkspaces < 0) {
    throw new Error('cache.maxWorkspaces must be non-negative');
  }

  // Cleanup validation
  if (config.cleanup.backgroundInterval <= 0) {
    throw new Error('cleanup.backgroundInterval must be positive');
  }

  // Preservation validation
  if (config.preservation.failureRetentionDays < 0) {
    throw new Error('preservation.failureRetentionDays must be non-negative');
  }
  if (config.preservation.maxPreservedWorkspaces < 0) {
    throw new Error('preservation.maxPreservedWorkspaces must be non-negative');
  }
  if (config.preservation.maxPreservedTotalSize < 0) {
    throw new Error('preservation.maxPreservedTotalSize must be non-negative');
  }
  if (config.preservation.maxWorkspaceSize <= 0) {
    throw new Error('preservation.maxWorkspaceSize must be positive');
  }

  // Error handling validation
  if (config.errorHandling.maxRetries < 0) {
    throw new Error('errorHandling.maxRetries must be non-negative');
  }
  if (config.errorHandling.initialRetryDelay <= 0) {
    throw new Error('errorHandling.initialRetryDelay must be positive');
  }
  if (config.errorHandling.maxRetryDelay <= 0) {
    throw new Error('errorHandling.maxRetryDelay must be positive');
  }
  if (config.errorHandling.requiredDiskSpace < 0) {
    throw new Error('errorHandling.requiredDiskSpace must be non-negative');
  }
}
