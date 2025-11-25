#!/usr/bin/env node
/**
 * Main test runner for multi-worker coordination spike
 *
 * Runs all approaches against different worker scenarios and compares results
 */

import { DatabaseTransactionApproach } from './approaches/db-transaction.js';
import { RedisLockApproach } from './approaches/redis-lock.js';
import { OptimisticLockingApproach } from './approaches/optimistic-locking.js';
import { TestHarness, TestResult } from './test-harness.js';

async function main() {
  console.log('🚀 Multi-Worker Coordination Spike');
  console.log('=' .repeat(80));

  const scenarios = [
    { workerCount: 2, workItemCount: 10, runs: 50 },
    { workerCount: 10, workItemCount: 10, runs: 50 },
  ];

  const allResults: TestResult[] = [];

  // Test Approach 1: Database Transaction (SQLite)
  console.log('\n📦 Testing Database Transaction Approach (SQLite)...');
  for (const scenario of scenarios) {
    const approach = new DatabaseTransactionApproach(':memory:');
    const harness = new TestHarness(approach);
    const result = await harness.runScenario(scenario);
    allResults.push(result);
  }

  // Test Approach 2: Redis (if available)
  if (process.env.REDIS_URL || process.env.SKIP_REDIS !== 'true') {
    console.log('\n🔴 Testing Redis Distributed Lock Approach...');
    try {
      for (const scenario of scenarios) {
        const approach = new RedisLockApproach();
        const harness = new TestHarness(approach);
        const result = await harness.runScenario(scenario);
        allResults.push(result);
      }
    } catch (error) {
      console.log('⚠️  Redis not available, skipping Redis tests');
      console.log(`   Error: ${error instanceof Error ? error.message : String(error)}`);
      console.log('   Set REDIS_URL or run with Docker: docker run -d -p 6379:6379 redis');
    }
  } else {
    console.log('\n⏭️  Skipping Redis tests (SKIP_REDIS=true)');
  }

  // Test Approach 3: Optimistic Locking (SQLite)
  console.log('\n🔄 Testing Optimistic Locking Approach (SQLite)...');
  for (const scenario of scenarios) {
    const approach = new OptimisticLockingApproach(':memory:');
    const harness = new TestHarness(approach);
    const result = await harness.runScenario(scenario);
    allResults.push(result);
  }

  // Print summary
  TestHarness.printResults(allResults);

  // Determine winner
  console.log('\n🏆 RECOMMENDATION\n');

  const passed = allResults.filter(r => r.passed);
  if (passed.length === 0) {
    console.log('❌ No approach met all criteria (zero duplicates + <50ms p95)');
    process.exit(1);
  }

  // Find best approach by p95 latency among passing approaches
  const winner = passed.reduce((best, current) =>
    current.stats.p95 < best.stats.p95 ? current : best
  );

  console.log(`✅ Winner: ${winner.approach}`);
  console.log(`   P95 Latency: ${winner.stats.p95.toFixed(2)}ms`);
  console.log(`   Duplicate Claims: ${winner.duplicateClaims}`);
  console.log(`   Success Rate: ${(winner.stats.successfulClaims / winner.stats.totalAttempts * 100).toFixed(1)}%`);

  console.log('\n📝 Implementation Path:');
  if (winner.approach.includes('Database Transaction')) {
    console.log('   1. Use database transactions with row-level locking');
    console.log('   2. SELECT ... WHERE claimed_by IS NULL LIMIT 1');
    console.log('   3. UPDATE ... WHERE id = ? AND claimed_by IS NULL');
    console.log('   4. Works natively with both SQLite and Postgres');
    console.log('   5. No external dependencies needed');
  } else if (winner.approach.includes('Redis')) {
    console.log('   1. Use Redis SETNX for atomic lock acquisition');
    console.log('   2. Set lock expiration to handle worker failures');
    console.log('   3. Requires Redis infrastructure');
    console.log('   4. Fastest performance but adds operational complexity');
  } else if (winner.approach.includes('Optimistic')) {
    console.log('   1. Add version field to work_items table');
    console.log('   2. UPDATE ... WHERE id = ? AND version = ?');
    console.log('   3. Retry on version conflicts');
    console.log('   4. Works with both SQLite and Postgres');
    console.log('   5. Good balance of simplicity and performance');
  }

  console.log('\n✨ Spike complete!\n');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
