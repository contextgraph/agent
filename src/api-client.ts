import { loadCredentials, isExpired, isTokenExpired } from './credentials.js';
import type { ActionDetailResource, ActionNode } from './types/actions.js';

export class ApiClient {
  constructor(
    private baseUrl: string = 'https://www.contextgraph.dev'
  ) {}

  private async getAuthToken(): Promise<string> {
    const credentials = await loadCredentials();

    if (!credentials) {
      throw new Error('Not authenticated. Run authentication first.');
    }

    // Check both the stored metadata and the actual JWT expiration
    if (isExpired(credentials) || isTokenExpired(credentials.clerkToken)) {
      throw new Error('Token expired. Re-authenticate to continue.');
    }

    return credentials.clerkToken;
  }

  async getActionDetail(actionId: string): Promise<ActionDetailResource> {
    const token = await this.getAuthToken();

    // Use both x-authorization header and query param for Vercel compatibility
    const response = await fetch(
      `${this.baseUrl}/api/actions/${actionId}?token=${encodeURIComponent(token)}`,
      {
        headers: {
          'x-authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error);
    }

    return result.data;
  }

  async fetchTree(rootActionId: string, includeCompleted: boolean = false): Promise<ActionNode> {
    const token = await this.getAuthToken();

    // Use both x-authorization header and query param for Vercel compatibility
    const response = await fetch(
      `${this.baseUrl}/api/tree/${rootActionId}?includeCompleted=${includeCompleted}&token=${encodeURIComponent(token)}`,
      {
        headers: {
          'x-authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch tree: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error('Failed to fetch tree: API returned unsuccessful response');
    }

    // If no root actions, the tree is complete (all actions done)
    if (!result.data.rootActions?.[0]) {
      return { id: rootActionId, title: '', done: true, dependencies: [], children: [] };
    }

    return result.data.rootActions[0];
  }

  async claimNextAction(workerId: string): Promise<ActionDetailResource | null> {
    const token = await this.getAuthToken();

    const response = await fetch(
      `${this.baseUrl}/api/worker/next?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: {
          'x-authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ worker_id: workerId }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'API returned unsuccessful response');
    }

    // API returns null when no work is available
    return result.data;
  }

  async releaseClaim(params: { action_id: string; worker_id: string; claim_id: string }): Promise<void> {
    const token = await this.getAuthToken();

    const response = await fetch(
      `${this.baseUrl}/api/worker/release?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: {
          'x-authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'API returned unsuccessful response');
    }
  }
}
