#!/usr/bin/env node
/**
 * Workspace Performance Benchmarking Script
 *
 * Measures performance of git operations across different repository sizes
 * to inform workspace management strategy decisions.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

interface TestRepo {
  name: string;
  url: string;
  size: 'small' | 'medium' | 'large';
  description: string;
}

interface BenchmarkResult {
  repo: string;
  size: string;
  operation: string;
  iterations: number[];
  average: number;
  min: number;
  max: number;
  diskUsage?: number;
}

// Test repositories representing different scales
const TEST_REPOS: TestRepo[] = [
  {
    name: 'is',
    url: 'https://github.com/sindresorhus/is',
    size: 'small',
    description: 'Simple npm package (~1MB)',
  },
  {
    name: 'lodash',
    url: 'https://github.com/lodash/lodash',
    size: 'medium',
    description: 'Popular utility library (~10-20MB)',
  },
  {
    name: 'typescript',
    url: 'https://github.com/microsoft/TypeScript',
    size: 'large',
    description: 'Large compiler project (~100MB+)',
  },
];

const ITERATIONS = 5;
const BENCHMARK_DIR = join(tmpdir(), 'workspace-benchmarks');

class WorkspaceBenchmark {
  private results: BenchmarkResult[] = [];

  /**
   * Execute a command and measure its execution time
   */
  private timeCommand(command: string, cwd?: string): number {
    const startTime = performance.now();
    try {
      execSync(command, {
        cwd,
        stdio: 'pipe',
        timeout: 300000, // 5 minute timeout
      });
      return performance.now() - startTime;
    } catch (error) {
      console.error(`Command failed: ${command}`);
      throw error;
    }
  }

  /**
   * Get directory size in bytes
   */
  private getDirSize(dirPath: string): number {
    let size = 0;
    const getAllFiles = (path: string): void => {
      if (!existsSync(path)) return;

      const stat = statSync(path);
      if (stat.isFile()) {
        size += stat.size;
      } else if (stat.isDirectory()) {
        try {
          const files = execSync(`find "${path}" -type f`, { encoding: 'utf8' })
            .trim()
            .split('\n')
            .filter(Boolean);

          files.forEach(file => {
            try {
              size += statSync(file).size;
            } catch (err) {
              // Skip files we can't read
            }
          });
        } catch (err) {
          // Skip directories we can't read
        }
      }
    };

    getAllFiles(dirPath);
    return size;
  }

  /**
   * Benchmark initial clone operation
   */
  private async benchmarkClone(repo: TestRepo): Promise<void> {
    console.log(`\n📦 Benchmarking clone: ${repo.name} (${repo.size})`);
    const iterations: number[] = [];

    for (let i = 0; i < ITERATIONS; i++) {
      const testDir = join(BENCHMARK_DIR, `clone-${repo.name}-${i}`);

      // Clean git cache for cold start
      execSync('git gc --prune=all 2>/dev/null || true', { stdio: 'pipe' });

      const duration = this.timeCommand(
        `git clone --depth 1 ${repo.url} ${testDir}`
      );

      iterations.push(duration);
      console.log(`  Iteration ${i + 1}/${ITERATIONS}: ${(duration / 1000).toFixed(2)}s`);

      // Clean up
      rmSync(testDir, { recursive: true, force: true });
    }

    this.results.push({
      repo: repo.name,
      size: repo.size,
      operation: 'clone (cold)',
      iterations,
      average: iterations.reduce((a, b) => a + b) / iterations.length,
      min: Math.min(...iterations),
      max: Math.max(...iterations),
    });
  }

  /**
   * Benchmark pull with no changes
   */
  private async benchmarkPullNoChanges(repo: TestRepo): Promise<void> {
    console.log(`\n🔄 Benchmarking pull (no changes): ${repo.name}`);
    const testDir = join(BENCHMARK_DIR, `pull-${repo.name}`);
    const iterations: number[] = [];

    // Setup: clone once
    execSync(`git clone --depth 1 ${repo.url} ${testDir}`, { stdio: 'pipe' });

    for (let i = 0; i < ITERATIONS; i++) {
      const duration = this.timeCommand('git pull', testDir);
      iterations.push(duration);
      console.log(`  Iteration ${i + 1}/${ITERATIONS}: ${(duration / 1000).toFixed(2)}s`);
    }

    // Measure disk usage
    const diskUsage = this.getDirSize(testDir);

    this.results.push({
      repo: repo.name,
      size: repo.size,
      operation: 'pull (no changes)',
      iterations,
      average: iterations.reduce((a, b) => a + b) / iterations.length,
      min: Math.min(...iterations),
      max: Math.max(...iterations),
      diskUsage,
    });

    // Clean up
    rmSync(testDir, { recursive: true, force: true });
  }

  /**
   * Benchmark concurrent clones
   */
  private async benchmarkConcurrentClones(repo: TestRepo): Promise<void> {
    console.log(`\n⚡ Benchmarking concurrent clones (3x): ${repo.name}`);
    const iterations: number[] = [];

    for (let i = 0; i < ITERATIONS; i++) {
      const startTime = performance.now();

      // Start 3 clones concurrently
      const promises = [0, 1, 2].map(j => {
        const testDir = join(BENCHMARK_DIR, `concurrent-${repo.name}-${i}-${j}`);
        return new Promise((resolve, reject) => {
          try {
            execSync(`git clone --depth 1 ${repo.url} ${testDir}`, { stdio: 'pipe' });
            resolve(testDir);
          } catch (error) {
            reject(error);
          }
        });
      });

      await Promise.all(promises);
      const duration = performance.now() - startTime;

      iterations.push(duration);
      console.log(`  Iteration ${i + 1}/${ITERATIONS}: ${(duration / 1000).toFixed(2)}s`);

      // Clean up
      [0, 1, 2].forEach(j => {
        const testDir = join(BENCHMARK_DIR, `concurrent-${repo.name}-${i}-${j}`);
        rmSync(testDir, { recursive: true, force: true });
      });
    }

    this.results.push({
      repo: repo.name,
      size: repo.size,
      operation: 'concurrent clone (3x)',
      iterations,
      average: iterations.reduce((a, b) => a + b) / iterations.length,
      min: Math.min(...iterations),
      max: Math.max(...iterations),
    });
  }

  /**
   * Run all benchmarks
   */
  async runBenchmarks(): Promise<void> {
    console.log('🚀 Starting workspace performance benchmarks...\n');
    console.log(`Test configuration:`);
    console.log(`  - Iterations per test: ${ITERATIONS}`);
    console.log(`  - Repositories: ${TEST_REPOS.map(r => r.name).join(', ')}`);
    console.log(`  - Benchmark directory: ${BENCHMARK_DIR}`);

    // Ensure clean benchmark directory
    if (existsSync(BENCHMARK_DIR)) {
      rmSync(BENCHMARK_DIR, { recursive: true, force: true });
    }
    mkdirSync(BENCHMARK_DIR, { recursive: true });

    try {
      for (const repo of TEST_REPOS) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Testing: ${repo.name} - ${repo.description}`);
        console.log('='.repeat(60));

        await this.benchmarkClone(repo);
        await this.benchmarkPullNoChanges(repo);
        await this.benchmarkConcurrentClones(repo);
      }

      this.generateReport();
    } finally {
      // Clean up benchmark directory
      if (existsSync(BENCHMARK_DIR)) {
        rmSync(BENCHMARK_DIR, { recursive: true, force: true });
      }
    }
  }

  /**
   * Generate markdown report
   */
  private generateReport(): void {
    console.log('\n\n' + '='.repeat(60));
    console.log('📊 BENCHMARK RESULTS');
    console.log('='.repeat(60));

    // Group results by repo
    const byRepo = new Map<string, BenchmarkResult[]>();
    this.results.forEach(result => {
      if (!byRepo.has(result.repo)) {
        byRepo.set(result.repo, []);
      }
      byRepo.get(result.repo)!.push(result);
    });

    let markdown = '# Workspace Performance Benchmarks\n\n';
    markdown += `**Date:** ${new Date().toISOString()}\n`;
    markdown += `**Iterations per test:** ${ITERATIONS}\n\n`;
    markdown += '## Summary\n\n';
    markdown += 'Performance measurements for git operations across different repository sizes.\n\n';

    // Summary table
    markdown += '## Results by Repository\n\n';

    for (const [repoName, results] of byRepo.entries()) {
      const repo = TEST_REPOS.find(r => r.name === repoName)!;
      markdown += `### ${repoName} (${repo.size})\n\n`;
      markdown += `*${repo.description}*\n\n`;
      markdown += '| Operation | Avg Time | Min | Max | Disk Usage |\n';
      markdown += '|-----------|----------|-----|-----|------------|\n';

      results.forEach(result => {
        const avgTime = (result.average / 1000).toFixed(2) + 's';
        const minTime = (result.min / 1000).toFixed(2) + 's';
        const maxTime = (result.max / 1000).toFixed(2) + 's';
        const disk = result.diskUsage
          ? (result.diskUsage / (1024 * 1024)).toFixed(2) + ' MB'
          : 'N/A';

        markdown += `| ${result.operation} | ${avgTime} | ${minTime} | ${maxTime} | ${disk} |\n`;
      });

      markdown += '\n';
    }

    // Analysis section
    markdown += '## Analysis\n\n';
    markdown += '### Key Findings\n\n';

    // Calculate clone time ratios
    const smallClone = this.results.find(r => r.size === 'small' && r.operation === 'clone (cold)');
    const mediumClone = this.results.find(r => r.size === 'medium' && r.operation === 'clone (cold)');
    const largeClone = this.results.find(r => r.size === 'large' && r.operation === 'clone (cold)');

    if (smallClone && mediumClone && largeClone) {
      markdown += '**Clone Performance:**\n';
      markdown += `- Small repos: ~${(smallClone.average / 1000).toFixed(1)}s average\n`;
      markdown += `- Medium repos: ~${(mediumClone.average / 1000).toFixed(1)}s average (${(mediumClone.average / smallClone.average).toFixed(1)}x slower)\n`;
      markdown += `- Large repos: ~${(largeClone.average / 1000).toFixed(1)}s average (${(largeClone.average / smallClone.average).toFixed(1)}x slower)\n\n`;
    }

    markdown += '**Pull Performance (no changes):**\n';
    const pullResults = this.results.filter(r => r.operation === 'pull (no changes)');
    pullResults.forEach(result => {
      markdown += `- ${result.repo}: ~${(result.average / 1000).toFixed(2)}s\n`;
    });
    markdown += '\n';

    markdown += '**Concurrent Operations:**\n';
    const concurrentResults = this.results.filter(r => r.operation.includes('concurrent'));
    concurrentResults.forEach(result => {
      markdown += `- ${result.repo}: ~${(result.average / 1000).toFixed(1)}s for 3 parallel clones\n`;
    });
    markdown += '\n';

    markdown += '### Recommendations\n\n';
    markdown += 'Based on these measurements:\n\n';
    markdown += '1. **Temporary workspaces** are suitable when:\n';
    markdown += '   - Repository is small to medium (<50MB)\n';
    markdown += '   - Clone time is acceptable (< 5-10 seconds)\n';
    markdown += '   - Operations are infrequent or one-off\n\n';
    markdown += '2. **Persistent workspaces** are better when:\n';
    markdown += '   - Repository is large (>50MB)\n';
    markdown += '   - Multiple operations expected on same repo\n';
    markdown += '   - Clone time significantly impacts user experience\n\n';
    markdown += '3. **Hybrid approach** considerations:\n';
    markdown += '   - Cache recently used repos in persistent storage\n';
    markdown += '   - Use temporary workspaces for first-time or rarely accessed repos\n';
    markdown += '   - Implement TTL-based cleanup for persistent workspaces\n\n';

    // Raw data section
    markdown += '## Raw Data\n\n';
    markdown += '```json\n';
    markdown += JSON.stringify(this.results, null, 2);
    markdown += '\n```\n';

    // Write to file
    const outputPath = join(process.cwd(), 'docs', 'performance-data.md');
    writeFileSync(outputPath, markdown);

    console.log(`\n✅ Report generated: ${outputPath}`);
    console.log('\nBenchmarks complete!');
  }
}

// Run benchmarks
const benchmark = new WorkspaceBenchmark();
benchmark.runBenchmarks().catch(error => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});
