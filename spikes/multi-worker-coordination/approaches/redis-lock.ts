/**
 * Approach 2: Redis Distributed Lock
 *
 * Uses Redis SETNX (SET if Not eXists) for atomic lock acquisition
 */

import { ApproachInterface, ClaimResult, ApproachStats } from '../types.js';
import { createClient, RedisClientType } from 'redis';

export class RedisLockApproach implements ApproachInterface {
  name = 'Redis Distributed Lock';
  private redis: RedisClientType | null = null;
  private claims: ClaimResult[] = [];
  private workItems: string[] = [];

  async setup(): Promise<void> {
    // Create Redis client
    this.redis = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });

    await this.redis.connect();

    // Initialize work items
    this.workItems = [];
    for (let i = 1; i <= 10; i++) {
      const itemId = `work-${i}`;
      this.workItems.push(itemId);
      // Remove any existing locks
      await this.redis.del(`lock:${itemId}`);
      await this.redis.del(`claimed:${itemId}`);
    }

    this.claims = [];
  }

  async teardown(): Promise<void> {
    if (this.redis) {
      // Clean up
      for (const itemId of this.workItems) {
        await this.redis.del(`lock:${itemId}`);
        await this.redis.del(`claimed:${itemId}`);
      }
      await this.redis.quit();
      this.redis = null;
    }
  }

  async claimWork(workerId: string): Promise<ClaimResult> {
    if (!this.redis) {
      throw new Error('Redis not connected');
    }

    const startTime = performance.now();

    try {
      // Try to claim each work item until we get one
      for (const itemId of this.workItems) {
        const lockKey = `lock:${itemId}`;
        const claimedKey = `claimed:${itemId}`;

        // Try to acquire lock with SETNX (atomic set-if-not-exists)
        const acquired = await this.redis.set(lockKey, workerId, {
          NX: true, // Only set if doesn't exist
          EX: 60,   // Expire after 60 seconds
        });

        if (acquired) {
          // We got the lock! Mark as claimed
          await this.redis.set(claimedKey, workerId);

          const endTime = performance.now();
          const result: ClaimResult = {
            success: true,
            workItemId: itemId,
            workerId,
            latencyMs: endTime - startTime,
          };
          this.claims.push(result);
          return result;
        }
      }

      // No work available
      const endTime = performance.now();
      const result: ClaimResult = {
        success: false,
        workerId,
        latencyMs: endTime - startTime,
      };
      this.claims.push(result);
      return result;
    } catch (error) {
      const endTime = performance.now();
      const result: ClaimResult = {
        success: false,
        workerId,
        latencyMs: endTime - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
      this.claims.push(result);
      return result;
    }
  }

  async releaseWork(workItemId: string, workerId: string): Promise<void> {
    if (!this.redis) {
      throw new Error('Redis not connected');
    }

    const lockKey = `lock:${workItemId}`;
    const claimedKey = `claimed:${workItemId}`;

    // Release the lock
    await this.redis.del(lockKey);
    await this.redis.del(claimedKey);
  }

  async getStats(): Promise<ApproachStats> {
    const successful = this.claims.filter(c => c.success);
    const failed = this.claims.filter(c => !c.success);
    const latencies = this.claims.map(c => c.latencyMs).sort((a, b) => a - b);

    // Count duplicate claims
    const claimedItems = new Map<string, string[]>();
    for (const claim of successful) {
      if (claim.workItemId) {
        if (!claimedItems.has(claim.workItemId)) {
          claimedItems.set(claim.workItemId, []);
        }
        claimedItems.get(claim.workItemId)!.push(claim.workerId);
      }
    }

    let duplicates = 0;
    for (const workers of claimedItems.values()) {
      if (workers.length > 1) {
        duplicates++;
      }
    }

    return {
      totalAttempts: this.claims.length,
      successfulClaims: successful.length,
      duplicateClaims: duplicates,
      failedClaims: failed.length,
      latencies,
      p50: this.percentile(latencies, 0.5),
      p95: this.percentile(latencies, 0.95),
      p99: this.percentile(latencies, 0.99),
      maxLatency: latencies.length > 0 ? latencies[latencies.length - 1] : 0,
    };
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, index)];
  }
}
