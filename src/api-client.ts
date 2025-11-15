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

  async findNextLeaf(rootId: string): Promise<ActionNode | null> {
    const token = await this.getAuthToken();

    // Use both x-authorization header and query param for Vercel compatibility
    const response = await fetch(
      `${this.baseUrl}/api/actions/next-leaf?root=${rootId}&token=${encodeURIComponent(token)}`,
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
    return result.data;
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
    if (!result.success || !result.data.rootActions?.[0]) {
      throw new Error('No root action found in tree response');
    }

    return result.data.rootActions[0];
  }
}
