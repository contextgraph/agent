/**
 * Tests for repository utility functions.
 *
 * Comprehensive unit tests for URL validation, parsing, and normalization
 * across different git URL formats (HTTPS, SSH, git://) and providers
 * (GitHub, GitLab, generic hosts).
 */

import {
  isGitRepository,
  extractRepoInfo,
  normalizeRepoUrl,
} from '../../src/services/repository/utils.js';

describe('repository utils', () => {
  describe('isGitRepository', () => {
    describe('valid HTTPS URLs', () => {
      it('should accept GitHub HTTPS URL with .git suffix', () => {
        expect(isGitRepository('https://github.com/user/repo.git')).toBe(true);
      });

      it('should accept GitHub HTTPS URL without .git suffix', () => {
        expect(isGitRepository('https://github.com/user/repo')).toBe(true);
      });

      it('should accept GitLab HTTPS URL', () => {
        expect(isGitRepository('https://gitlab.com/group/project.git')).toBe(true);
      });

      it('should accept custom domain HTTPS URL', () => {
        expect(isGitRepository('https://git.company.com/team/repo.git')).toBe(true);
      });
    });

    describe('valid SSH URLs', () => {
      it('should accept GitHub SSH URL with .git suffix', () => {
        expect(isGitRepository('git@github.com:user/repo.git')).toBe(true);
      });

      it('should accept GitHub SSH URL without .git suffix', () => {
        expect(isGitRepository('git@github.com:user/repo')).toBe(true);
      });

      it('should accept GitLab SSH URL', () => {
        expect(isGitRepository('git@gitlab.com:group/project.git')).toBe(true);
      });

      it('should accept custom domain SSH URL', () => {
        expect(isGitRepository('git@git.company.com:team/repo.git')).toBe(true);
      });
    });

    describe('valid git:// URLs', () => {
      it('should accept git protocol URL with .git suffix', () => {
        expect(isGitRepository('git://github.com/user/repo.git')).toBe(true);
      });

      it('should accept git protocol URL without .git suffix', () => {
        expect(isGitRepository('git://github.com/user/repo')).toBe(true);
      });

      it('should accept git protocol with custom domain', () => {
        expect(isGitRepository('git://git.company.com/team/repo.git')).toBe(true);
      });
    });

    describe('invalid URLs', () => {
      it('should reject non-git URL', () => {
        expect(isGitRepository('https://example.com')).toBe(false);
      });

      it('should reject empty string', () => {
        expect(isGitRepository('')).toBe(false);
      });

      it('should reject non-string input', () => {
        expect(isGitRepository(null as any)).toBe(false);
        expect(isGitRepository(undefined as any)).toBe(false);
        expect(isGitRepository(123 as any)).toBe(false);
      });

      it('should reject malformed URLs', () => {
        expect(isGitRepository('github.com/user/repo')).toBe(false);
        expect(isGitRepository('https://github.com')).toBe(false);
        expect(isGitRepository('git@github.com')).toBe(false);
      });

      it('should reject URLs with wrong structure', () => {
        expect(isGitRepository('https://github.com/user')).toBe(false);
        expect(isGitRepository('git@github.com:user')).toBe(false);
      });
    });
  });

  describe('extractRepoInfo', () => {
    describe('HTTPS URLs', () => {
      it('should parse GitHub HTTPS URL with .git', () => {
        const info = extractRepoInfo('https://github.com/facebook/react.git');
        expect(info).toEqual({
          host: 'github.com',
          owner: 'facebook',
          repo: 'react',
          protocol: 'https',
        });
      });

      it('should parse GitHub HTTPS URL without .git', () => {
        const info = extractRepoInfo('https://github.com/facebook/react');
        expect(info).toEqual({
          host: 'github.com',
          owner: 'facebook',
          repo: 'react',
          protocol: 'https',
        });
      });

      it('should parse GitLab HTTPS URL', () => {
        const info = extractRepoInfo('https://gitlab.com/gitlab-org/gitlab.git');
        expect(info).toEqual({
          host: 'gitlab.com',
          owner: 'gitlab-org',
          repo: 'gitlab',
          protocol: 'https',
        });
      });

      it('should parse custom domain HTTPS URL', () => {
        const info = extractRepoInfo('https://git.example.com/team/project.git');
        expect(info).toEqual({
          host: 'git.example.com',
          owner: 'team',
          repo: 'project',
          protocol: 'https',
        });
      });
    });

    describe('SSH URLs', () => {
      it('should parse GitHub SSH URL with .git', () => {
        const info = extractRepoInfo('git@github.com:facebook/react.git');
        expect(info).toEqual({
          host: 'github.com',
          owner: 'facebook',
          repo: 'react',
          protocol: 'ssh',
        });
      });

      it('should parse GitHub SSH URL without .git', () => {
        const info = extractRepoInfo('git@github.com:facebook/react');
        expect(info).toEqual({
          host: 'github.com',
          owner: 'facebook',
          repo: 'react',
          protocol: 'ssh',
        });
      });

      it('should parse GitLab SSH URL', () => {
        const info = extractRepoInfo('git@gitlab.com:gitlab-org/gitlab.git');
        expect(info).toEqual({
          host: 'gitlab.com',
          owner: 'gitlab-org',
          repo: 'gitlab',
          protocol: 'ssh',
        });
      });

      it('should parse custom domain SSH URL', () => {
        const info = extractRepoInfo('git@git.example.com:team/project.git');
        expect(info).toEqual({
          host: 'git.example.com',
          owner: 'team',
          repo: 'project',
          protocol: 'ssh',
        });
      });
    });

    describe('git:// URLs', () => {
      it('should parse git protocol URL with .git', () => {
        const info = extractRepoInfo('git://github.com/facebook/react.git');
        expect(info).toEqual({
          host: 'github.com',
          owner: 'facebook',
          repo: 'react',
          protocol: 'git',
        });
      });

      it('should parse git protocol URL without .git', () => {
        const info = extractRepoInfo('git://github.com/facebook/react');
        expect(info).toEqual({
          host: 'github.com',
          owner: 'facebook',
          repo: 'react',
          protocol: 'git',
        });
      });

      it('should parse custom domain git protocol URL', () => {
        const info = extractRepoInfo('git://git.example.com/team/project.git');
        expect(info).toEqual({
          host: 'git.example.com',
          owner: 'team',
          repo: 'project',
          protocol: 'git',
        });
      });
    });

    describe('edge cases', () => {
      it('should remove .git suffix from repo name', () => {
        const info = extractRepoInfo('https://github.com/user/repo.git');
        expect(info.repo).toBe('repo');
        expect(info.repo).not.toContain('.git');
      });

      it('should handle repo names with hyphens', () => {
        const info = extractRepoInfo('https://github.com/user/my-awesome-repo.git');
        expect(info.repo).toBe('my-awesome-repo');
      });

      it('should handle repo names with underscores', () => {
        const info = extractRepoInfo('https://github.com/user/my_repo_name.git');
        expect(info.repo).toBe('my_repo_name');
      });

      it('should handle owner names with hyphens', () => {
        const info = extractRepoInfo('https://github.com/my-org-name/repo.git');
        expect(info.owner).toBe('my-org-name');
      });
    });

    describe('error handling', () => {
      it('should throw for invalid URL', () => {
        expect(() => extractRepoInfo('not-a-git-url')).toThrow('Invalid git repository URL');
      });

      it('should throw for malformed URL', () => {
        expect(() => extractRepoInfo('https://github.com/user')).toThrow('Invalid git repository URL');
      });

      it('should throw for empty string', () => {
        expect(() => extractRepoInfo('')).toThrow('Invalid git repository URL');
      });

      it('should include the invalid URL in error message', () => {
        const badUrl = 'https://example.com';
        expect(() => extractRepoInfo(badUrl)).toThrow(badUrl);
      });
    });
  });

  describe('normalizeRepoUrl', () => {
    describe('SSH to HTTPS conversion', () => {
      it('should convert GitHub SSH to HTTPS', () => {
        const normalized = normalizeRepoUrl('git@github.com:user/repo.git');
        expect(normalized).toBe('https://github.com/user/repo.git');
      });

      it('should convert GitHub SSH without .git to HTTPS with .git', () => {
        const normalized = normalizeRepoUrl('git@github.com:user/repo');
        expect(normalized).toBe('https://github.com/user/repo.git');
      });

      it('should convert GitLab SSH to HTTPS', () => {
        const normalized = normalizeRepoUrl('git@gitlab.com:group/project.git');
        expect(normalized).toBe('https://gitlab.com/group/project.git');
      });

      it('should convert custom domain SSH to HTTPS', () => {
        const normalized = normalizeRepoUrl('git@git.example.com:team/repo.git');
        expect(normalized).toBe('https://git.example.com/team/repo.git');
      });
    });

    describe('git:// to HTTPS conversion', () => {
      it('should convert git protocol to HTTPS', () => {
        const normalized = normalizeRepoUrl('git://github.com/user/repo.git');
        expect(normalized).toBe('https://github.com/user/repo.git');
      });

      it('should convert git protocol without .git to HTTPS with .git', () => {
        const normalized = normalizeRepoUrl('git://github.com/user/repo');
        expect(normalized).toBe('https://github.com/user/repo.git');
      });
    });

    describe('HTTPS normalization', () => {
      it('should ensure .git suffix on HTTPS URL', () => {
        const normalized = normalizeRepoUrl('https://github.com/user/repo');
        expect(normalized).toBe('https://github.com/user/repo.git');
      });

      it('should preserve HTTPS URL with .git suffix', () => {
        const url = 'https://github.com/user/repo.git';
        const normalized = normalizeRepoUrl(url);
        expect(normalized).toBe(url);
      });

      it('should normalize GitLab HTTPS URL', () => {
        const normalized = normalizeRepoUrl('https://gitlab.com/group/project');
        expect(normalized).toBe('https://gitlab.com/group/project.git');
      });
    });

    describe('consistency', () => {
      it('should produce same output for different input formats', () => {
        const urls = [
          'https://github.com/user/repo.git',
          'https://github.com/user/repo',
          'git@github.com:user/repo.git',
          'git@github.com:user/repo',
          'git://github.com/user/repo.git',
          'git://github.com/user/repo',
        ];

        const normalized = urls.map(normalizeRepoUrl);
        const expected = 'https://github.com/user/repo.git';

        normalized.forEach(url => {
          expect(url).toBe(expected);
        });
      });

      it('should maintain consistency across providers', () => {
        const githubSSH = normalizeRepoUrl('git@github.com:user/repo.git');
        const gitlabSSH = normalizeRepoUrl('git@gitlab.com:user/repo.git');

        expect(githubSSH).toBe('https://github.com/user/repo.git');
        expect(gitlabSSH).toBe('https://gitlab.com/user/repo.git');
      });
    });

    describe('error handling', () => {
      it('should throw for invalid URL', () => {
        expect(() => normalizeRepoUrl('not-a-git-url')).toThrow('Invalid git repository URL');
      });

      it('should throw for malformed URL', () => {
        expect(() => normalizeRepoUrl('https://github.com/user')).toThrow('Invalid git repository URL');
      });
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete validation, extraction, normalization flow', () => {
      const url = 'git@github.com:facebook/react.git';

      // Validate
      expect(isGitRepository(url)).toBe(true);

      // Extract
      const info = extractRepoInfo(url);
      expect(info.owner).toBe('facebook');
      expect(info.repo).toBe('react');
      expect(info.protocol).toBe('ssh');

      // Normalize
      const normalized = normalizeRepoUrl(url);
      expect(normalized).toBe('https://github.com/facebook/react.git');

      // Normalized URL should also be valid
      expect(isGitRepository(normalized)).toBe(true);
    });

    it('should maintain data consistency across operations', () => {
      const originalUrl = 'git@gitlab.com:group/project';

      const info = extractRepoInfo(originalUrl);
      const normalized = normalizeRepoUrl(originalUrl);
      const reExtracted = extractRepoInfo(normalized);

      // Host, owner, and repo should be consistent
      expect(reExtracted.host).toBe(info.host);
      expect(reExtracted.owner).toBe(info.owner);
      expect(reExtracted.repo).toBe(info.repo);

      // Protocol should change to HTTPS
      expect(reExtracted.protocol).toBe('https');
    });
  });
});
