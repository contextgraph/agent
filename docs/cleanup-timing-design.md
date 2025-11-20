# Workspace Cleanup Timing Strategy Design

## Overview

This document analyzes different timing strategies for workspace cleanup in the hybrid workspace pattern, comparing trade-offs between performance, reliability, and complexity.

## Current Implementation

The current implementation (`hybrid-workspace.ts:327-353`) uses **immediate cleanup**:

```typescript
export async function getWorkspace(options: HybridWorkspaceOptions): Promise<HybridWorkspaceResult> {
  // ... get or create workspace ...

  // Check if we need to evict old workspaces (IMMEDIATE)
  await evictOldWorkspaces(fullConfig);

  return workspace;
}
```

This approach performs synchronous LRU eviction on every `getWorkspace()` call, blocking the caller until cleanup completes.

## Timing Strategies

### 1. Immediate Cleanup (Current)

**Description:** Synchronous eviction during workspace access.

**Implementation:**
```typescript
export async function immediateCleanup(config: CleanupTimingConfig): Promise<number> {
  return await performCleanup(config);
}
```

**Advantages:**
- ✅ Simple and predictable behavior
- ✅ Immediate cache consistency
- ✅ No additional lifecycle management needed
- ✅ Errors are visible to caller
- ✅ Cache never exceeds maxWorkspaces

**Disadvantages:**
- ❌ Blocks workspace access during cleanup
- ❌ Can add latency to workspace operations
- ❌ Cleanup cost paid by the requesting operation
- ❌ May evict workspace being accessed if poorly timed

**Performance Impact:**
- Blocking time: ~10-100ms per workspace evicted (depends on disk I/O)
- Predictable: Same cost on every access when cleanup needed
- UX impact: User waits for cleanup before getting workspace

**Use Cases:**
- Small number of workspaces (cleanup is fast)
- Strict cache limits required
- Simple applications without latency requirements
- Development/debugging scenarios

### 2. Deferred Cleanup

**Description:** Async eviction after returning workspace to caller.

**Implementation:**
```typescript
export async function deferredCleanup(config: CleanupTimingConfig): Promise<void> {
  performCleanup(config)
    .then(evictedCount => {
      if (evictedCount > 0) {
        console.log(`[Deferred cleanup] Evicted ${evictedCount} workspace(s)`);
      }
    })
    .catch(error => {
      console.error('[Deferred cleanup] Error during cleanup:', error);
    });
  // Return immediately
}
```

**Advantages:**
- ✅ Doesn't block workspace access
- ✅ Zero latency impact on caller
- ✅ Still maintains reasonable cache consistency
- ✅ Simple to implement (minimal changes)

**Disadvantages:**
- ❌ Cleanup errors happen in background (harder to track)
- ❌ Cache limit can temporarily exceed maxWorkspaces
- ❌ Race conditions if multiple operations trigger cleanup
- ❌ No backpressure if cleanup can't keep up

**Performance Impact:**
- Blocking time: 0ms (immediate return)
- Cleanup happens asynchronously
- UX impact: User gets workspace immediately, cleanup invisible

**Error Handling Challenges:**
```typescript
// Error in deferred cleanup - what to do?
performCleanup(config).catch(error => {
  // 1. Log and continue? (Current approach)
  console.error('[Deferred cleanup] Error:', error);

  // 2. Retry? (Add complexity)
  // 3. Notify caller? (They're already gone)
  // 4. Emit event? (Requires event system)
});
```

**Use Cases:**
- Latency-sensitive applications
- Web servers with request/response cycles
- Operations where cleanup errors are non-critical
- When cache limits can briefly exceed threshold

### 3. Background Job

**Description:** Periodic cleanup independent of operations.

**Implementation:**
```typescript
export class BackgroundCleanupManager {
  private intervalId?: NodeJS.Timeout;

  start(): void {
    this.intervalId = setInterval(() => {
      this.runCleanup();
    }, this.config.backgroundInterval);
  }

  stop(): void {
    clearInterval(this.intervalId);
  }
}
```

**Advantages:**
- ✅ Zero impact on workspace operations
- ✅ Predictable cleanup schedule
- ✅ Centralized cleanup management
- ✅ Can optimize cleanup timing (off-peak hours)
- ✅ Errors are isolated from operations

**Disadvantages:**
- ❌ Requires lifecycle management (start/stop)
- ❌ Cache can grow between cleanup intervals
- ❌ May clean up during active operations
- ❌ Adds complexity to application lifecycle
- ❌ Wasted cycles if no cleanup needed

**Performance Impact:**
- Blocking time: 0ms on workspace access
- Cleanup runs on schedule (e.g., every 5 minutes)
- Resource usage: Periodic CPU/disk spikes
- UX impact: Completely invisible to users

**Lifecycle Management:**
```typescript
// Application startup
const cleanupManager = new BackgroundCleanupManager(config);
cleanupManager.start();

// Application shutdown
process.on('SIGTERM', () => {
  cleanupManager.stop();
  process.exit(0);
});
```

**Use Cases:**
- Long-running services
- Applications with predictable usage patterns
- When cleanup can be scheduled during low-traffic periods
- Systems that need graceful shutdown

## Conditional Preservation

A cross-cutting concern that applies to all timing strategies:

```typescript
export function shouldPreserveWorkspace(
  config: CleanupTimingConfig,
  context: OperationContext
): boolean {
  if (!config.preserveOnFailure) {
    return false;
  }
  return !context.succeeded; // Preserve on failure
}
```

**Use Case:** When an operation fails, preserve the workspace for debugging rather than evicting it.

**Advantages:**
- ✅ Helps developers debug failures
- ✅ Maintains state for post-mortem analysis
- ✅ Configurable (can be disabled in production)

**Disadvantages:**
- ❌ Failed workspaces accumulate if not manually cleaned
- ❌ Need mechanism to detect operation failure
- ❌ Adds complexity to eviction logic

**Implementation Challenges:**
- How to track operation success/failure?
- How long to preserve failed workspaces?
- How to manually trigger cleanup of preserved workspaces?

## Performance Comparison

### Benchmark Scenario
- 15 workspaces in cache
- maxWorkspaces = 10
- Need to evict 5 workspaces
- Average eviction time: 50ms per workspace

| Strategy | Blocking Time | Total Cleanup Time | Cache Consistency |
|----------|---------------|-------------------|-------------------|
| Immediate | 250ms | 250ms | Immediate |
| Deferred | 0ms | 250ms (async) | Eventual |
| Background | 0ms | Varies (periodic) | Eventual |

### Real-World Impact

**Scenario 1: High-Frequency Access**
- 100 requests/minute
- Immediate: Every request may be delayed 0-250ms
- Deferred: No delays, cleanup keeps up
- Background: No delays, periodic cleanup

**Scenario 2: Low-Frequency Access**
- 10 requests/hour
- Immediate: Occasional 250ms delay
- Deferred: No delays, cleanup after access
- Background: May waste cycles checking empty cache

**Scenario 3: Burst Traffic**
- 50 requests in 10 seconds, then idle
- Immediate: All requests potentially delayed
- Deferred: No delays, cleanup accumulates
- Background: May miss burst, cleanup later

## Race Conditions

### Deferred Cleanup Race
```typescript
// Timeline:
// T0: Operation A gets workspace, triggers deferred cleanup
// T1: Operation B gets workspace, triggers deferred cleanup
// T2: Cleanup A starts evicting workspaces
// T3: Cleanup B starts evicting workspaces (may conflict!)
```

**Mitigation:** Use mutex/lock for cleanup operations.

### Background Cleanup Race
```typescript
// Timeline:
// T0: Background cleanup starts
// T1: Operation gets workspace (may be getting evicted!)
```

**Mitigation:** Check workspace existence after retrieval, or use file locks.

## Configuration API

Proposed unified configuration:

```typescript
interface CleanupTimingConfig extends HybridWorkspaceConfig {
  // Timing strategy
  timing: 'immediate' | 'deferred' | 'background';

  // Preservation policy
  preserveOnFailure: boolean;

  // Background job settings
  backgroundInterval?: number; // milliseconds
}
```

**Usage:**
```typescript
const workspace = await getWorkspace({
  repositoryUrl: 'https://github.com/user/repo.git',
  config: {
    sizeThreshold: 100 * 1024 * 1024,
    maxWorkspaces: 10,
    timing: 'deferred', // Choose timing strategy
    preserveOnFailure: true, // Enable preservation
  }
});
```

## Recommendations

### Default Strategy: Deferred Cleanup

**Rationale:**
- Best balance of performance and simplicity
- No blocking impact on users
- Simpler than background jobs (no lifecycle management)
- Cache limits can briefly exceed threshold (acceptable trade-off)

**Configuration:**
```typescript
export const RECOMMENDED_CONFIG: CleanupTimingConfig = {
  sizeThreshold: 100 * 1024 * 1024,
  maxWorkspaces: 10,
  timing: 'deferred',
  preserveOnFailure: false, // Disable in production
  backgroundInterval: undefined // Not used
};
```

### When to Use Each Strategy

| Strategy | Best For | Avoid When |
|----------|----------|------------|
| **Immediate** | Simple apps, strict cache limits, development/debugging | Latency-sensitive operations, high-frequency access |
| **Deferred** | Most production use cases, balanced performance/simplicity | Need strict cache limits, critical error handling |
| **Background** | Long-running services, predictable patterns, off-peak cleanup | Short-lived processes, unpredictable workloads |

### Migration Path

1. **Phase 1:** Keep immediate cleanup as default (current behavior)
2. **Phase 2:** Add deferred cleanup option, test in development
3. **Phase 3:** Switch default to deferred, document migration
4. **Phase 4:** Add background cleanup for advanced users

## Implementation Checklist

- [x] Implement immediate cleanup prototype
- [x] Implement deferred cleanup prototype
- [x] Implement background cleanup prototype
- [x] Add conditional preservation logic
- [ ] Add mutex for deferred cleanup race prevention
- [ ] Add metrics/telemetry for cleanup performance
- [ ] Write integration tests for each strategy
- [ ] Add configuration validation
- [ ] Document migration guide
- [ ] Add performance benchmarks

## Open Questions

1. **Error Handling:** How should deferred cleanup errors be surfaced?
   - Log and continue (current approach)
   - Emit events for monitoring
   - Retry with exponential backoff

2. **Preservation Mechanism:** How to track operation success/failure?
   - Explicit context passing (current design)
   - Error tracking service
   - Metadata files in workspaces

3. **Background Job Lifecycle:** Where to manage start/stop?
   - Application initialization
   - Service-level lifecycle hooks
   - Per-request lifecycle (not suitable)

4. **Cache Limit Enforcement:** Should deferred/background strictly enforce limits?
   - Allow temporary exceedance (current design)
   - Queue operations until cleanup completes
   - Fail fast when limit exceeded

## References

- Current implementation: `src/services/workspace/hybrid-workspace.ts:327-353`
- Prototypes: `src/services/workspace/cleanup-timing.ts`
- Related design: `docs/persistent-cache-design.md`
- Parent action: Design Cleanup and Error Handling Strategy
