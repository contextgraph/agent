#!/usr/bin/env node
/**
 * Audit repository URLs in the codebase for canonicalization violations.
 *
 * This script scans test files, source code, and documentation for GitHub
 * repository URLs that don't follow the canonical format:
 * https://github.com/owner/repo
 *
 * It detects:
 * - .git suffixes
 * - Trailing slashes
 * - Tree/branch/blob paths
 * - Placeholder URLs
 * - Non-root paths
 */

import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { validateRepositoryUrl } from '../src/utils/repository-url.js';
import { glob } from 'glob';

interface UrlViolation {
  file: string;
  line: number;
  url: string;
  violations: string[];
  canonicalUrl?: string;
}

/**
 * Extract GitHub URLs from a file's content.
 */
function extractGitHubUrls(content: string): Array<{ url: string; line: number }> {
  const urls: Array<{ url: string; line: number }> = [];
  const lines = content.split('\n');

  // Match various GitHub URL patterns
  const patterns = [
    // Standard HTTPS URLs
    /https:\/\/github\.com\/[^\s"'`]+/gi,
    // SSH URLs
    /git@github\.com:[^\s"'`]+/gi,
  ];

  lines.forEach((lineText, index) => {
    patterns.forEach((pattern) => {
      const matches = Array.from(lineText.matchAll(pattern));
      matches.forEach((match) => {
        let url = match[0];
        // Clean up common trailing characters
        url = url.replace(/[,;:.)}\]]+$/, '');
        urls.push({ url, line: index + 1 });
      });
    });
  });

  return urls;
}

/**
 * Scan a file for repository URL violations.
 */
function scanFile(filePath: string, rootDir: string): UrlViolation[] {
  const violations: UrlViolation[] = [];

  try {
    const content = readFileSync(filePath, 'utf-8');
    const urls = extractGitHubUrls(content);

    for (const { url, line } of urls) {
      const validation = validateRepositoryUrl(url);

      if (!validation.isCanonical) {
        violations.push({
          file: relative(rootDir, filePath),
          line,
          url,
          violations: validation.violations,
          canonicalUrl: validation.canonicalUrl,
        });
      }
    }
  } catch (error) {
    console.error(`Error scanning ${filePath}:`, error);
  }

  return violations;
}

/**
 * Main audit function.
 */
async function auditRepositoryUrls() {
  const rootDir = join(process.cwd());

  console.log('Auditing repository URLs for canonicalization violations...\n');

  // Scan source files, tests, and documentation
  const patterns = [
    'src/**/*.ts',
    '__tests__/**/*.ts',
    'docs/**/*.md',
    '*.md',
    'examples/**/*.ts',
  ];

  const allViolations: UrlViolation[] = [];

  for (const pattern of patterns) {
    const files = await glob(pattern, { cwd: rootDir, absolute: true });

    for (const file of files) {
      const violations = scanFile(file, rootDir);
      allViolations.push(...violations);
    }
  }

  // Group violations by type
  const violationsByType = new Map<string, UrlViolation[]>();

  for (const violation of allViolations) {
    for (const type of violation.violations) {
      if (!violationsByType.has(type)) {
        violationsByType.set(type, []);
      }
      violationsByType.get(type)!.push(violation);
    }
  }

  // Report findings
  if (allViolations.length === 0) {
    console.log('✓ No repository URL violations found!\n');
    return;
  }

  console.log(`Found ${allViolations.length} repository URL violations:\n`);

  // Report by violation type
  Array.from(violationsByType.entries()).forEach(([type, violations]) => {
    console.log(`\n${type} (${violations.length} instances):`);
    console.log('─'.repeat(80));

    // Deduplicate by URL for cleaner output
    const uniqueUrls = new Map<string, UrlViolation>();
    violations.forEach((v) => {
      if (!uniqueUrls.has(v.url)) {
        uniqueUrls.set(v.url, v);
      }
    });

    Array.from(uniqueUrls.values()).forEach((violation) => {
      console.log(`  ${violation.file}:${violation.line}`);
      console.log(`    Current:   ${violation.url}`);
      if (violation.canonicalUrl) {
        console.log(`    Canonical: ${violation.canonicalUrl}`);
      }
      console.log();
    });
  });

  console.log('\nSummary:');
  console.log('─'.repeat(80));
  Array.from(violationsByType.entries()).forEach(([type, violations]) => {
    console.log(`  ${type}: ${violations.length}`);
  });

  console.log(`\nTotal violations: ${allViolations.length}`);
  console.log('\nNote: Many test file URLs may be intentionally non-canonical for testing purposes.');
  console.log('Focus on violations in production code and documentation.\n');
}

// Run audit
auditRepositoryUrls().catch((error) => {
  console.error('Audit failed:', error);
  process.exit(1);
});
