# Repository Workspace Management Patterns

## Overview

This document compares three workspace management patterns implemented to support repository operations for the local agent. Each pattern represents a different approach to managing cloned git repositories, with distinct tradeoffs in terms of simplicity, resource usage, and performance.

We evaluated these three patterns:
- **Temporary Workspace** - Clone repositories into OS temporary directories, cleanup after use
- **Persistent Workspace** - Clone repositories into stable cache directories, reuse across operations
- **Hybrid Workspace** - Automatically select between temporary and persistent based on repository characteristics

## Pattern Descriptions

### Temporary Workspace

Creates unique temporary directories for each repository operation and cleans up after use.

**When to use:**
- One-off operations that don't need persistence
- When disk space is constrained and automatic cleanup is critical
- When simplicity and predictability are more important than performance
- For small repositories where clone time is negligible

**Key characteristics:**
- Each operation gets a fresh clone in a unique OS temp directory
- Automatic cleanup with try/finally guarantees
- No state management or cache to maintain
- No risk of disk space accumulation

### Persistent Workspace

Clones repositories into stable cache directories (keyed by repository URL hash) and reuses them across operations.

**When to use:**
- Large repositories where clone time is significant (>5-10 seconds)
- Multiple operations expected on the same repository
- When performance is more important than disk space efficiency
- When you can manage cache cleanup manually or with external tools

**Key characteristics:**
- Repository URL maps to stable directory via SHA256 hash
- First access clones, subsequent accesses run git pull
- Includes corruption detection and recovery (re-clone if invalid)
- Manual cache management required (disk space grows unbounded)

### Hybrid Workspace

Automatically selects between temporary and persistent strategies based on repository characteristics and configuration.

**When to use:**
- When you want optimal performance without manual strategy selection
- When you need bounded disk usage with automatic cache management
- For diverse workloads with both small and large repositories
- When you're willing to accept additional complexity for automatic optimization

**Key characteristics:**
- Automatic strategy selection (currently: use persistent for all repos, can be enhanced)
- LRU cache eviction when workspace count exceeds configured maximum
- Configurable size threshold and max workspace count
- Combines benefits of both patterns at cost of increased complexity

## Code Examples

### Temporary Workspace

```typescript
import { withTempWorkspaceClone } from './services/workspace/temporary-workspace.js';

// Simple one-off operation with automatic cleanup
const packageJson = await withTempWorkspaceClone(
  { repositoryUrl: 'https://github.com/user/repo.git' },
  async (workspacePath) => {
    const content = await readFile(
      join(workspacePath, 'package.json'),
      'utf-8'
    );
    return JSON.parse(content);
  }
);
// Workspace automatically cleaned up after operation
```

```typescript
import { createTempWorkspaceWithClone } from './services/workspace/temporary-workspace.js';
import { withGitCredentials } from './git-auth-helper.js';

// Manual management with authentication
await withGitCredentials(token, async (gitEnv) => {
  const workspace = await createTempWorkspaceWithClone({
    repositoryUrl: 'https://github.com/user/private-repo.git',
    gitEnv,
    branch: 'develop'
  });

  try {
    // Perform multiple operations in workspace
    await runTests(workspace.path);
    await buildProject(workspace.path);
  } finally {
    await workspace.cleanup();
  }
});
```

### Persistent Workspace

```typescript
import { withPersistentWorkspace } from './services/workspace/persistent-workspace.js';

// Automatic cache management - first access clones, subsequent accesses pull
const result = await withPersistentWorkspace(
  { repositoryUrl: 'https://github.com/user/large-repo.git' },
  async (workspacePath, isNew) => {
    console.log(isNew ? 'Cloned repository' : 'Using cached workspace');

    // Perform operations
    return await analyzeCodebase(workspacePath);
  }
);
// Workspace persists at ~/.contextgraph/workspaces/<hash>
```

```typescript
import { getOrCreateWorkspace } from './services/workspace/persistent-workspace.js';

// Manual management for multiple operations
const workspace = await getOrCreateWorkspace({
  repositoryUrl: 'https://github.com/user/repo.git',
  branch: 'main'
});

// Workspace available at workspace.path
// First access: isNew = true (cloned)
// Subsequent: isNew = false (pulled)

await runMultipleOperations(workspace.path);
// Workspace persists for next operation
```

### Hybrid Workspace

```typescript
import { withHybridWorkspace } from './services/workspace/hybrid-workspace.js';

// Automatic strategy selection with bounded cache
const result = await withHybridWorkspace(
  { repositoryUrl: 'https://github.com/user/repo.git' },
  async (workspace) => {
    console.log(`Using ${workspace.strategy} workspace`);
    // workspace.strategy = 'temporary' | 'persistent'

    // Perform operations
    return await processRepository(workspace.path);
  }
);
// Temporary workspaces auto-cleanup
// Persistent workspaces cached (up to maxWorkspaces limit)
```

```typescript
import { getWorkspace } from './services/workspace/hybrid-workspace.js';

// Custom configuration for strategy selection and cache limits
const workspace = await getWorkspace({
  repositoryUrl: 'https://github.com/user/repo.git',
  config: {
    sizeThreshold: 50 * 1024 * 1024, // 50MB threshold
    maxWorkspaces: 5 // Keep max 5 persistent workspaces
  }
});

try {
  console.log('Strategy:', workspace.strategy);
  console.log('Path:', workspace.path);

  // Perform operations
  await processRepository(workspace.path);
} finally {
  // Only temporary workspaces need manual cleanup
  if (workspace.cleanup) {
    await workspace.cleanup();
  }
}
```

## Detailed Comparison

| Dimension | Temporary | Persistent | Hybrid |
|-----------|-----------|------------|--------|
| **Simplicity** | ⭐⭐⭐⭐⭐<br>Cleanest pattern, no state management | ⭐⭐⭐<br>Manual cache management required | ⭐⭐<br>Most complex, automatic strategy selection |
| **Predictability** | ⭐⭐⭐⭐⭐<br>Always fresh clone, deterministic behavior | ⭐⭐⭐<br>Corruption edge cases, pull can fail | ⭐⭐⭐<br>Strategy selection can surprise users |
| **Performance (small repos)** | ⭐⭐⭐⭐<br>~1.6s clone acceptable | ⭐⭐⭐⭐⭐<br>~0.7s pull after first clone | ⭐⭐⭐⭐⭐<br>Adapts to repo size |
| **Performance (large repos)** | ⭐<br>~15s clone every time | ⭐⭐⭐⭐⭐<br>~0.8s pull after first clone | ⭐⭐⭐⭐⭐<br>Caches large repos |
| **Disk Usage** | ⭐⭐⭐⭐⭐<br>No accumulation, auto-cleanup | ⭐<br>Unbounded growth | ⭐⭐⭐⭐<br>Bounded by maxWorkspaces |
| **Failure Modes** | ⭐⭐⭐<br>Cleanup can fail silently<br>Workspace lost on crashes | ⭐⭐⭐<br>Corruption requires re-clone<br>Disk can fill up | ⭐⭐<br>Complex failure scenarios<br>Eviction can fail |
| **Resource Guarantees** | ⭐⭐⭐⭐⭐<br>Guaranteed cleanup (OS handles temp dirs) | ⭐⭐<br>Manual cleanup required | ⭐⭐⭐⭐<br>Automatic eviction bounds disk usage |
| **Cache Hit Rate** | N/A<br>No caching | ⭐⭐⭐⭐⭐<br>100% for repeated access | ⭐⭐⭐⭐<br>High for frequently accessed repos |
| **Setup Complexity** | ⭐⭐⭐⭐⭐<br>No setup needed | ⭐⭐⭐⭐<br>Creates ~/.contextgraph/workspaces/ | ⭐⭐⭐⭐<br>Same as persistent |
| **Error Recovery** | ⭐⭐⭐⭐⭐<br>Fresh start every time | ⭐⭐⭐⭐<br>Auto-recovery from corruption | ⭐⭐⭐⭐<br>Inherits persistent recovery |
| **Concurrency** | ⭐⭐⭐⭐⭐<br>No conflicts, separate workspaces | ⭐⭐<br>Same repo/branch can conflict | ⭐⭐⭐<br>Temporary handles conflicts better |

## Performance Data

Based on benchmark testing with real repositories:

### Clone vs Pull Performance

| Repository Size | Clone Time (avg) | Pull Time (avg) | Speedup Factor |
|----------------|------------------|-----------------|----------------|
| Small (~1MB) | 1.58s | 0.74s | 2.1x |
| Medium (~10-20MB) | 1.53s | 0.95s | 1.6x |
| Large (~100MB+) | 15.30s | 0.78s | **19.6x** |

**Key Insight:** Persistent workspaces provide significant benefit for large repositories (19.6x faster on subsequent access).

### Detailed Measurements

**Small Repository (npm 'is' package)**
- Clone (cold): 1.58s avg (1.28s min, 2.05s max)
- Pull (no changes): 0.74s avg (0.57s min, 0.98s max)
- Disk usage: 1.97 MB

**Medium Repository (lodash)**
- Clone (cold): 1.53s avg (1.51s min, 1.58s max)
- Pull (no changes): 0.95s avg (0.64s min, 1.07s max)
- Disk usage: 5.20 MB

**Large Repository (TypeScript)**
- Clone (cold): 15.30s avg (13.48s min, 20.93s max)
- Pull (no changes): 0.78s avg (0.60s min, 1.05s max)
- Disk usage: ~100 MB+

See [docs/performance-data.md](./performance-data.md) for complete benchmark data.

## Detailed Tradeoffs

### Simplicity

**Temporary (Winner):** The simplest pattern with no state management. Create, use, cleanup. No cache to manage, no corruption to handle, no eviction policy needed.

**Persistent:** Requires understanding of cache directories, manual cleanup when needed, and corruption recovery. Must monitor disk usage.

**Hybrid:** Most complex pattern requiring configuration tuning, understanding of strategy selection heuristics, and awareness of LRU eviction behavior.

### Failure Modes

**Temporary:**
- Cleanup can fail silently (logged but doesn't throw)
- Workspace lost on crashes before cleanup
- OS temp directory fills up (rare, OS typically manages this)

**Persistent:**
- Corruption recovery implemented (detect invalid git repo, remove, re-clone)
- Disk space can fill up with no automatic cleanup
- Pull can fail due to conflicts or corruption
- Recovery is automatic but involves full re-clone

**Hybrid:**
- Inherits persistent failure modes for cached repos
- Inherits temporary failure modes for non-cached repos
- Eviction can fail, leaving cache over limit
- Strategy selection could choose suboptimal pattern
- Complex interaction between cache state and failure recovery

### Predictability

**Temporary (Winner):** Most deterministic. Every operation gets a fresh clone in a known location. No surprises from cached state.

**Persistent:** Less predictable due to cache state. First access behaves differently than subsequent. Corruption can cause unexpected re-clones.

**Hybrid:** Strategy selection adds unpredictability. User must understand when temporary vs persistent is used. Current implementation always uses persistent, but this could change based on heuristics.

### Resource Usage

**Temporary (Winner for Simplicity):** No disk accumulation. Each workspace cleaned up after use. OS handles temp directory management.

**Persistent (Worst):** Unbounded growth. Each unique repository URL creates a permanent cache entry. Requires manual cleanup or external tooling.

**Hybrid (Winner for Automation):** Bounded by `maxWorkspaces` config. LRU eviction removes oldest workspaces. Balances performance with disk usage.

### Performance

**Small Repositories (<50MB):**
- Temporary: ~1.6s clone is acceptable overhead
- Persistent: ~0.7-0.9s pull provides minor benefit (2x speedup)
- Hybrid: Can use temporary since clone cost is low

**Large Repositories (>50MB):**
- Temporary: ~15s clone is significant overhead
- Persistent: ~0.8s pull provides major benefit (19.6x speedup)
- Hybrid: Should use persistent for substantial performance gain

**Recommendation:** Persistent or hybrid patterns are strongly recommended for large repositories.

## Recommendations

### Choose Temporary Workspace When:

1. **One-off operations** - Single operation, no repeated access expected
2. **Disk space is critical** - Automatic cleanup more important than performance
3. **Simplicity matters** - Minimal code complexity and failure modes
4. **Small repositories** - Clone time <2s is acceptable
5. **Maximum isolation** - Each operation needs completely fresh environment

**Example use cases:**
- CI/CD pipelines running tests on PRs
- One-time repository analysis or report generation
- Security scanning where isolation is critical
- Development/testing of workspace patterns themselves

### Choose Persistent Workspace When:

1. **Large repositories** - Clone time >5-10 seconds impacts UX
2. **Repeated operations** - Same repository accessed multiple times
3. **Performance critical** - Pull (0.8s) vs clone (15s) matters
4. **Manual control** - You want to manage cache lifecycle yourself
5. **Disk space available** - Can accommodate cache growth

**Example use cases:**
- IDE integration with same repos accessed frequently
- Large monorepo analysis requiring multiple passes
- Development environment with stable set of repos
- Background services processing same repos repeatedly

### Choose Hybrid Workspace When:

1. **Diverse workload** - Mix of small and large repositories
2. **Automatic optimization** - Don't want to manually choose strategy
3. **Bounded disk usage** - Need automatic cache management
4. **Performance + simplicity** - Want benefits without manual management
5. **Can tolerate complexity** - Comfortable with automatic decision-making

**Example use cases:**
- Multi-tenant services with unknown repository sizes
- Agent operations across user-provided repositories
- Platform services handling diverse repo catalog
- Production systems requiring automatic resource management

### Configuration Recommendations

For **Hybrid** pattern, tune these parameters based on your needs:

```typescript
{
  // Size threshold for strategy selection (currently unused, defaults to persistent)
  // Future: Repositories larger than this will use persistent strategy
  sizeThreshold: 50 * 1024 * 1024, // 50MB recommended starting point

  // Maximum persistent workspaces to keep cached
  // Consider: disk space, number of unique repos, access patterns
  maxWorkspaces: 10 // Adjust based on available disk space
}
```

**Disk space estimation:**
- Small repos (~1-5MB): 10 workspaces = ~50MB
- Medium repos (~10-20MB): 10 workspaces = ~200MB
- Large repos (~50-100MB): 10 workspaces = ~1GB
- Mixed workload: Budget ~500MB - 1GB for 10 workspaces

## Implementation Files

- **Temporary:** [src/services/workspace/temporary-workspace.ts](../src/services/workspace/temporary-workspace.ts)
- **Persistent:** [src/services/workspace/persistent-workspace.ts](../src/services/workspace/persistent-workspace.ts)
- **Hybrid:** [src/services/workspace/hybrid-workspace.ts](../src/services/workspace/hybrid-workspace.ts)
- **Performance Data:** [docs/performance-data.md](./performance-data.md)

## Future Enhancements

### Hybrid Pattern Strategy Selection

Current implementation uses a simple heuristic (always prefer persistent). Future enhancements could include:

1. **Dynamic size detection** - Check repository size before cloning using `git ls-remote` or GitHub API
2. **Usage pattern tracking** - Track access frequency and optimize based on actual usage
3. **Adaptive thresholds** - Learn optimal size threshold from performance data
4. **Branch-aware caching** - Cache decision based on branch, not just repository

### Cache Management

1. **TTL-based eviction** - Evict workspaces not accessed in N days
2. **Disk usage monitoring** - Evict when total cache size exceeds threshold
3. **Manual cache inspection** - CLI tools to view, manage, and cleanup cache
4. **Cache warming** - Pre-populate cache with frequently accessed repos

### Error Recovery

1. **Partial clone support** - Use `--depth=1` for faster clones when history not needed
2. **Incremental fetch** - Use `git fetch` with partial updates for large repos
3. **Parallel operations** - Support concurrent operations on same workspace
4. **Lock management** - Prevent conflicts when multiple processes access same workspace

## Conclusion

All three patterns are production-ready implementations with different optimization goals:

- **Temporary** optimizes for simplicity and resource cleanup
- **Persistent** optimizes for performance with large repositories
- **Hybrid** optimizes for automatic resource management and performance

The best choice depends on your specific requirements around performance, disk space, complexity tolerance, and access patterns. For the local agent use case with diverse user-provided repositories, the **hybrid pattern** provides the best balance of performance and resource management.
