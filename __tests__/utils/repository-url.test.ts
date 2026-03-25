import { describe, expect, it } from '@jest/globals';
import {
  canonicalizeGitHubRepositoryUrl,
  validateRepositoryUrl,
  isGitHubRepositoryUrl,
} from '../../src/utils/repository-url.js';

describe('canonicalizeGitHubRepositoryUrl', () => {
  it('returns canonical URL for already-canonical URLs', () => {
    expect(canonicalizeGitHubRepositoryUrl('https://github.com/contextgraph/agent')).toBe(
      'https://github.com/contextgraph/agent'
    );
  });

  it('removes .git suffix', () => {
    expect(canonicalizeGitHubRepositoryUrl('https://github.com/contextgraph/agent.git')).toBe(
      'https://github.com/contextgraph/agent'
    );
  });

  it('removes trailing slash', () => {
    expect(canonicalizeGitHubRepositoryUrl('https://github.com/contextgraph/agent/')).toBe(
      'https://github.com/contextgraph/agent'
    );
  });

  it('removes .git suffix and trailing slash', () => {
    expect(canonicalizeGitHubRepositoryUrl('https://github.com/contextgraph/agent.git/')).toBe(
      'https://github.com/contextgraph/agent'
    );
  });

  it('canonicalizes tree paths to root', () => {
    expect(
      canonicalizeGitHubRepositoryUrl('https://github.com/contextgraph/agent/tree/main')
    ).toBe('https://github.com/contextgraph/agent');
  });

  it('canonicalizes blob paths to root', () => {
    expect(
      canonicalizeGitHubRepositoryUrl('https://github.com/contextgraph/agent/blob/main/README.md')
    ).toBe('https://github.com/contextgraph/agent');
  });

  it('handles SSH URLs', () => {
    expect(canonicalizeGitHubRepositoryUrl('git@github.com:contextgraph/agent.git')).toBe(
      'https://github.com/contextgraph/agent'
    );
  });

  it('trims whitespace', () => {
    expect(canonicalizeGitHubRepositoryUrl('  https://github.com/contextgraph/agent  ')).toBe(
      'https://github.com/contextgraph/agent'
    );
  });
});

describe('validateRepositoryUrl', () => {
  it('validates canonical URLs', () => {
    const result = validateRepositoryUrl('https://github.com/contextgraph/agent');
    expect(result.isValid).toBe(true);
    expect(result.isCanonical).toBe(true);
    expect(result.canonicalUrl).toBe('https://github.com/contextgraph/agent');
    expect(result.violations).toEqual([]);
  });

  it('detects .git suffix violation', () => {
    const result = validateRepositoryUrl('https://github.com/contextgraph/agent.git');
    expect(result.isValid).toBe(false);
    expect(result.isCanonical).toBe(false);
    expect(result.canonicalUrl).toBe('https://github.com/contextgraph/agent');
    expect(result.violations).toContain('Contains .git suffix');
  });

  it('detects trailing slash violation', () => {
    const result = validateRepositoryUrl('https://github.com/contextgraph/agent/');
    expect(result.isValid).toBe(false);
    expect(result.isCanonical).toBe(false);
    expect(result.violations).toContain('Contains trailing slash');
  });

  it('detects tree path violation', () => {
    const result = validateRepositoryUrl('https://github.com/contextgraph/agent/tree/main');
    expect(result.isValid).toBe(false);
    expect(result.isCanonical).toBe(false);
    expect(result.violations).toContain('Contains tree/branch/commit/pull path');
    expect(result.violations).toContain('Contains non-root path');
  });

  it('detects blob path violation', () => {
    const result = validateRepositoryUrl(
      'https://github.com/contextgraph/agent/blob/main/README.md'
    );
    expect(result.isValid).toBe(false);
    expect(result.violations).toContain('Contains tree/branch/commit/pull path');
    expect(result.violations).toContain('Contains non-root path');
  });

  it('detects placeholder URLs', () => {
    const result = validateRepositoryUrl('https://github.com/owner/repo');
    expect(result.isValid).toBe(false);
    expect(result.violations).toContain('Placeholder URL detected');
  });

  it('detects example.com placeholder', () => {
    const result = validateRepositoryUrl('https://example.com/repo');
    expect(result.isValid).toBe(false);
    expect(result.violations).toContain('Placeholder URL detected');
  });

  it('rejects null URLs', () => {
    const result = validateRepositoryUrl(null);
    expect(result.isValid).toBe(false);
    expect(result.isCanonical).toBe(false);
    expect(result.violations).toContain('URL is null or undefined');
  });

  it('rejects empty URLs', () => {
    const result = validateRepositoryUrl('');
    expect(result.isValid).toBe(false);
    expect(result.violations).toContain('URL is empty');
  });

  it('rejects unparseable URLs', () => {
    const result = validateRepositoryUrl('not-a-url');
    expect(result.isValid).toBe(false);
    expect(result.violations).toContain('Could not parse owner/repo from URL');
  });

  it('allows .git/ suffix (common in some contexts)', () => {
    const result = validateRepositoryUrl('https://github.com/contextgraph/agent.git/');
    expect(result.violations).toContain('Contains .git suffix');
    // Note: .git/ is still a violation because it's not canonical
  });
});

describe('isGitHubRepositoryUrl', () => {
  it('returns true for valid GitHub URLs', () => {
    expect(isGitHubRepositoryUrl('https://github.com/contextgraph/agent')).toBe(true);
    expect(isGitHubRepositoryUrl('https://github.com/contextgraph/agent.git')).toBe(true);
    expect(isGitHubRepositoryUrl('git@github.com:contextgraph/agent.git')).toBe(true);
  });

  it('returns false for non-GitHub URLs', () => {
    expect(isGitHubRepositoryUrl('https://gitlab.com/user/repo')).toBe(false);
    expect(isGitHubRepositoryUrl('https://example.com')).toBe(false);
    expect(isGitHubRepositoryUrl('not-a-url')).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isGitHubRepositoryUrl(null)).toBe(false);
    expect(isGitHubRepositoryUrl(undefined)).toBe(false);
  });
});
