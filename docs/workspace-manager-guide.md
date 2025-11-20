# Integrated Workspace Management System

## Overview

The integrated workspace management system provides a unified, coherent interface for managing Git repository workspaces. It combines four independently-designed components into a single orchestrated system:

1. **Persistent Cache** - LRU cache with filesystem-based access tracking
2. **Cleanup Timing** - Configurable cleanup strategies (immediate, deferred, background)
3. **Workspace Preservation** - Debug-friendly retention for failed operations
4. **Error Handling** - Structured errors with automatic retry logic

## Quick Start

### Basic Usage

```typescript
import { getWorkspace } from './workspace-manager.js';

// Get a workspace (automatically managed)
const workspace = await getWorkspace({
  repositoryUrl: 'https://github.com/user/repo.git'
});

console.log('Workspace path:', workspace.path);
console.log('Strategy:', workspace.strategy); // 'persistent' or 'temporary'

// Use the workspace...
// Cleanup happens automatically based on configuration
```

### Execute Operation in Workspace

```typescript
import { withWorkspace } from './workspace-manager.js';

const result = await withWorkspace(
  { repositoryUrl: 'https://github.com/user/repo.git' },
  async (workspace) => {
    // Perform operations
    // Workspace automatically preserved on failure
    return someResult;
  }
);
```

### Custom Configuration

```typescript
import { WorkspaceManager } from './workspace-manager.js';

const manager = new WorkspaceManager({
  cache: {
    sizeThreshold: 50 * 1024 * 1024, // 50MB threshold
    maxWorkspaces: 5
  },
  cleanup: {
    timing: 'deferred', // Non-blocking cleanup
    backgroundInterval: 300000
  },
  preservation: {
    preserveOnFailure: true,
    failureRetentionDays: 7
  },
  errorHandling: {
    maxRetries: 3,
    enablePreFlightChecks: true
  }
});

const workspace = await manager.getWorkspace({
  repositoryUrl: 'https://github.com/user/repo.git'
});
```

## Architecture

### Component Integration

```
┌─────────────────────────────────────────────────────────────┐
│                    WorkspaceManager                          │
│  (Orchestrates all components)                              │
└───────────────────┬─────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       ▼
┌──────────────┐        ┌──────────────┐
│ Cache        │        │ Cleanup      │
│ Management   │        │ Timing       │
│              │        │              │
│ • LRU        │        │ • Immediate  │
│ • Eviction   │        │ • Deferred   │
│              │        │ • Background │
└──────────────┘        └──────────────┘
        │                       │
        └───────────┬───────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       ▼
┌──────────────┐        ┌──────────────┐
│ Preservation │        │ Error        │
│ Policy       │        │ Handling     │
│              │        │              │
│ • Triggers   │        │ • Retry      │
│ • Retention  │        │ • Recovery   │
│ • Metadata   │        │ • Validation │
└──────────────┘        └──────────────┘
```

### Data Flow

1. **Workspace Request** → WorkspaceManager receives request
2. **Strategy Selection** → Determines temporary vs persistent
3. **Error Handling** → Wraps operation with retry logic
4. **Workspace Creation** → Creates or reuses workspace
5. **Preservation Check** → Manual preservation if requested
6. **Operation Execution** → User code runs in workspace
7. **Failure Detection** → Catches errors, triggers preservation
8. **Cleanup Execution** → Runs cleanup based on timing strategy
9. **Retention Management** → Expires old preservation metadata

## Configuration

### Unified Configuration Structure

The system uses a unified configuration interface with four main sections:

```typescript
interface WorkspaceManagerConfig {
  cache: CacheConfig;           // Cache behavior
  cleanup: CleanupConfig;       // Cleanup timing
  preservation: PreservationConfig; // Preservation policy
  errorHandling: ErrorHandlingConfig; // Error handling
}
```

### Cache Configuration

Controls workspace caching and LRU eviction:

```typescript
interface CacheConfig {
  sizeThreshold: number;  // Threshold for persistent vs temporary
  maxWorkspaces: number;  // Maximum cached workspaces
}

// Default
{
  sizeThreshold: 100 * 1024 * 1024, // 100MB
  maxWorkspaces: 10
}
```

### Cleanup Configuration

Controls when and how cleanup happens:

```typescript
interface CleanupConfig {
  timing: 'immediate' | 'deferred' | 'background';
  backgroundInterval: number; // For background timing
}

// Default
{
  timing: 'immediate',
  backgroundInterval: 300000 // 5 minutes
}
```

**Cleanup Strategies:**
- **Immediate**: Synchronous cleanup blocks workspace access (simple, predictable)
- **Deferred**: Async cleanup after returning workspace (non-blocking, best for dev)
- **Background**: Periodic cleanup independent of operations (best for production)

### Preservation Configuration

Controls workspace preservation for debugging:

```typescript
interface PreservationConfig {
  // Triggers
  preserveOnFailure: boolean;
  preserveOnTimeout: boolean;
  preserveOnTestFailure: boolean;

  // Retention periods (days)
  failureRetentionDays: number;
  timeoutRetentionDays: number;
  testFailureRetentionDays: number;
  maxRetentionDays: number;
  minRetentionHours: number;

  // Size limits
  maxPreservedWorkspaces: number;
  maxPreservedTotalSize: number;
  maxWorkspaceSize: number;
  oversizedWorkspacePolicy: 'reject' | 'warn' | 'allow';
  evictionStrategy: 'oldest-first' | 'largest-first';

  // Behavior
  retentionCheckInterval: number;
  checkRetentionOnAccess: boolean;
  storeDetailedMetadata: boolean;
  logPreservationEvents: boolean;
  metadataFileName: string;
}
```

### Error Handling Configuration

Controls retry and validation behavior:

```typescript
interface ErrorHandlingConfig {
  maxRetries: number;
  initialRetryDelay: number;
  maxRetryDelay: number;
  enablePreFlightChecks: boolean;
  requiredDiskSpace: number;
  enableCorruptionDetection: boolean;
  enableStructuredLogging: boolean;
}

// Default
{
  maxRetries: 3,
  initialRetryDelay: 1000, // 1 second
  maxRetryDelay: 30000, // 30 seconds
  enablePreFlightChecks: true,
  requiredDiskSpace: 1024 * 1024 * 1024, // 1GB
  enableCorruptionDetection: true,
  enableStructuredLogging: true
}
```

### Environment Presets

Pre-configured settings for different environments:

```typescript
import { getEnvironmentConfig } from './config.js';

// Development: Deferred cleanup, preservation enabled
const devConfig = getEnvironmentConfig('development');

// CI: Short retention, minimal preservation
const ciConfig = getEnvironmentConfig('ci');

// Production: Background cleanup, no preservation
const prodConfig = getEnvironmentConfig('production');

// Test: Immediate cleanup, no preservation
const testConfig = getEnvironmentConfig('test');
```

## Features

### 1. Automatic Cache Management

The system automatically manages a persistent cache of Git repositories:

```typescript
// First access - clones repository
const ws1 = await getWorkspace({
  repositoryUrl: 'https://github.com/user/repo.git'
});

// Second access - reuses cached workspace (10x faster)
const ws2 = await getWorkspace({
  repositoryUrl: 'https://github.com/user/repo.git'
});

// Uses git fetch + reset instead of full clone
```

**Benefits:**
- 10x performance improvement for large repositories
- Automatic LRU eviction when cache limit exceeded
- Configurable size threshold and workspace limit

### 2. Flexible Cleanup Timing

Choose cleanup strategy based on requirements:

```typescript
// Immediate: Blocks until cleanup complete (simple)
const manager1 = new WorkspaceManager({
  cleanup: { timing: 'immediate' }
});

// Deferred: Returns immediately, cleanup happens async (best UX)
const manager2 = new WorkspaceManager({
  cleanup: { timing: 'deferred' }
});

// Background: Periodic cleanup independent of operations
const manager3 = new WorkspaceManager({
  cleanup: {
    timing: 'background',
    backgroundInterval: 600000 // 10 minutes
  }
});
manager3.start(); // Start background job
```

### 3. Workspace Preservation

Automatically preserve workspaces for debugging:

```typescript
const manager = new WorkspaceManager({
  preservation: {
    preserveOnFailure: true,
    failureRetentionDays: 7
  }
});

// Operation fails - workspace automatically preserved
await manager.withWorkspace(
  { repositoryUrl: 'https://github.com/user/repo.git' },
  async (workspace) => {
    throw new Error('Something went wrong');
  }
);

// Workspace preserved with error metadata
// Excluded from LRU eviction for 7 days
// Automatically cleaned up after retention period
```

**Manual Preservation:**

```typescript
// Preserve specific workspace indefinitely
const workspace = await getWorkspace({
  repositoryUrl: 'https://github.com/user/repo.git',
  preserve: {
    enabled: true,
    reason: 'debugging feature X',
    retentionDays: null // Indefinite
  }
});
```

### 4. Error Handling and Retry

Automatic retry for transient failures:

```typescript
const manager = new WorkspaceManager({
  errorHandling: {
    maxRetries: 3,
    initialRetryDelay: 1000,
    maxRetryDelay: 30000
  }
});

// Automatically retries on network errors
const workspace = await manager.getWorkspace({
  repositoryUrl: 'https://github.com/user/repo.git'
});
```

**Structured Errors:**

```typescript
import { CloneError, UpdateError } from './errors.js';

try {
  await manager.getWorkspace({
    repositoryUrl: 'https://github.com/invalid/repo.git'
  });
} catch (error) {
  if (error instanceof CloneError) {
    console.log('Clone failed:', error.message);
    console.log('Recoverable:', error.recoverable);
    console.log('Suggestion:', error.suggestion);
  }
}
```

## Advanced Usage

### Lifecycle Management

For long-running applications with background cleanup:

```typescript
import { WorkspaceManager } from './workspace-manager.js';

// Create manager with background cleanup
const manager = new WorkspaceManager({
  cleanup: {
    timing: 'background',
    backgroundInterval: 600000 // 10 minutes
  }
});

// Start background job
manager.start();

// Your application runs...

// Cleanup on shutdown
process.on('SIGTERM', () => {
  manager.stop();
  process.exit(0);
});
```

### Configuration Updates

Update configuration at runtime:

```typescript
const manager = new WorkspaceManager();

// Update specific settings
manager.updateConfig({
  cache: {
    maxWorkspaces: 20 // Increase cache size
  }
});

// Get current configuration
const config = manager.getConfig();
console.log('Max workspaces:', config.cache.maxWorkspaces);
```

### Singleton Pattern

Use the default manager instance:

```typescript
import {
  getDefaultWorkspaceManager,
  getWorkspace,
  withWorkspace
} from './workspace-manager.js';

// These functions use a shared default instance
const ws1 = await getWorkspace({ repositoryUrl: '...' });
const ws2 = await withWorkspace({ repositoryUrl: '...' }, async (ws) => {
  // ...
});

// Access the default instance directly
const manager = getDefaultWorkspaceManager();
manager.updateConfig({ ... });
```

## Integration Points

### With Existing Code

The workspace manager provides backward-compatible interfaces:

```typescript
// Old approach (still works)
import { getWorkspace as getHybridWorkspace } from './hybrid-workspace.js';

// New unified approach
import { getWorkspace } from './workspace-manager.js';

// Both return compatible result types
const workspace = await getWorkspace({
  repositoryUrl: 'https://github.com/user/repo.git'
});
```

### With Error Handling

All operations are wrapped with structured error handling:

```typescript
import { WorkspaceError, isRecoverable } from './errors.js';

try {
  await manager.getWorkspace({ repositoryUrl: '...' });
} catch (error) {
  if (error instanceof WorkspaceError) {
    console.log('Category:', error.category);
    console.log('Recoverable:', error.recoverable);
    console.log('Suggestion:', error.suggestion);

    if (isRecoverable(error)) {
      // Retry was already attempted
      // Consider fallback strategy
    }
  }
}
```

### With Cleanup Timing

Cleanup integrates with preservation:

```typescript
// Cleanup timing strategies respect preservation
const manager = new WorkspaceManager({
  cleanup: {
    timing: 'deferred' // Non-blocking
  },
  preservation: {
    preserveOnFailure: true
  }
});

// Failed workspace is preserved
// Cleanup skips preserved workspaces
// Retention expiration re-enables cleanup
```

## Performance Characteristics

### Cache Hit vs Miss

| Operation | First Access (Miss) | Subsequent Access (Hit) | Improvement |
|-----------|-------------------|----------------------|-------------|
| Small repo (~10MB) | ~1.5s | ~0.7s | 2.1x faster |
| Medium repo (~50MB) | ~5s | ~1.2s | 4.2x faster |
| Large repo (~500MB) | ~15s | ~1.5s | **10x faster** |

### Cleanup Timing Impact

| Strategy | Blocking Time | Total Cleanup | Use Case |
|----------|--------------|--------------|----------|
| Immediate | 50-250ms | Same as blocking | Simple apps, strict limits |
| Deferred | 0ms (async) | 50-250ms background | **Recommended for dev** |
| Background | 0ms (periodic) | Periodic cycles | Production services |

### Memory and Disk Usage

- **Memory**: ~10-50MB per WorkspaceManager instance (minimal overhead)
- **Disk**: Configurable via `maxWorkspaces` and `maxPreservedTotalSize`
- **Default limits**: ~1-5GB for cache, ~5GB for preservation

## Troubleshooting

### High Disk Usage

```typescript
// Reduce cache size
manager.updateConfig({
  cache: {
    maxWorkspaces: 5 // Reduce from default 10
  },
  preservation: {
    maxPreservedWorkspaces: 2,
    maxPreservedTotalSize: 2 * 1024 * 1024 * 1024 // 2GB
  }
});
```

### Slow Workspace Access

```typescript
// Use deferred cleanup for non-blocking operations
manager.updateConfig({
  cleanup: {
    timing: 'deferred'
  }
});
```

### Too Many Retries

```typescript
// Reduce retry attempts
manager.updateConfig({
  errorHandling: {
    maxRetries: 1 // Fail faster
  }
});
```

### Workspaces Not Being Evicted

Check preservation status:
1. Preserved workspaces are excluded from LRU eviction
2. Check retention periods haven't expired
3. Verify cleanup timing is appropriate

```typescript
// Enable logging to debug
manager.updateConfig({
  preservation: {
    logPreservationEvents: true
  }
});
```

## Migration Guide

### From hybrid-workspace.ts

```typescript
// Old code
import { getWorkspace } from './hybrid-workspace.js';

const workspace = await getWorkspace({
  repositoryUrl: 'https://github.com/user/repo.git',
  config: {
    sizeThreshold: 100 * 1024 * 1024,
    maxWorkspaces: 10
  }
});

// New code (drop-in replacement)
import { getWorkspace } from './workspace-manager.js';

const workspace = await getWorkspace({
  repositoryUrl: 'https://github.com/user/repo.git',
  config: {
    cache: {
      sizeThreshold: 100 * 1024 * 1024,
      maxWorkspaces: 10
    }
  }
});
```

### From cleanup-timing.ts

```typescript
// Old code
import { immediateCleanup } from './cleanup-timing.js';
await immediateCleanup(config);

// New code (handled automatically)
const manager = new WorkspaceManager({
  cleanup: {
    timing: 'immediate'
  }
});
// Cleanup happens automatically on getWorkspace()
```

## Best Practices

### 1. Use Environment Presets

```typescript
import { getEnvironmentConfig } from './config.js';

const env = process.env.NODE_ENV || 'development';
const config = getEnvironmentConfig(env as any);
const manager = new WorkspaceManager(config);
```

### 2. Enable Preservation in Development

```typescript
const manager = new WorkspaceManager({
  preservation: {
    preserveOnFailure: true,
    failureRetentionDays: 7,
    logPreservationEvents: true
  }
});
```

### 3. Use Deferred Cleanup for Better UX

```typescript
const manager = new WorkspaceManager({
  cleanup: {
    timing: 'deferred' // Non-blocking
  }
});
```

### 4. Disable Preservation in Production

```typescript
const manager = new WorkspaceManager({
  preservation: {
    preserveOnFailure: false, // No preservation in prod
    maxPreservedWorkspaces: 0
  }
});
```

### 5. Handle Errors Gracefully

```typescript
import { WorkspaceError } from './errors.js';

try {
  await manager.getWorkspace({ repositoryUrl: '...' });
} catch (error) {
  if (error instanceof WorkspaceError) {
    // Handle workspace-specific errors
    console.error(error.suggestion);
  } else {
    // Handle other errors
    throw error;
  }
}
```

## API Reference

See the TypeScript interfaces in:
- `config.ts` - Configuration interfaces and defaults
- `workspace-manager.ts` - Main WorkspaceManager class
- `errors.ts` - Error types and utilities

## See Also

- [Persistent Cache Design](./persistent-cache-design.md)
- [Cleanup Timing Design](./cleanup-timing-design.md)
- [Workspace Preservation Policy](./workspace-preservation-policy.md)
- [Integration Validation](./workspace-integration-validation.md)
