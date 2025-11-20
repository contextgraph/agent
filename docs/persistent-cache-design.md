# Persistent Workspace Cache Design

## Overview

The persistent workspace cache is an LRU (Least Recently Used) cache system that manages long-lived Git repository clones, providing significant performance improvements for large repositories while automatically managing disk space usage.

## Architecture

### Cache Location

```
~/.contextgraph/workspaces/
├── <hash1>/  # Cached repository workspace
├── <hash2>/  # Cached repository workspace
└── ...
```

All persistent workspaces are stored under `~/.contextgraph/workspaces/`, with each workspace in a subdirectory identified by an MD5 hash of the repository URL.

### Cache Key Strategy

**Implementation:** MD5 hash of repository URL

**Rationale:**
- **Uniqueness:** Each repository URL gets a unique, deterministic directory name
- **Safety:** MD5 provides collision-resistant hashing suitable for file system identifiers
- **Simplicity:** Direct mapping from URL to workspace without needing a separate index
- **Performance:** Fast hash computation with no external dependencies

**Alternative Considered:** Using sanitized repository URLs as directory names was rejected due to:
- Potential for invalid filesystem characters
- Length limitations on some filesystems
- URL encoding complexity

### LRU Implementation

**Implementation:** Filesystem-based LRU using access time tracking (atime)

**Core Algorithm:**
1. Each workspace directory's `atime` (last access time) is tracked by the filesystem
2. When cache limit is reached, sort all workspaces by `atime` (oldest first)
3. Remove oldest workspaces until count falls below `maxWorkspaces`

**Implementation Details:**
```typescript
async function getWorkspaceMetadata(): Promise<WorkspaceMetadata[]> {
  // Read all workspace directories
  // Extract atime from filesystem stats
  // Sort by lastAccessTime ascending (oldest first)
  return metadata.sort((a, b) => a.lastAccessTime - b.lastAccessTime);
}
```

**Rationale:**
- **Zero external dependencies:** No Redis, no separate cache index, no database
- **Self-healing:** Filesystem automatically maintains access times
- **Simple implementation:** Leverages existing OS primitives
- **Resilient:** Manual deletions or external cleanup don't break the cache

**Trade-offs:**
- Access time resolution is OS-dependent (typically seconds)
- Requires `atime` to be enabled on the filesystem (default on most systems)
- Sorting operation scales linearly with number of cached workspaces (acceptable for default limit of 10)

## Configuration

### Default Values

```typescript
export const DEFAULT_CONFIG: HybridWorkspaceConfig = {
  sizeThreshold: 100 * 1024 * 1024, // 100MB
  maxWorkspaces: 10
};
```

### Size Threshold: 100MB

**Rationale:**
- Based on benchmark data showing clear performance differentiation:
  - Small repos (~1.5s clone time): Temporary workspace overhead is negligible
  - Large repos (~15s clone time): Persistent caching provides significant benefit (10x improvement)
- 100MB represents a reasonable boundary where clone time becomes noticeable
- Prevents cache pollution with many small repositories that wouldn't benefit from caching

**Configurable:** Users can override based on their specific use cases and disk space constraints

### Max Workspaces: 10

**Rationale:**
- **Disk space management:** With 100MB threshold, 10 workspaces ≈ 1GB minimum (likely more for large repos)
- **Hit rate optimization:** Most users repeatedly access a small set of repositories
- **Eviction frequency:** Strikes balance between cache utility and churn
- **Common use case:** Typical developer works on 3-5 primary projects with occasional forays into dependencies

**Configurable:** Users with more disk space or different access patterns can increase the limit

## Eviction Strategy

### Trigger: Automatic on Access

**When:** Eviction check runs automatically after every workspace creation via `getWorkspace()`

**Why:** Proactive cache management prevents unbounded growth while keeping implementation simple

### Algorithm: LRU (Least Recently Used)

**Process:**
1. Calculate how many workspaces need to be evicted: `max(0, current_count - maxWorkspaces)`
2. Get workspace metadata sorted by access time (oldest first)
3. Take the first N workspaces (oldest)
4. Remove them from disk using `rm -rf`

**Error Handling:**
- Eviction failures are logged but don't prevent workspace operations
- Failed evictions are counted separately and reported to the caller
- Workspace creation succeeds even if eviction partially fails

**Example:**
```typescript
// Current: 12 workspaces, Limit: 10
// Need to evict: 2
const evictionCount = Math.max(0, 12 - 10); // = 2

// Get oldest 2 workspaces
const workspacesToEvict = metadata
  .sort((a, b) => a.lastAccessTime - b.lastAccessTime)
  .slice(0, 2);

// Remove them
for (const workspace of workspacesToEvict) {
  await rm(workspace.path, { recursive: true, force: true });
}
```

## Strategy Selection

### Current Implementation: Always Persistent (for now)

**Rationale:**
The current `determineStrategy()` function defaults to `persistent` for all repositories to:
1. Build up the cache over time
2. Gather real-world usage data
3. Avoid premature optimization

### Future Enhancement: Dynamic Size Detection

**Planned Approach:**
```typescript
// Future implementation sketch
export async function determineStrategy(
  repositoryUrl: string,
  config: HybridWorkspaceConfig
): Promise<WorkspaceStrategy> {
  // Option 1: Check via git ls-remote
  // - Fast but requires an extra network call

  // Option 2: Use GitHub/GitLab API
  // - Provides exact size but requires API access

  // Option 3: Hybrid heuristic
  // - Check if workspace exists (persistent if yes)
  // - Otherwise, use API if available, fall back to clone

  const size = await getRepositorySize(repositoryUrl);
  return size > config.sizeThreshold ? 'persistent' : 'temporary';
}
```

**Considerations:**
- **Network overhead:** Extra API call adds latency
- **API rate limits:** GitHub/GitLab impose rate limits on anonymous requests
- **Accuracy:** Some repositories may not expose size information
- **Fallback strategy:** Must handle cases where size cannot be determined

## Performance Characteristics

### First Access (Cache Miss)

**Persistent Strategy:**
- Clone repository: ~15s for large repos, ~1.5s for small repos
- Create workspace directory structure: ~100ms
- **Total:** Clone time + minimal overhead

**Temporary Strategy:**
- Clone repository: ~15s for large repos, ~1.5s for small repos
- Create temp directory: ~10ms
- **Total:** Clone time + minimal overhead

**Conclusion:** First access performance is nearly identical between strategies.

### Subsequent Access (Cache Hit)

**Persistent Strategy:**
- Check workspace exists: ~1ms
- Git fetch + reset: ~500ms - 2s (depending on changes)
- Update access time: filesystem automatic
- **Total:** ~1.5s typical

**Temporary Strategy:**
- Clone repository: ~15s for large repos
- **Total:** Full clone time every time

**Performance Improvement:** **10x faster** for large repositories (15s → 1.5s)

### Eviction Performance

**Time Complexity:** O(n log n) where n = number of cached workspaces
- Read directory: O(n)
- Get stats for each: O(n)
- Sort by access time: O(n log n)
- Delete oldest: O(k) where k = eviction count

**Practical Impact:** With default limit of 10 workspaces, eviction takes <100ms

## Trade-offs and Considerations

### Disk Space vs. Performance

**Trade-off:** Persistent caching uses more disk space for better performance

**Mitigation:**
- Configurable `maxWorkspaces` limit
- LRU eviction prevents unbounded growth
- Size threshold prevents caching of small repos

**Guideline:** Default configuration (10 workspaces at 100MB threshold) should use roughly 1-5GB

### Stale Cache

**Issue:** Cached workspaces may become stale if upstream repository changes

**Mitigation:** Every workspace access performs `git fetch` + `git reset --hard` to sync with remote

**Implication:** Cache provides speed improvement while maintaining correctness

### Access Time Precision

**Issue:** Filesystem access times have second-level precision (on most systems)

**Impact:** Multiple accesses within the same second won't change eviction order

**Mitigation:** This is acceptable because:
- Eviction is based on "oldest" workspaces (hours/days old)
- Second-level precision is sufficient for LRU ordering
- The default limit (10) means eviction is infrequent

### Concurrent Access

**Current Implementation:** No explicit locking

**Risk:** Multiple processes could try to:
- Clone the same repository simultaneously
- Evict the same workspace concurrently

**Status:** Not yet addressed in prototype

**Future Enhancement:**
- File-based locking per workspace
- Advisory locks during clone/eviction operations
- Retry logic for lock contention

### Manual Cleanup

**Scenario:** User manually deletes `~/.contextgraph/workspaces/` or individual workspaces

**Behavior:** System gracefully handles missing workspaces:
- Next access will re-clone the repository
- Eviction skips workspaces that don't exist
- No persistent state to corrupt

**Resilience:** Cache is self-healing and doesn't require consistency maintenance

## Future Enhancements

### 1. Smart Size Detection

**Goal:** Automatically determine repository size before deciding strategy

**Options:**
- GitHub/GitLab API integration
- `git ls-remote` with size hints
- Progressive strategy (start temporary, upgrade to persistent if accessed repeatedly)

### 2. Total Cache Size Limit

**Current:** Only limits number of workspaces
**Enhancement:** Add maximum total disk space limit

```typescript
interface HybridWorkspaceConfig {
  maxWorkspaces: number;
  maxTotalSize: number; // New: total bytes across all workspaces
}
```

**Eviction:** Remove oldest workspaces until total size is below limit

### 3. Access Frequency Metrics

**Goal:** Track hit rate and performance improvements

**Metrics:**
- Cache hit rate (% of accesses that reuse existing workspace)
- Average clone time (fresh clone)
- Average fetch time (cache hit)
- Eviction frequency
- Disk space savings

### 4. Workspace Health Monitoring

**Goal:** Detect and repair corrupted workspaces

**Checks:**
- Verify `.git` directory exists and is valid
- Check for interrupted operations
- Validate working directory state

**Auto-repair:** Remove and re-clone corrupted workspaces

### 5. Concurrency Safety

**Goal:** Support multiple concurrent processes safely

**Implementation:**
- File-based advisory locks
- Lock acquisition timeout
- Graceful retry on contention

### 6. Configurable Eviction Strategies

**Current:** Only LRU
**Future Options:**
- LFU (Least Frequently Used): Track access count, not just last access
- Size-aware: Prefer evicting larger workspaces to free more space
- Age-based: Evict workspaces that haven't been accessed in N days

## Summary

The persistent workspace cache provides a **10x performance improvement** for large repository operations through a simple, filesystem-based LRU cache. The design prioritizes:

1. **Simplicity:** No external dependencies, leverages OS primitives
2. **Reliability:** Self-healing, graceful degradation
3. **Performance:** 15s → 1.5s for large repos
4. **Configurability:** Adjustable thresholds and limits
5. **Maintainability:** Automatic eviction, minimal state

The default configuration (100MB threshold, 10 workspace limit) balances performance benefits with disk space usage for typical development workflows.
