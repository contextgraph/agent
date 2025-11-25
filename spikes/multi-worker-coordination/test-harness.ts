/**
 * Test harness for multi-worker coordination spike
 */

import { Worker } from 'worker_threads';
import { ApproachInterface, ClaimResult, ApproachStats } from './types.js';

export interface TestScenario {
  workerCount: number;
  workItemCount: number;
  runs: number;
}

export interface TestResult {
  approach: string;
  scenario: TestScenario;
  stats: ApproachStats;
  duplicateClaims: number;
  passed: boolean;
}

export class TestHarness {
  constructor(private approach: ApproachInterface) {}

  /**
   * Run a test scenario with N concurrent workers
   */
  async runScenario(scenario: TestScenario): Promise<TestResult> {
    console.log(`\n🔄 Testing ${this.approach.name} with ${scenario.workerCount} workers...`);

    await this.approach.setup();

    const allResults: ClaimResult[] = [];

    for (let run = 0; run < scenario.runs; run++) {
      // Simulate concurrent workers trying to claim work
      const promises: Promise<ClaimResult>[] = [];

      for (let i = 0; i < scenario.workerCount; i++) {
        const workerId = `worker-${i}`;
        promises.push(this.approach.claimWork(workerId));
      }

      const results = await Promise.all(promises);
      allResults.push(...results);

      // Small delay between runs
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    const stats = await this.approach.getStats();
    await this.approach.teardown();

    // Count duplicate claims
    const claimedItems = new Map<string, string[]>();
    for (const result of allResults) {
      if (result.success && result.workItemId) {
        if (!claimedItems.has(result.workItemId)) {
          claimedItems.set(result.workItemId, []);
        }
        claimedItems.get(result.workItemId)!.push(result.workerId);
      }
    }

    let duplicates = 0;
    for (const [itemId, workers] of claimedItems) {
      if (workers.length > 1) {
        duplicates++;
        console.log(`❌ Duplicate claim on ${itemId} by: ${workers.join(', ')}`);
      }
    }

    const passed = duplicates === 0 && stats.p95 < 50;

    return {
      approach: this.approach.name,
      scenario,
      stats,
      duplicateClaims: duplicates,
      passed,
    };
  }

  /**
   * Print test results in a readable format
   */
  static printResults(results: TestResult[]): void {
    console.log('\n' + '='.repeat(80));
    console.log('📊 SPIKE RESULTS: Multi-Worker Coordination');
    console.log('='.repeat(80));

    for (const result of results) {
      console.log(`\n🔧 ${result.approach}`);
      console.log(`   Workers: ${result.scenario.workerCount}, Runs: ${result.scenario.runs}`);
      console.log(`   Total attempts: ${result.stats.totalAttempts}`);
      console.log(`   Successful claims: ${result.stats.successfulClaims}`);
      console.log(`   Failed claims: ${result.stats.failedClaims}`);
      console.log(`   Duplicate claims: ${result.duplicateClaims}`);
      console.log(`   Latency (p50/p95/p99): ${result.stats.p50.toFixed(2)}ms / ${result.stats.p95.toFixed(2)}ms / ${result.stats.p99.toFixed(2)}ms`);
      console.log(`   Max latency: ${result.stats.maxLatency.toFixed(2)}ms`);
      console.log(`   Result: ${result.passed ? '✅ PASSED' : '❌ FAILED'}`);

      if (result.duplicateClaims > 0) {
        console.log(`   ⚠️  ${result.duplicateClaims} duplicate claims detected!`);
      }
      if (result.stats.p95 >= 50) {
        console.log(`   ⚠️  P95 latency ${result.stats.p95.toFixed(2)}ms exceeds 50ms target`);
      }
    }

    console.log('\n' + '='.repeat(80));
  }

  /**
   * Calculate percentile from sorted array
   */
  static percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, index)];
  }
}
