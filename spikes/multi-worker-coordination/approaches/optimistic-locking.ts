/**
 * Approach 3: Optimistic Locking with Version Field
 *
 * Uses version numbers to detect concurrent modifications
 */

import { ApproachInterface, ClaimResult, ApproachStats, WorkItem } from '../types.js';
import Database from 'better-sqlite3';

export class OptimisticLockingApproach implements ApproachInterface {
  name = 'Optimistic Locking (Version Field)';
  private db: Database.Database | null = null;
  private claims: ClaimResult[] = [];
  private dbPath: string;
  private maxRetries = 5;

  constructor(dbPath = ':memory:') {
    this.dbPath = dbPath;
  }

  async setup(): Promise<void> {
    const Database = (await import('better-sqlite3')).default;
    this.db = new Database(this.dbPath);

    // Create work_items table with version field
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS work_items (
        id TEXT PRIMARY KEY,
        claimed_by TEXT,
        claimed_at INTEGER,
        version INTEGER NOT NULL DEFAULT 0
      )
    `);

    // Insert test work items
    const insert = this.db.prepare('INSERT INTO work_items (id, version) VALUES (?, 0)');
    for (let i = 1; i <= 10; i++) {
      insert.run(`work-${i}`);
    }

    this.claims = [];
  }

  async teardown(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async claimWork(workerId: string): Promise<ClaimResult> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const startTime = performance.now();

    try {
      // Retry loop for optimistic locking
      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        // Read unclaimed work item
        const workItem = this.db.prepare(
          'SELECT id, version FROM work_items WHERE claimed_by IS NULL LIMIT 1'
        ).get() as (WorkItem & { version: number }) | undefined;

        if (!workItem) {
          // No work available
          const endTime = performance.now();
          const result: ClaimResult = {
            success: false,
            workerId,
            latencyMs: endTime - startTime,
          };
          this.claims.push(result);
          return result;
        }

        // Try to claim with version check
        const now = Date.now();
        const info = this.db.prepare(
          `UPDATE work_items
           SET claimed_by = ?, claimed_at = ?, version = version + 1
           WHERE id = ? AND version = ? AND claimed_by IS NULL`
        ).run(workerId, now, workItem.id, workItem.version);

        if (info.changes > 0) {
          // Successfully claimed!
          const endTime = performance.now();
          const result: ClaimResult = {
            success: true,
            workItemId: workItem.id,
            workerId,
            latencyMs: endTime - startTime,
          };
          this.claims.push(result);
          return result;
        }

        // Version conflict - retry
        await new Promise(resolve => setTimeout(resolve, Math.random() * 5));
      }

      // Max retries exceeded
      const endTime = performance.now();
      const result: ClaimResult = {
        success: false,
        workerId,
        latencyMs: endTime - startTime,
        error: 'Max retries exceeded',
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
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    this.db.prepare(
      'UPDATE work_items SET claimed_by = NULL, claimed_at = NULL WHERE id = ? AND claimed_by = ?'
    ).run(workItemId, workerId);
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
