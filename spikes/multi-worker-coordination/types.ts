/**
 * Types for multi-worker coordination spike
 */

export interface WorkItem {
  id: string;
  claimed_by?: string;
  claimed_at?: Date;
  version?: number; // For optimistic locking
}

export interface ClaimResult {
  success: boolean;
  workItemId?: string;
  workerId: string;
  latencyMs: number;
  error?: string;
}

export interface ApproachStats {
  totalAttempts: number;
  successfulClaims: number;
  duplicateClaims: number;
  failedClaims: number;
  latencies: number[];
  p50: number;
  p95: number;
  p99: number;
  maxLatency: number;
}

export interface ApproachInterface {
  name: string;
  setup(): Promise<void>;
  teardown(): Promise<void>;
  claimWork(workerId: string): Promise<ClaimResult>;
  releaseWork(workItemId: string, workerId: string): Promise<void>;
  getStats(): Promise<ApproachStats>;
}
