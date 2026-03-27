# Configuration Path Audit

## Problem

Configuration files often reference directories via path patterns (globs, includes, excludes). When directories are deleted or renamed during refactoring, these configuration entries can become stale without being noticed. This creates technical debt that accumulates silently:

- IDE tooling may behave incorrectly
- Build tools may warn about missing paths
- New team members get confused by references to non-existent code
- The signal-to-noise ratio in config files degrades

**Example:** The `triggerdev-docker-spike` exclusion persisted for 6 months after the directory was deleted, discovered only by manual inspection.

## Solution

The `scripts/audit-config-paths.sh` script provides systematic auditing of configuration file path references against the actual filesystem structure.

### Files Audited

1. **tsconfig.json**
   - `include` patterns
   - `exclude` patterns (with special handling for build artifacts like `node_modules`, `dist`)

2. **jest.config.js** (if present)
   - `testMatch` patterns
   - `collectCoverageFrom` patterns

3. **eslint.config.js** (if present)
   - `ignorePatterns` (flagged for manual review)

### Usage

```bash
# Run from repository root
./scripts/audit-config-paths.sh

# Exit codes:
# 0 = all path references are valid
# 1 = stale references found
```

### Example Output

```
=== Config Path Audit ===
Repository: agent

📋 Auditing tsconfig.json...
  ✓ include: src/**/*
  ✓ exclude: node_modules (build artifact, OK to not exist)
  ✓ exclude: dist (build artifact, OK to not exist)

📋 Auditing jest.config.js...
  ✓ testMatch: **/__tests__/**/*.test.ts
  ✓ collectCoverageFrom: src/**/*.ts

=== Audit Complete ===
✅ No stale path references found
```

If stale references are found:

```
📋 Auditing tsconfig.json...
  ✓ include: src/**/*
  ❌ STALE: exclude pattern 'triggerdev-docker-spike' references missing path 'triggerdev-docker-spike'

=== Audit Complete ===
❌ Found 1 stale path reference(s)

Recommendation: Remove stale configuration entries to prevent confusion
```

### Integration

This script can be:
1. **Run manually** during periodic codebase health checks
2. **Added to CI** as a non-blocking check that reports warnings
3. **Run before major refactors** to establish a clean baseline
4. **Applied to other contextgraph repositories** with minimal modification

### Limitations

- Requires `jq` for JSON parsing (gracefully degrades if not available)
- ESLint config parsing is simplified and flags patterns for manual review
- Does not validate file-level references within configs (only directory-level)
- Build artifact directories (node_modules, dist, build) are intentionally excluded from staleness checks

### Maintenance

When adding new configuration files to the repository that contain path references, consider extending this script to audit them as well.

## Lesson Learned

> "Config entries outlive their referenced artifacts" — Codebase Pruning steward brief

This audit script addresses the documented pattern where configuration management lags behind code structure changes. By making the audit systematic rather than reactive, we convert ad-hoc discovery into preventive maintenance.
