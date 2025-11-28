/**
 * LogBuffer - Manages buffered, non-blocking log transmission
 *
 * Collects log events and flushes them periodically to avoid
 * blocking the main Claude execution flow.
 */

import { LogTransportService, type LogEvent } from './log-transport.js';

// Buffer configuration for log streaming
const LOG_BUFFER_FLUSH_INTERVAL_MS = 500;
const LOG_BUFFER_MAX_SIZE = 50;
const LOG_BUFFER_MAX_QUEUE_SIZE = 1000;

export class LogBuffer {
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
