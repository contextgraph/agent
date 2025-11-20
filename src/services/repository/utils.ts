/**
 * Repository utility functions for URL parsing and validation.
 *
 * Provides utilities to validate, parse, and normalize git repository URLs
 * across different formats (HTTPS, SSH, git://) and providers (GitHub, GitLab, etc.).
 */

/**
 * Git URL protocol types
 */
export type GitProtocol = 'https' | 'ssh' | 'git';

/**
 * Repository information extracted from a git URL
 */
export interface RepoInfo {
  /** Git hosting service (e.g., github.com, gitlab.com) */
  host: string;
  /** Repository owner or organization */
  owner: string;
  /** Repository name (without .git suffix) */
  repo: string;
  /** Protocol used (https, ssh, or git) */
  protocol: GitProtocol;
}

/**
 * Regular expressions for matching different git URL formats
 */
const GIT_URL_PATTERNS = {
  // HTTPS: https://github.com/owner/repo.git or https://github.com/owner/repo
  https: /^https:\/\/([^\/]+)\/([^\/]+)\/([^\/]+?)(\.git)?$/,

  // SSH: git@github.com:owner/repo.git or git@github.com:owner/repo
  ssh: /^git@([^:]+):([^\/]+)\/([^\/]+?)(\.git)?$/,

  // Git protocol: git://github.com/owner/repo.git or git://github.com/owner/repo
  git: /^git:\/\/([^\/]+)\/([^\/]+)\/([^\/]+?)(\.git)?$/,
};

/**
 * Validates whether a string is a valid git repository URL.
 *
 * Supports HTTPS, SSH, and git:// protocols across GitHub, GitLab, and other git hosts.
 * Accepts URLs with or without the .git suffix.
 *
 * @param url - The URL to validate
 * @returns true if the URL is a valid git repository URL, false otherwise
 *
 * @example
 * isGitRepository('https://github.com/user/repo.git'); // true
 * isGitRepository('git@github.com:user/repo.git'); // true
 * isGitRepository('git://gitlab.com/user/repo'); // true
 * isGitRepository('not-a-git-url'); // false
 */
export function isGitRepository(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }

  // Check if URL matches any of our git URL patterns
  return Object.values(GIT_URL_PATTERNS).some(pattern => pattern.test(url));
}

/**
 * Extracts repository information from a git URL.
 *
 * Parses the host, owner, repository name, and protocol from various git URL formats.
 * Throws an error if the URL is invalid.
 *
 * @param url - The git URL to parse
 * @returns Repository information including host, owner, repo name, and protocol
 * @throws Error if the URL is not a valid git repository URL
 *
 * @example
 * extractRepoInfo('https://github.com/user/repo.git');
 * // Returns: { host: 'github.com', owner: 'user', repo: 'repo', protocol: 'https' }
 *
 * @example
 * extractRepoInfo('git@gitlab.com:group/project.git');
 * // Returns: { host: 'gitlab.com', owner: 'group', repo: 'project', protocol: 'ssh' }
 */
export function extractRepoInfo(url: string): RepoInfo {
  if (!isGitRepository(url)) {
    throw new Error(`Invalid git repository URL: ${url}`);
  }

  // Try matching against each pattern
  for (const [protocol, pattern] of Object.entries(GIT_URL_PATTERNS)) {
    const match = url.match(pattern);
    if (match) {
      const [, host, owner, repo] = match;
      return {
        host,
        owner,
        repo: repo.replace(/\.git$/, ''), // Remove .git suffix if present
        protocol: protocol as GitProtocol,
      };
    }
  }

  // This should never happen since isGitRepository already validated
  throw new Error(`Failed to parse git repository URL: ${url}`);
}

/**
 * Normalizes a git repository URL to a consistent HTTPS format.
 *
 * Converts SSH and git:// URLs to HTTPS format, ensures .git suffix is present,
 * and standardizes the URL structure. Useful for consistent repository identification.
 *
 * @param url - The git URL to normalize
 * @returns Normalized HTTPS URL with .git suffix
 * @throws Error if the URL is not a valid git repository URL
 *
 * @example
 * normalizeRepoUrl('git@github.com:user/repo');
 * // Returns: 'https://github.com/user/repo.git'
 *
 * @example
 * normalizeRepoUrl('git://gitlab.com/group/project.git');
 * // Returns: 'https://gitlab.com/group/project.git'
 *
 * @example
 * normalizeRepoUrl('https://github.com/user/repo');
 * // Returns: 'https://github.com/user/repo.git'
 */
export function normalizeRepoUrl(url: string): string {
  const info = extractRepoInfo(url);

  // Convert to HTTPS format with .git suffix
  return `https://${info.host}/${info.owner}/${info.repo}.git`;
}
