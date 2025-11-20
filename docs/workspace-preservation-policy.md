# Workspace Preservation Policy

## Overview

This document defines policies for when and how long to preserve workspaces for debugging and inspection purposes. The preservation policy balances developer debugging needs with disk space constraints, providing configurable retention strategies that work seamlessly with the hybrid workspace cleanup timing system.

## Use Cases

### 1. Failed Operations

**Scenario:** An agent operation fails (test failure, build error, execution exception)

**Need:** Preserve workspace state for post-mortem debugging

**Duration:** Extended retention (default: 7 days) to allow for investigation

**Example:**
- Agent runs tests in a repository, tests fail
- Workspace preserved with test artifacts, logs, and state
- Developer can inspect workspace to understand failure cause
- Workspace automatically cleaned up after retention period

### 2. Long-Running Tasks

**Scenario:** Operation takes significant time (large repo analysis, multi-step build)

**Need:** Preserve workspace during execution to allow inspection of intermediate state

**Duration:** Active retention until operation completes or fails

**Example:**
- Large monorepo analysis running for 30+ minutes
- Developer wants to check intermediate results
- Workspace remains accessible during operation
- Standard cleanup policies apply after completion

### 3. Debugging Sessions

**Scenario:** Developer actively investigating an issue or developing a feature

**Need:** Manual preservation override to prevent automatic cleanup during investigation

**Duration:** Manual retention until explicitly released by developer

**Example:**
- Developer adds `preserve: true` flag to operation
- Workspace persists indefinitely until manual cleanup
- Developer can make changes, rerun operations, inspect state
- Manual cleanup command releases workspace for LRU eviction

### 4. Test and CI Environments

**Scenario:** Automated testing or CI pipeline execution

**Need:** Conditional preservation (failed runs only) or immediate cleanup (all runs)

**Duration:** Configurable per environment (CI: 24h, test: immediate)

**Example:**
- CI environment preserves only failed builds (default: 24h)
- Local test runs use immediate cleanup (default behavior)
- Configuration per environment supports different workflows

## Preservation Triggers

### Automatic Triggers

#### 1. Operation Failure Trigger

**Activation:** Any operation that throws an uncaught exception or returns error status

**Configuration:**
```typescript
interface PreservationConfig {
  preserveOnFailure: boolean; // Default: true
  failureRetentionDays: number; // Default: 7
}
```

**Implementation:**
```typescript
try {
  const result = await runOperation(workspace.path);
  // Success - standard cleanup applies
  return result;
} catch (error) {
  // Failure - mark workspace for preservation
  await markWorkspaceForPreservation(workspace.path, {
    reason: 'operation_failure',
    error: error.message,
    timestamp: Date.now(),
    retentionDays: config.failureRetentionDays
  });
  throw error;
}
```

**Behavior:**
- Workspace tagged with preservation metadata
- Excluded from LRU eviction during retention period
- Automatically becomes eligible for cleanup after retention period expires
- Can be manually cleaned before retention period ends

#### 2. Timeout Trigger

**Activation:** Operation exceeds configured timeout threshold

**Configuration:**
```typescript
interface PreservationConfig {
  preserveOnTimeout: boolean; // Default: true
  timeoutThreshold: number; // Milliseconds, default: 600000 (10 minutes)
  timeoutRetentionDays: number; // Default: 3
}
```

**Use Case:** Detect hung operations or investigate performance issues

**Behavior:**
- Similar to failure trigger but with different retention period
- Includes timeout duration in preservation metadata
- Helps diagnose slow operations or infinite loops

#### 3. Test Failure Trigger

**Activation:** Test suite execution exits with non-zero status

**Configuration:**
```typescript
interface PreservationConfig {
  preserveOnTestFailure: boolean; // Default: true (in dev), false (in CI)
  testFailureRetentionDays: number; // Default: 7
}
```

**Use Case:** Preserve test artifacts, coverage reports, and logs

**Behavior:**
- Detects test runner exit codes
- Preserves test output files and artifacts
- Tagged with test framework metadata

### Manual Triggers

#### 1. Explicit Preservation Flag

**Usage:** Pass preservation flag in operation options

```typescript
const workspace = await getWorkspace({
  repositoryUrl: 'https://github.com/user/repo.git',
  preserve: {
    enabled: true,
    reason: 'debugging feature implementation',
    retentionDays: null // Preserve indefinitely until manual cleanup
  }
});
```

**Behavior:**
- Workspace excluded from automatic cleanup
- Requires manual cleanup command to release
- Appears in "preserved workspaces" list

#### 2. Post-Operation Preservation

**Usage:** Preserve workspace after operation completes

```typescript
const result = await withHybridWorkspace(
  { repositoryUrl: 'https://github.com/user/repo.git' },
  async (workspace) => {
    const result = await analyze(workspace.path);

    // Interesting finding - preserve for inspection
    if (result.requiresInvestigation) {
      await preserveWorkspace(workspace.path, {
        reason: 'investigation required',
        metadata: result.findings,
        retentionDays: 7
      });
    }

    return result;
  }
);
```

**Behavior:**
- Conditional preservation based on operation results
- Programmatic control over preservation decisions
- Flexible metadata attachment

#### 3. Manual Preservation Command

**Usage:** CLI command to preserve existing workspace

```bash
# Preserve specific workspace
npx contextgraph workspace preserve <repo-url> --reason "debugging" --days 7

# Preserve by directory hash
npx contextgraph workspace preserve --hash abc123def --days 7

# Preserve indefinitely
npx contextgraph workspace preserve <repo-url> --indefinite
```

**Behavior:**
- Adds preservation metadata to existing workspace
- Prevents eviction by LRU policy
- Lists preserved workspaces with metadata

## Retention Policies

### Time-Based Retention

#### Default Retention Periods

| Trigger Type | Default Retention | Rationale |
|--------------|------------------|-----------|
| Operation Failure | 7 days | Sufficient time for developer investigation |
| Timeout | 3 days | Lower priority than explicit failures |
| Test Failure | 7 days | Align with failure retention |
| Manual Preservation | Indefinite | Developer-controlled |
| Success (no preservation) | Immediate eviction | Standard LRU cleanup |

#### Configurable Retention

```typescript
interface RetentionPolicy {
  // Default retention for different trigger types
  failureRetentionDays: number; // Default: 7
  timeoutRetentionDays: number; // Default: 3
  testFailureRetentionDays: number; // Default: 7

  // Maximum retention across all types
  maxRetentionDays: number; // Default: 30

  // Minimum retention (prevents immediate eviction)
  minRetentionHours: number; // Default: 24
}
```

**Enforcement:**
- Retention periods enforce minimum preservation time
- After retention period expires, workspace becomes eligible for LRU eviction
- Maximum retention prevents indefinite accumulation
- Minimum retention ensures workspaces aren't evicted too quickly

#### Retention Expiration

**Process:**
1. Background cleanup job checks preservation metadata
2. Workspaces past retention period lose preservation status
3. Workspaces re-enter LRU pool for normal eviction
4. Cleanup follows standard timing strategies (deferred, background)

**Implementation:**
```typescript
async function expireRetentionPeriods(): Promise<number> {
  const workspaces = await getPreservedWorkspaces();
  const now = Date.now();
  let expiredCount = 0;

  for (const workspace of workspaces) {
    const preservedUntil = workspace.preservedAt +
      (workspace.retentionDays * 24 * 60 * 60 * 1000);

    if (now > preservedUntil) {
      await removePreservationMetadata(workspace.path);
      expiredCount++;
    }
  }

  return expiredCount;
}
```

### Event-Based Retention

#### Preservation on Specific Events

**Events:**
1. **Operation Success:** Standard cleanup applies (no preservation)
2. **Operation Failure:** Automatic preservation triggered
3. **Manual Deletion:** Workspace removed regardless of preservation status
4. **Cache Limit Exceeded:** Preserved workspaces exempt from eviction
5. **Manual Release:** Developer removes preservation, workspace enters LRU pool

#### Event Priorities

| Event | Priority | Behavior |
|-------|----------|----------|
| Manual Deletion | Highest | Bypasses all preservation |
| Active Preservation | High | Excluded from automatic eviction |
| Retention Period Active | Medium | Temporarily excluded from eviction |
| Standard LRU | Normal | Standard cleanup applies |
| Expired Retention | Normal | Re-enters LRU pool |

### Size-Based Limits

#### Total Preserved Workspace Limit

**Problem:** Preserved workspaces can accumulate and consume excessive disk space

**Solution:** Configure maximum total size for preserved workspaces

```typescript
interface PreservationConfig {
  maxPreservedWorkspaces: number; // Default: 5
  maxPreservedTotalSize: number; // Bytes, default: 5GB
  evictionStrategy: 'oldest-first' | 'largest-first'; // Default: 'oldest-first'
}
```

**Enforcement:**
1. When preservation triggered, check total preserved workspace count/size
2. If limits exceeded, evict oldest (or largest) preserved workspace
3. New preserved workspace takes its place
4. Manual preservation can override limits with warning

**Implementation:**
```typescript
async function enforcePreservationLimits(
  config: PreservationConfig
): Promise<void> {
  const preserved = await getPreservedWorkspaces();

  // Check count limit
  while (preserved.length >= config.maxPreservedWorkspaces) {
    const toEvict = config.evictionStrategy === 'largest-first'
      ? preserved.sort((a, b) => b.size - a.size)[0]
      : preserved.sort((a, b) => a.preservedAt - b.preservedAt)[0];

    await rm(toEvict.path, { recursive: true, force: true });
    preserved.splice(preserved.indexOf(toEvict), 1);
  }

  // Check size limit
  const totalSize = preserved.reduce((sum, w) => sum + w.size, 0);
  while (totalSize > config.maxPreservedTotalSize) {
    // Similar eviction logic
  }
}
```

#### Per-Workspace Size Limit

**Configuration:**
```typescript
interface PreservationConfig {
  maxWorkspaceSize: number; // Bytes, default: 2GB
  oversizedWorkspacePolicy: 'reject' | 'warn' | 'allow'; // Default: 'warn'
}
```

**Behavior:**
- **reject:** Don't preserve workspaces exceeding size limit
- **warn:** Preserve but log warning about disk usage
- **allow:** Preserve regardless of size (not recommended)

## Developer Debugging Workflows

### Workflow 1: Investigating Failed Operation

**Scenario:** Agent operation fails, developer needs to inspect workspace

**Steps:**

1. **Automatic Preservation**
   ```typescript
   // Agent operation fails automatically
   // Workspace preserved with metadata:
   // - Error message
   // - Stack trace
   // - Timestamp
   // - Retention period (7 days)
   ```

2. **List Preserved Workspaces**
   ```bash
   npx contextgraph workspace list --preserved

   # Output:
   # Preserved Workspaces:
   # 1. github.com/user/repo (hash: abc123)
   #    Preserved: 2 hours ago
   #    Reason: operation_failure
   #    Expires: in 7 days
   #    Path: ~/.contextgraph/workspaces/abc123
   #    Size: 150 MB
   ```

3. **Inspect Workspace**
   ```bash
   # Navigate to workspace
   cd ~/.contextgraph/workspaces/abc123

   # Or use helper command
   npx contextgraph workspace cd github.com/user/repo

   # Inspect files, logs, artifacts
   ls -la
   cat operation.log
   git status
   ```

4. **Run Commands in Workspace**
   ```bash
   # Reproduce issue
   npx contextgraph workspace exec github.com/user/repo -- npm test

   # Debug interactively
   npx contextgraph workspace shell github.com/user/repo
   ```

5. **Clean Up (Optional)**
   ```bash
   # Manual cleanup before retention expires
   npx contextgraph workspace clean github.com/user/repo

   # Or clean all expired workspaces
   npx contextgraph workspace clean --expired
   ```

### Workflow 2: Debugging During Development

**Scenario:** Developer implementing feature, needs persistent workspace

**Steps:**

1. **Start with Manual Preservation**
   ```typescript
   const workspace = await getWorkspace({
     repositoryUrl: 'https://github.com/user/repo.git',
     preserve: {
       enabled: true,
       reason: 'feature development',
       retentionDays: null // Indefinite
     }
   });
   ```

2. **Make Changes in Workspace**
   ```bash
   cd ~/.contextgraph/workspaces/abc123
   # Edit files, run tests, iterate
   ```

3. **Run Operations with Same Workspace**
   ```typescript
   // Subsequent operations use same preserved workspace
   const result = await withHybridWorkspace(
     { repositoryUrl: 'https://github.com/user/repo.git' },
     async (workspace) => {
       // Same workspace path as before
       return await test(workspace.path);
     }
   );
   ```

4. **Release When Done**
   ```bash
   npx contextgraph workspace release github.com/user/repo
   ```

### Workflow 3: CI/CD Failure Investigation

**Scenario:** CI pipeline fails, need to inspect state in CI environment

**Steps:**

1. **CI Environment Configuration**
   ```typescript
   // In CI environment
   const config: PreservationConfig = {
     preserveOnFailure: true,
     preserveOnSuccess: false,
     failureRetentionDays: 1, // Short retention for CI
     uploadToStorage: true // Upload to S3/GCS for remote inspection
   };
   ```

2. **Automatic Artifact Upload**
   ```typescript
   // On failure, upload workspace contents
   if (operationFailed) {
     await uploadWorkspaceArtifacts(workspace.path, {
       destination: 's3://ci-artifacts/builds/${BUILD_ID}/',
       includeGitDir: false, // Exclude .git to reduce size
       compress: true
     });
   }
   ```

3. **Remote Inspection**
   ```bash
   # Download artifacts locally
   npx contextgraph workspace download --build-id 12345

   # Or inspect via CI interface
   # (CI system displays artifact links)
   ```

4. **Automatic Cleanup**
   - CI retains for 24h (configurable)
   - Automatic cleanup after retention period
   - S3 lifecycle policies handle remote cleanup

### Workflow 4: Bulk Workspace Management

**Scenario:** Developer wants to audit or clean up multiple workspaces

**Commands:**

```bash
# List all workspaces (preserved and cached)
npx contextgraph workspace list --all

# Show detailed info
npx contextgraph workspace info github.com/user/repo

# Clean up specific workspace
npx contextgraph workspace clean github.com/user/repo

# Clean up all expired preserved workspaces
npx contextgraph workspace clean --expired

# Clean up all workspaces (force)
npx contextgraph workspace clean --all --force

# Show disk usage
npx contextgraph workspace stats
# Output:
# Total workspaces: 12
# Preserved: 3 (450 MB)
# Cached: 9 (1.2 GB)
# Total size: 1.65 GB
```

## Configuration Schema

### Complete Configuration Interface

```typescript
/**
 * Configuration for workspace preservation policies.
 */
export interface PreservationConfig {
  // ============================================
  // PRESERVATION TRIGGERS
  // ============================================

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
   * Always preserve workspaces regardless of outcome.
   * Use for debugging only.
   * Default: false
   */
  alwaysPreserve: boolean;

  // ============================================
  // RETENTION PERIODS
  // ============================================

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

  // ============================================
  // SIZE LIMITS
  // ============================================

  /**
   * Maximum number of preserved workspaces to keep.
   * When exceeded, oldest preserved workspace is evicted.
   * Default: 5
   */
  maxPreservedWorkspaces: number;

  /**
   * Maximum total size of preserved workspaces (in bytes).
   * When exceeded, workspaces are evicted based on evictionStrategy.
   * Default: 5GB (5 * 1024 * 1024 * 1024)
   */
  maxPreservedTotalSize: number;

  /**
   * Maximum size for a single workspace (in bytes).
   * Controls behavior via oversizedWorkspacePolicy.
   * Default: 2GB (2 * 1024 * 1024 * 1024)
   */
  maxWorkspaceSize: number;

  /**
   * Policy for handling oversized workspaces.
   * - 'reject': Don't preserve workspaces exceeding maxWorkspaceSize
   * - 'warn': Preserve but log warning
   * - 'allow': Preserve regardless of size
   * Default: 'warn'
   */
  oversizedWorkspacePolicy: 'reject' | 'warn' | 'allow';

  /**
   * Eviction strategy when preservation limits are exceeded.
   * - 'oldest-first': Evict oldest preserved workspace first
   * - 'largest-first': Evict largest preserved workspace first
   * Default: 'oldest-first'
   */
  evictionStrategy: 'oldest-first' | 'largest-first';

  // ============================================
  // CLEANUP TIMING
  // ============================================

  /**
   * How often to check for expired retention periods (in milliseconds).
   * Used when cleanup timing strategy is 'background'.
   * Default: 3600000 (1 hour)
   */
  retentionCheckInterval: number;

  /**
   * Whether to check retention expiration on every workspace access.
   * Adds minimal overhead but ensures timely cleanup.
   * Default: true
   */
  checkRetentionOnAccess: boolean;

  // ============================================
  // METADATA AND LOGGING
  // ============================================

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

  // ============================================
  // ADVANCED OPTIONS
  // ============================================

  /**
   * Upload preserved workspaces to remote storage (S3, GCS, etc).
   * Useful for CI environments where local disk is ephemeral.
   * Default: false
   */
  uploadToRemoteStorage: boolean;

  /**
   * Remote storage configuration (when uploadToRemoteStorage is true).
   */
  remoteStorage?: {
    provider: 's3' | 'gcs' | 'azure';
    bucket: string;
    region?: string;
    credentials?: any;
  };

  /**
   * Compress workspaces before preservation to save disk space.
   * Creates .tar.gz archives instead of preserving directories.
   * Default: false
   */
  compressPreservedWorkspaces: boolean;

  /**
   * Exclude patterns for workspace preservation (glob patterns).
   * Useful to exclude node_modules, build artifacts, etc.
   * Default: ['node_modules/**', '.git/**', 'dist/**', 'build/**']
   */
  excludePatterns: string[];
}
```

### Default Configuration by Environment

```typescript
/**
 * Recommended configurations for different environments.
 */
export const PRESERVATION_DEFAULTS: Record<string, Partial<PreservationConfig>> = {
  development: {
    preserveOnFailure: true,
    preserveOnTimeout: true,
    preserveOnTestFailure: true,
    failureRetentionDays: 7,
    timeoutRetentionDays: 3,
    testFailureRetentionDays: 7,
    maxPreservedWorkspaces: 5,
    maxPreservedTotalSize: 5 * 1024 * 1024 * 1024, // 5GB
    logPreservationEvents: true,
    storeDetailedMetadata: true,
    compressPreservedWorkspaces: false
  },

  ci: {
    preserveOnFailure: true,
    preserveOnTimeout: true,
    preserveOnTestFailure: false, // Too noisy in CI
    failureRetentionDays: 1, // Short retention for CI
    timeoutRetentionDays: 1,
    maxPreservedWorkspaces: 3,
    maxPreservedTotalSize: 2 * 1024 * 1024 * 1024, // 2GB
    logPreservationEvents: false,
    uploadToRemoteStorage: true, // Upload to S3/GCS
    compressPreservedWorkspaces: true, // Save space in CI
    excludePatterns: ['node_modules/**', '.git/**']
  },

  production: {
    preserveOnFailure: false, // Don't preserve in production
    preserveOnTimeout: false,
    preserveOnTestFailure: false,
    logPreservationEvents: false,
    maxPreservedWorkspaces: 0 // No preservation in production
  },

  test: {
    preserveOnFailure: false, // Immediate cleanup in tests
    preserveOnTimeout: false,
    preserveOnTestFailure: false,
    maxPreservedWorkspaces: 0
  }
};
```

### Configuration API Usage

```typescript
import { getWorkspace, PreservationConfig, PRESERVATION_DEFAULTS } from './workspace';

// Use environment-specific defaults
const config: PreservationConfig = {
  ...PRESERVATION_DEFAULTS.development,
  // Override specific settings
  failureRetentionDays: 14 // Keep failures for 2 weeks
};

// Pass to workspace operations
const workspace = await getWorkspace({
  repositoryUrl: 'https://github.com/user/repo.git',
  preservation: config
});
```

## Integration with Cleanup Timing Strategy

The preservation policy integrates seamlessly with the cleanup timing strategy (defined in [cleanup-timing-design.md](./cleanup-timing-design.md)).

### Integration Points

#### 1. LRU Eviction Integration

**Preservation Exemption:**
```typescript
async function evictOldWorkspaces(config: HybridWorkspaceConfig): Promise<number> {
  const allWorkspaces = await getWorkspaceMetadata();

  // Filter out preserved workspaces
  const eligibleForEviction = allWorkspaces.filter(workspace =>
    !isPreserved(workspace.path)
  );

  // Standard LRU eviction on remaining workspaces
  return await performEviction(eligibleForEviction, config);
}
```

**Behavior:**
- Preserved workspaces excluded from LRU eviction pool
- Only non-preserved workspaces subject to cleanup
- Preservation limits enforced separately

#### 2. Cleanup Timing Strategies

**Immediate Cleanup:**
```typescript
// Skip cleanup for preserved workspaces
export async function immediateCleanup(
  config: CleanupTimingConfig & PreservationConfig
): Promise<number> {
  // Check retention expiration first
  await expireRetentionPeriods();

  // Then perform standard cleanup (excluding preserved)
  return await performCleanup(config);
}
```

**Deferred Cleanup:**
```typescript
export async function deferredCleanup(
  config: CleanupTimingConfig & PreservationConfig
): Promise<void> {
  performCleanup(config)
    .then(async evictedCount => {
      // Also check retention expiration in background
      await expireRetentionPeriods();
      console.log(`[Deferred cleanup] Evicted ${evictedCount} workspace(s)`);
    })
    .catch(error => {
      console.error('[Deferred cleanup] Error:', error);
    });
}
```

**Background Cleanup:**
```typescript
export class BackgroundCleanupManager {
  private async runCleanup(): Promise<void> {
    // Check retention expiration
    const expired = await expireRetentionPeriods();

    // Perform standard cleanup
    const evicted = await performCleanup(this.config);

    console.log(`[Background cleanup] Expired ${expired}, evicted ${evicted}`);
  }
}
```

#### 3. Configuration Merging

**Unified Configuration:**
```typescript
interface UnifiedWorkspaceConfig extends
  HybridWorkspaceConfig,
  CleanupTimingConfig,
  PreservationConfig {}

// Default unified config
export const DEFAULT_UNIFIED_CONFIG: UnifiedWorkspaceConfig = {
  // Hybrid workspace config
  sizeThreshold: 100 * 1024 * 1024,
  maxWorkspaces: 10,

  // Cleanup timing config
  timing: 'deferred',
  preserveOnFailure: true, // Links to preservation
  backgroundInterval: 300000, // 5 minutes

  // Preservation config
  failureRetentionDays: 7,
  maxPreservedWorkspaces: 5,
  maxPreservedTotalSize: 5 * 1024 * 1024 * 1024,
  evictionStrategy: 'oldest-first'
};
```

### Interaction Scenarios

#### Scenario 1: Operation Fails, Workspace Preserved

**Timeline:**
1. `T0`: Operation fails in workspace A
2. `T0+1ms`: Preservation trigger activates
3. `T0+1ms`: Workspace A tagged with preservation metadata
4. `T1`: Deferred cleanup runs (async)
5. `T1+10ms`: Cleanup skips workspace A (preserved)
6. `T7d`: Retention period expires
7. `T7d+1h`: Background cleanup expires retention
8. `T7d+1h+1s`: Workspace A re-enters LRU pool
9. `T8d`: Workspace A evicted by LRU policy (if still oldest)

#### Scenario 2: Manual Preservation During Development

**Timeline:**
1. `T0`: Developer starts operation with `preserve: true`
2. `T0+100ms`: Workspace B created and tagged with indefinite preservation
3. `T1-T10`: Multiple operations access workspace B
4. `T1-T10`: Cleanup runs multiple times, skips workspace B
5. `T11`: Developer runs `workspace release` command
6. `T11+1ms`: Preservation metadata removed
7. `T11+1h`: Next cleanup cycle includes workspace B in LRU pool
8. `T12`: Workspace B evicted if it's among oldest non-preserved workspaces

#### Scenario 3: Preservation Limits Exceeded

**Timeline:**
1. `T0`: 5 workspaces already preserved (at limit)
2. `T1`: New operation fails, needs preservation
3. `T1+1ms`: Preservation system checks limits
4. `T1+2ms`: Oldest preserved workspace identified (workspace C, preserved 6d ago)
5. `T1+3ms`: Workspace C evicted to make room
6. `T1+4ms`: New workspace (workspace F) preserved
7. `T1+5ms`: Total preserved workspaces: still 5

## Implementation Checklist

- [ ] Implement preservation metadata format and storage
- [ ] Add preservation trigger hooks to operation lifecycle
- [ ] Implement retention period expiration checking
- [ ] Integrate preservation exemption with LRU eviction
- [ ] Add preservation limit enforcement
- [ ] Implement CLI commands for workspace management
- [ ] Add configuration validation and merging
- [ ] Write integration tests for preservation scenarios
- [ ] Document migration guide for existing workspaces
- [ ] Add metrics/telemetry for preservation effectiveness

## Open Questions

1. **Metadata Storage:** Store in workspace directory or separate index?
   - **Option A:** `.contextgraph-preservation.json` in each workspace (simple, self-contained)
   - **Option B:** Central index at `~/.contextgraph/preservation-index.json` (faster lookups)
   - **Recommendation:** Option A (simpler, more resilient)

2. **Remote Storage:** Which cloud providers to support initially?
   - S3 (AWS) - Most common in CI
   - GCS (Google Cloud) - Good GitHub Actions integration
   - Azure Blob Storage - Enterprise customers
   - **Recommendation:** Start with S3, add others based on demand

3. **Compression:** Compress in-place or create separate archive?
   - **In-place:** Save disk space, slower access
   - **Separate archive:** Keep original for fast access, archive for long-term storage
   - **Recommendation:** Optional separate archive for long retention periods

4. **Preservation UI:** Should we build a web UI for browsing preserved workspaces?
   - **Pro:** Better UX for inspection, easier artifact browsing
   - **Con:** Additional maintenance burden, security concerns
   - **Recommendation:** Start with CLI, consider web UI as future enhancement

## References

- **Cleanup Timing Design:** [docs/cleanup-timing-design.md](./cleanup-timing-design.md)
- **Persistent Cache Design:** [docs/persistent-cache-design.md](./persistent-cache-design.md)
- **Workspace Patterns:** [docs/workspace-patterns.md](./workspace-patterns.md)
- **Hybrid Workspace Implementation:** `src/services/workspace/hybrid-workspace.ts`
- **Parent Action:** Design Cleanup and Error Handling Strategy (9907b90b-49f0-41ab-8968-5f1c4d67da74)
