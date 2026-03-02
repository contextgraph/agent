/**
 * PostHog Client-Side Analytics
 *
 * Provides event tracking for user-facing interactions in the agent CLI.
 * Captures behavioral events like claim submission, routing decisions, and execution outcomes.
 */

import { PostHog } from 'posthog-node';

let posthogClient: PostHog | null = null;

/**
 * Get or initialize the PostHog client
 * Returns null if PostHog is not configured (gracefully degrades)
 */
function getPostHogClient(): PostHog | null {
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    return null;
  }

  if (!posthogClient) {
    posthogClient = new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
      flushAt: 1, // Flush immediately for CLI events
      flushInterval: 0, // Disable interval-based flushing
    });
  }

  return posthogClient;
}

/**
 * Capture a user-facing event in PostHog
 * Safely handles missing PostHog configuration by no-op
 *
 * @param distinctId - User identifier (typically Clerk user ID or worker ID)
 * @param event - Event name (e.g., 'claim_submitted')
 * @param properties - Event properties object
 */
export function captureEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>
): void {
  const client = getPostHogClient();
  if (!client) {
    // PostHog not configured, skip silently
    return;
  }

  try {
    client.capture({
      distinctId,
      event,
      properties,
    });
  } catch (error) {
    // Log but don't throw - analytics failures shouldn't break CLI functionality
    console.error('[PostHog] Failed to capture event:', error);
  }
}

/**
 * Shutdown the PostHog client gracefully
 * Call this during process shutdown to flush remaining events
 */
export async function shutdownPostHog(): Promise<void> {
  if (posthogClient) {
    await posthogClient.shutdown();
    posthogClient = null;
  }
}
