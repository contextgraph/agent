import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { executeClaude } from '../claude-sdk.js';
import { LogTransportService, type LogEvent } from '../log-transport.js';
import { HeartbeatManager } from '../heartbeat-manager.js';

const API_BASE_URL = 'https://www.contextgraph.dev';

// Buffer configuration for log streaming
const LOG_BUFFER_FLUSH_INTERVAL_MS = 500;
const LOG_BUFFER_MAX_SIZE = 50;
const LOG_BUFFER_MAX_QUEUE_SIZE = 1000;

export interface WorkflowOptions {
  cwd?: string;
}

/**
 * LogBuffer - Manages buffered, non-blocking log transmission
 *
 * Collects log events and flushes them periodically to avoid
 * blocking the main Claude execution flow.
 */
class LogBuffer {
  private buffer: LogEvent[] = [];
  private flushIntervalId: ReturnType<typeof setInterval> | null = null;
  private isFlushing = false;

  constructor(
    private transport: LogTransportService,
    private flushIntervalMs: number = LOG_BUFFER_FLUSH_INTERVAL_MS,
    private maxBufferSize: number = LOG_BUFFER_MAX_SIZE,
    private maxQueueSize: number = LOG_BUFFER_MAX_QUEUE_SIZE
  ) {}

  /**
   * Add an event to the buffer (fire-and-forget)
   * Handles backpressure by dropping oldest events if queue is full.
   */
  push(event: LogEvent): void {
    // Backpressure: drop oldest events if queue is too large
    if (this.buffer.length >= this.maxQueueSize) {
      this.buffer.shift();
    }
    this.buffer.push(event);

    // Trigger immediate flush if buffer is at max size
    if (this.buffer.length >= this.maxBufferSize) {
      this.flushAsync();
    }
  }

  /**
   * Start periodic flushing
   */
  start(): void {
    if (this.flushIntervalId !== null) return;

    this.flushIntervalId = setInterval(() => {
      this.flushAsync();
    }, this.flushIntervalMs);
  }

  /**
   * Stop periodic flushing and flush remaining events
   */
  async stop(): Promise<void> {
    if (this.flushIntervalId !== null) {
      clearInterval(this.flushIntervalId);
      this.flushIntervalId = null;
    }

    // Final flush of remaining events
    await this.flush();
  }

  /**
   * Async flush (fire-and-forget, non-blocking)
   */
  private flushAsync(): void {
    // Don't start a new flush if one is in progress
    if (this.isFlushing || this.buffer.length === 0) return;

    // Fire and forget - don't await
    this.flush().catch((error) => {
      console.error('[LogBuffer] Flush error:', error instanceof Error ? error.message : String(error));
    });
  }

  /**
   * Flush current buffer contents to transport
   */
  private async flush(): Promise<void> {
    if (this.isFlushing || this.buffer.length === 0) return;

    this.isFlushing = true;
    const eventsToSend = [...this.buffer];
    this.buffer = [];

    try {
      await this.transport.sendBatch(eventsToSend);
    } catch (error) {
      // Log errors but don't re-queue (to avoid infinite growth)
      console.error('[LogBuffer] Failed to send batch:', error instanceof Error ? error.message : String(error));
    } finally {
      this.isFlushing = false;
    }
  }
}

export async function runExecute(actionId: string, options?: WorkflowOptions): Promise<void> {
  const credentials = await loadCredentials();

  if (!credentials) {
    console.error('❌ Not authenticated. Run authentication first.');
    process.exit(1);
  }

  if (isExpired(credentials) || isTokenExpired(credentials.clerkToken)) {
    console.error('❌ Token expired. Re-authenticate to continue.');
    process.exit(1);
  }

  console.log(`Fetching execution instructions for action ${actionId}...\n`);

  const response = await fetch(
    `${API_BASE_URL}/api/prompts/execute`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credentials.clerkToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ actionId }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch execute prompt: ${response.statusText}\n${errorText}`);
  }

  const { prompt } = await response.json();

  // Initialize log streaming infrastructure
  const logTransport = new LogTransportService(API_BASE_URL, credentials.clerkToken);
  let runId: string | undefined;
  let heartbeatManager: HeartbeatManager | undefined;
  let logBuffer: LogBuffer | undefined;

  try {
    // Create run for this execution
    console.log('[Log Streaming] Creating run...');
    runId = await logTransport.createRun(actionId);
    console.log(`[Log Streaming] Run created: ${runId}`);

    // Update run state to executing
    await logTransport.updateRunState('executing');

    // Start heartbeat manager
    heartbeatManager = new HeartbeatManager(API_BASE_URL, credentials.clerkToken, runId);
    heartbeatManager.start();
    console.log('[Log Streaming] Heartbeat started');

    // Set up log buffer for non-blocking transmission
    logBuffer = new LogBuffer(logTransport);
    logBuffer.start();

    console.log('Spawning Claude for execution...\n');

    const claudeResult = await executeClaude({
      prompt,
      cwd: options?.cwd || process.cwd(),
      authToken: credentials.clerkToken,
      onLogEvent: (event) => {
        logBuffer!.push(event);
      },
    });

    // Update run state based on result
    const finalState = claudeResult.exitCode === 0 ? 'completed' : 'failed';
    await logTransport.updateRunState(finalState, {
      exitCode: claudeResult.exitCode,
      cost: claudeResult.cost,
      usage: claudeResult.usage,
    });

    if (claudeResult.exitCode !== 0) {
      throw new Error(`Claude execution failed with exit code ${claudeResult.exitCode}`);
    }

    console.log('\n✅ Execution complete');

  } catch (error) {
    // Update run state to failed if we have a run
    if (runId) {
      try {
        await logTransport.updateRunState('failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      } catch (stateError) {
        console.error('[Log Streaming] Failed to update run state:', stateError);
      }
    }
    throw error;

  } finally {
    // Cleanup: stop heartbeat and flush remaining logs
    if (heartbeatManager) {
      heartbeatManager.stop();
      console.log('[Log Streaming] Heartbeat stopped');
    }

    if (logBuffer) {
      await logBuffer.stop();
      console.log('[Log Streaming] Logs flushed');
    }
  }
}

