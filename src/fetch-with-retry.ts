export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retryOptions: RetryOptions = {}
): Promise<Response> {
  const { maxRetries = 3, baseDelayMs = 1000, maxDelayMs = 10000 } = retryOptions;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      // Don't retry on client errors (4xx), only on server/network errors
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        return response;
      }
      // Server error (5xx) - will retry
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      // Network error - will retry
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    if (attempt < maxRetries) {
      // Exponential backoff with jitter
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      const jitter = delay * 0.1 * Math.random();
      await new Promise((resolve) => setTimeout(resolve, delay + jitter));
    }
  }

  throw lastError ?? new Error('Request failed after retries');
}
