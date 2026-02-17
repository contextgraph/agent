/**
 * LogTransportService - Handles sending log events to the platform API
 *
 * This service manages:
 * - Creating and updating runs
 * - Sending batches of log events
 * - Retry logic with exponential backoff
 */

/**
 * Log event types supported by the platform
 */
export type LogEventType =
  | 'stdout'
  | 'stderr'
  | 'agent_message'
  | 'claude_message'
  | 'tool_use'
  | 'tool_result'
  | 'system';

/**
 * A log event to be sent to the platform
 */
export interface LogEvent {
  eventType: LogEventType;
  content: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

/**
 * Response from creating a run
 */
export interface CreateRunResponse {
  runId: string;
}

/**
 * Response from batch send
 */
export interface BatchSendResponse {
  success: boolean;
  eventsReceived?: number;
}

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  backoffFactor: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 100,
  backoffFactor: 2,
};

/**
 * Service for sending log events to the platform API
 */
export class LogTransportService {
  private runId: string | null = null;
  private retryConfig: RetryConfig;

  constructor(
    private baseUrl: string,
    private authToken: string,
    runId?: string,
    retryConfig?: Partial<RetryConfig>,
    private provider?: string
  ) {
    this.runId = runId ?? null;
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  /**
   * Get the current run ID
   */
  getRunId(): string | null {
    return this.runId;
  }

  /**
   * Create a new run for an action
   * @param actionId - The action ID this run is executing
   * @param purpose - The purpose of this run: 'execute' | 'prepare' | 'review'
   * @param metadata - Optional metadata for the run (e.g., startingCommit)
   * @returns The created run ID
   */
  async createRun(
    actionId: string,
    purpose: 'execute' | 'prepare' | 'review',
    metadata?: { startingCommit?: string }
  ): Promise<string> {
    const response = await this.makeRequest('/api/runs', {
      method: 'POST',
      body: JSON.stringify({
        actionId,
        state: 'queued',
        purpose,
        ...(metadata?.startingCommit && { startingCommit: metadata.startingCommit }),
      }),
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Failed to create run');
    }

    this.runId = result.data.runId;
    return this.runId;
  }

  /**
   * Start the run (transition to running state)
   * Called when execution begins
   */
  async startRun(): Promise<void> {
    if (!this.runId) {
      throw new Error('No run ID set. Call createRun() first.');
    }

    const response = await this.makeRequest(`/api/runs/${this.runId}/start`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Failed to start run');
    }
  }

  /**
   * Finish the run with an outcome
   * @param outcome - 'success' | 'error' | 'timeout' | 'incomplete'
   * @param metadata - Optional metadata (exitCode, errorMessage, cost, usage)
   */
  async finishRun(
    outcome: 'success' | 'error' | 'timeout' | 'incomplete',
    metadata?: {
      exitCode?: number;
      errorMessage?: string;
      cost?: number;
      usage?: Record<string, unknown>;
    }
  ): Promise<void> {
    if (!this.runId) {
      throw new Error('No run ID set. Call createRun() first.');
    }

    const response = await this.makeRequest(`/api/runs/${this.runId}/finish`, {
      method: 'POST',
      body: JSON.stringify({
        outcome,
        exitCode: metadata?.exitCode?.toString(),
        errorMessage: metadata?.errorMessage,
      }),
    });

    const result = await response.json();

    if (!result.success) {
      // If the run is already in a finishing state (summarizing, finished),
      // this is not an error - the server is already handling completion
      const error = result.error || 'Failed to finish run';
      if (error.includes('summarizing') || error.includes('finished')) {
        console.log('[LogTransport] Run is already being finished by server, skipping client finish');
        return;
      }
      throw new Error(error);
    }
  }

  /**
   * Update the state of the current run
   * @deprecated Use startRun() and finishRun() instead
   * @param state - New state for the run
   * @param metadata - Optional metadata to include with the state update
   */
  async updateRunState(
    state: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    if (!this.runId) {
      throw new Error('No run ID set. Call createRun() first.');
    }

    // Map state to appropriate endpoint
    if (state === 'executing' || state === 'preparing' || state === 'running') {
      await this.startRun();
    } else if (state === 'completed' || state === 'failed') {
      const outcome = state === 'completed' ? 'success' : 'error';
      await this.finishRun(outcome, {
        exitCode: metadata?.exitCode as number | undefined,
        errorMessage: metadata?.error as string | undefined,
        cost: metadata?.cost as number | undefined,
        usage: metadata?.usage as Record<string, unknown> | undefined,
      });
    } else {
      // For unknown states, just log a warning
      console.warn(`[LogTransport] Unknown state '${state}' - no API call made`);
    }
  }

  /**
   * Send a batch of log events to the platform
   * @param events - Array of log events to send
   * @param workerId - Optional worker ID
   * @returns Success status and number of events received
   */
  async sendBatch(
    events: LogEvent[],
    workerId?: string
  ): Promise<BatchSendResponse> {
    if (!this.runId) {
      throw new Error('No run ID set. Call createRun() first.');
    }

    if (events.length === 0) {
      return { success: true, eventsReceived: 0 };
    }

    const normalizedEvents = events.map((event) => {
      const data = {
        ...(event.data || {}),
        ...(this.provider ? { provider: (event.data?.provider as string | undefined) || this.provider } : {}),
      };

      // Backward-compat: keep existing backend/UI pipeline working while
      // callers migrate to provider-neutral "agent_message".
      if (event.eventType === 'agent_message') {
        return {
          ...event,
          eventType: 'claude_message' as const,
          data: {
            ...data,
            canonicalEventType: 'agent_message',
          },
        };
      }

      return { ...event, data };
    });

    const response = await this.makeRequest('/api/agents/log/event', {
      method: 'POST',
      body: JSON.stringify({
        runId: this.runId,
        events: normalizedEvents,
        ...(workerId && { workerId }),
      }),
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Failed to send log batch');
    }

    return {
      success: true,
      eventsReceived: result.data?.eventsReceived ?? events.length,
    };
  }

  /**
   * Make an HTTP request with retry logic
   */
  private async makeRequest(
    path: string,
    options: RequestInit
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'x-authorization': `Bearer ${this.authToken}`,
      'Content-Type': 'application/json',
    };

    let lastError: Error | null = null;
    let delay = this.retryConfig.initialDelayMs;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            ...headers,
            ...(options.headers || {}),
          },
        });

        // Don't retry on client errors (4xx) - these won't succeed on retry
        if (response.status >= 400 && response.status < 500) {
          return response;
        }

        // Retry on server errors (5xx) or network issues
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't wait after the last attempt
        if (attempt < this.retryConfig.maxRetries) {
          await this.sleep(delay);
          delay *= this.retryConfig.backoffFactor;
        }
      }
    }

    throw new Error(
      `Request failed after ${this.retryConfig.maxRetries + 1} attempts: ${lastError?.message}`
    );
  }

  /**
   * Sleep for a given number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
