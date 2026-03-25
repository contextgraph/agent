/**
 * Repository URL canonicalization and validation utilities.
 *
 * Ensures GitHub repository URLs follow a consistent format:
 * - Standard HTTPS format: https://github.com/owner/repo
 * - No .git suffix
 * - No trailing slashes
 * - No tree/branch paths
 * - No placeholder or invalid URLs
 */

/**
 * Parse GitHub repository owner and name from a URL.
 */
function parseGitHubRepoFromUrl(url: string | null | undefined): { owner?: string; repo?: string } {
  if (!url) return {};
  const match = url.match(/github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/|$)/i);
  if (!match) return {};
  return {
    owner: match[1],
    repo: match[2],
  };
}

/**
 * Canonicalize a GitHub repository URL to standard format.
 *
 * @param url - The repository URL to canonicalize
 * @returns The canonical URL in format: https://github.com/owner/repo
 */
export function canonicalizeGitHubRepositoryUrl(url: string): string {
  const trimmed = url.trim();
  const parsed = parseGitHubRepoFromUrl(trimmed);

  if (parsed.owner && parsed.repo) {
    return `https://github.com/${parsed.owner}/${parsed.repo}`;
  }

  // Fallback: remove .git suffix and trailing slashes
  return trimmed.replace(/\.git\/?$/i, '').replace(/\/+$/, '');
}

/**
 * Validation result for a repository URL.
 */
export interface RepositoryUrlValidation {
  isValid: boolean;
  isCanonical: boolean;
  canonicalUrl?: string;
  violations: string[];
}

/**
 * Validate a repository URL and check if it's in canonical format.
 *
 * @param url - The repository URL to validate
 * @returns Validation result with violations and canonical form
 */
export function validateRepositoryUrl(url: string | null | undefined): RepositoryUrlValidation {
  const violations: string[] = [];

  if (url === null || url === undefined) {
    return {
      isValid: false,
      isCanonical: false,
      violations: ['URL is null or undefined'],
    };
  }

  const trimmed = url.trim();

  if (trimmed === '') {
    return {
      isValid: false,
      isCanonical: false,
      violations: ['URL is empty'],
    };
  }

  // Check for placeholder URLs
  if (
    trimmed.includes('example.com') ||
    trimmed.includes('placeholder') ||
    trimmed === 'https://github.com/owner/repo'
  ) {
    violations.push('Placeholder URL detected');
  }

  // Check for .git suffix
  if (/\.git\/?$/i.test(trimmed)) {
    violations.push('Contains .git suffix');
  }

  // Check for trailing slashes (but allow single trailing slash after .git)
  if (trimmed.endsWith('/') && !trimmed.endsWith('.git/')) {
    violations.push('Contains trailing slash');
  }

  // Check for tree/branch paths
  if (/\/tree\/|\/blob\/|\/commit\/|\/pull\//i.test(trimmed)) {
    violations.push('Contains tree/branch/commit/pull path');
  }

  // Check for non-root GitHub paths (3+ path segments after domain)
  const githubMatch = trimmed.match(/github\.com\/([^/\s]+)\/([^/\s]+)\/(.+)/i);
  if (githubMatch && githubMatch[3] && !githubMatch[3].match(/^\.git\/?$/)) {
    violations.push('Contains non-root path');
  }

  // Parse to get canonical form
  const parsed = parseGitHubRepoFromUrl(trimmed);

  if (!parsed.owner || !parsed.repo) {
    violations.push('Could not parse owner/repo from URL');
    return {
      isValid: false,
      isCanonical: false,
      violations,
    };
  }

  const canonicalUrl = `https://github.com/${parsed.owner}/${parsed.repo}`;
  const isCanonical = trimmed === canonicalUrl;

  return {
    isValid: violations.length === 0,
    isCanonical,
    canonicalUrl,
    violations,
  };
}

/**
 * Check if a URL is a valid GitHub repository URL.
 *
 * @param url - The URL to check
 * @returns True if the URL is a valid GitHub repository URL
 */
export function isGitHubRepositoryUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const parsed = parseGitHubRepoFromUrl(url);
  return Boolean(parsed.owner && parsed.repo);
}
