/**
 * HeartbeatManager - Sends periodic liveness signals during execution
 *
 * This service manages:
 * - Periodic heartbeat signals to the platform
 * - Phase/progress updates without blocking execution
 * - Graceful error handling (log, don't throw)
 */

/**
 * Execution phases for heartbeat reporting
 */
export type HeartbeatPhase = 'executing' | 'reading' | 'writing' | 'thinking';

/**
 * Heartbeat payload sent to the platform
 */
export interface HeartbeatPayload {
  phase: HeartbeatPhase;
  progress?: number;
  timestamp: string;
}

/**
 * HeartbeatManager - Self-managing heartbeat service
 *
 * Sends periodic liveness signals to keep the platform informed
 * of worker status without blocking the main execution flow.
 */
export class HeartbeatManager {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private currentPhase: HeartbeatPhase = 'executing';
  private currentProgress: number | undefined = undefined;

  constructor(
    private baseUrl: string,
    private authToken: string,
    private runId: string
  ) {}

  /**
   * Start sending periodic heartbeats
   * @param intervalMs - Time between heartbeats in milliseconds (default: 30000)
   */
  start(intervalMs: number = 30000): void {
    // Clear any existing interval
    this.stop();

    // Send initial heartbeat immediately
    this.sendHeartbeat();

    // Set up periodic heartbeats
    this.intervalId = setInterval(() => {
      this.sendHeartbeat();
    }, intervalMs);
  }

  /**
   * Stop sending heartbeats
   */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Update the current phase and optional progress
   * @param phase - Current execution phase
   * @param progress - Optional progress percentage (0-100)
   */
  updatePhase(phase: HeartbeatPhase, progress?: number): void {
    this.currentPhase = phase;
    this.currentProgress = progress;
  }

  /**
   * Check if heartbeat manager is currently running
   */
  isRunning(): boolean {
    return this.intervalId !== null;
  }

  /**
   * Send a heartbeat to the platform (internal method)
   * Errors are logged but not thrown to avoid blocking execution.
   */
  private async sendHeartbeat(): Promise<void> {
    const payload: HeartbeatPayload = {
      phase: this.currentPhase,
      timestamp: new Date().toISOString(),
    };

    if (this.currentProgress !== undefined) {
      payload.progress = this.currentProgress;
    }

    try {
      const url = `${this.baseUrl}/api/runs/${this.runId}/heartbeat`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-authorization': `Bearer ${this.authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        // Log but don't throw - heartbeats are best-effort
        console.error(
          `Heartbeat failed: HTTP ${response.status} ${response.statusText}`
        );
      }
    } catch (error) {
      // Log but don't throw - heartbeats shouldn't block execution
      console.error(
        'Heartbeat error:',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}
