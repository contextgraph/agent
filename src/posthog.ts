import { PostHog } from 'posthog-node';

let posthogClient: PostHog | null = null;

/**
 * Get or initialize the PostHog client.
 * Returns null if POSTHOG_API_KEY is not configured.
 */
export function getPostHogClient(): PostHog | null {
  // Return early if no API key is configured
  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) {
    return null;
  }

  // Return existing client if already initialized
  if (posthogClient) {
    return posthogClient;
  }

  // Initialize new client
  posthogClient = new PostHog(apiKey, {
    host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
    flushAt: 1, // Flush immediately for CLI context
    flushInterval: 0, // Disable batching for CLI
  });

  return posthogClient;
}

/**
 * Capture a PostHog event.
 * Silently fails if PostHog is not configured.
 */
export async function captureEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>
): Promise<void> {
  const client = getPostHogClient();
  if (!client) {
    return;
  }

  try {
    client.capture({
      distinctId,
      event,
      properties,
    });
    await client.flush();
  } catch (error) {
    // Silently fail - don't let analytics break the workflow
    console.error('PostHog event capture failed:', error instanceof Error ? error.message : String(error));
  }
}

/**
 * Shutdown the PostHog client gracefully.
 * Call this before process exit to ensure all events are flushed.
 */
export async function shutdownPostHog(): Promise<void> {
  if (posthogClient) {
    await posthogClient.shutdown();
    posthogClient = null;
  }
}
