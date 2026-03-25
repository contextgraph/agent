# Repository URL Validation

This document describes the repository URL canonicalization and validation utilities introduced to maintain data quality across the codebase.

## Problem

Repository URLs can appear in many forms:
- `https://github.com/owner/repo`
- `https://github.com/owner/repo.git`
- `https://github.com/owner/repo/`
- `https://github.com/owner/repo/tree/main`
- `git@github.com:owner/repo.git`

These variants represent the same repository but create downstream problems:
- Deduplication failures (same repo treated as different entities)
- Authentication credential loss when URLs don't match
- Inconsistent behavior in git operations
- Debugging friction from non-standard formats

## Solution

The `src/utils/repository-url.ts` module provides:

### 1. Canonicalization Function

```typescript
canonicalizeGitHubRepositoryUrl(url: string): string
```

Converts any GitHub repository URL to the canonical format:
```
https://github.com/owner/repo
```

- Removes `.git` suffixes
- Removes trailing slashes
- Strips tree/branch/blob paths
- Handles SSH URLs
- Trims whitespace

### 2. Validation Function

```typescript
validateRepositoryUrl(url: string | null | undefined): RepositoryUrlValidation
```

Checks if a URL matches the canonical format and reports violations:

```typescript
interface RepositoryUrlValidation {
  isValid: boolean;
  isCanonical: boolean;
  canonicalUrl?: string;
  violations: string[];
}
```

Detected violations:
- `.git` suffix
- Trailing slashes
- Tree/branch/commit/pull paths
- Non-root paths
- Placeholder URLs
- Unparseable URLs

### 3. Type Guard

```typescript
isGitHubRepositoryUrl(url: string | null | undefined): boolean
```

Checks if a string is a valid GitHub repository URL.

## Usage

### Enforce Canonical Format

```typescript
import { canonicalizeGitHubRepositoryUrl } from './utils/repository-url.js';

// Before storing or using a repo URL
const canonicalUrl = canonicalizeGitHubRepositoryUrl(userInput);
```

### Validate Existing URLs

```typescript
import { validateRepositoryUrl } from './utils/repository-url.js';

const validation = validateRepositoryUrl(storedUrl);

if (!validation.isCanonical) {
  console.warn('Non-canonical URL detected:', validation.violations);
  console.log('Should be:', validation.canonicalUrl);
}
```

## Audit Script

The `scripts/audit-repository-urls.ts` script scans the codebase for repository URL violations:

```bash
npm run build
node dist/scripts/audit-repository-urls.js
```

This script:
- Scans source code, tests, and documentation
- Detects all GitHub URLs
- Reports violations by type
- Suggests canonical replacements

## Testing

Comprehensive test coverage in `__tests__/utils/repository-url.test.ts`:

```bash
npm test -- __tests__/utils/repository-url.test.ts
```

Tests cover:
- Canonicalization of various URL formats
- Validation detection of all violation types
- Edge cases (null, empty, malformed URLs)
- Type guard behavior

## Integration Points

Consider using these utilities at:

1. **API Boundaries**: Validate/canonicalize URLs from external sources
2. **Database Writes**: Enforce canonical format before storage
3. **Repository Deduplication**: Use canonical form as the dedup key
4. **Git Operations**: Ensure consistent URL format for authentication
5. **Data Migrations**: One-time cleanup of historical URLs

## Background

This utility was introduced to support the repository URL canonicalization enforcement added in the steward workflow (PR #59). While that PR prevents future dirty URLs, this utility enables:

1. **Auditing**: Find pre-canonicalization violations in historical data
2. **Migration**: Systematic cleanup of existing URLs
3. **Validation**: Runtime enforcement at all write boundaries
4. **Prevention**: Block new violations at API entry points

## See Also

- Test suite: `__tests__/utils/repository-url.test.ts`
- Audit script: `scripts/audit-repository-urls.ts`
- Steward workflow integration: `src/workflows/steward-step.ts`
