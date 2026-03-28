import { loadCredentials, isExpired, isTokenExpired } from './credentials.js';
import { fetchWithRetry } from './fetch-with-retry.js';
import { PRIMARY_WEB_BASE_URL } from './platform-urls.js';
import type { ActionDetailResource, ActionNode } from './types/actions.js';
import packageJson from '../package.json' assert { type: 'json' };

export interface StewardBacklogCandidate {
  id: string;
  repositoryUrl: string;
  authenticatedCloneUrl?: string | null;
  title: string;
  objective: string;
  rationale: string;
  proposedBranch: string | null;
  priorityScore: number;
  repositoryOwner?: string | null;
  repositoryName?: string | null;
  prNumber?: number | null;
  pullRequest?: {
    number?: number | null;
    owner?: string | null;
    repo?: string | null;
    url?: string | null;
  } | null;
}

export interface StewardClaimPrContext {
  prNumber?: number | null;
  owner?: string | null;
  repo?: string | null;
  url?: string | null;
}

export interface StewardNextResource {
  steward: {
    id?: string;
    name: string;
    slug: string;
  };
  backlog_item: {
    id?: string;
    title: string;
    backlog_slug?: string;
    backlog_reference?: string;
    objective: string;
    rationale: string;
    proposed_branch: string | null;
    repository_url: string | null;
    priority_score?: number | null;
    state?: string;
  };
  workflow?: {
    claim_command?: string;
    selection_rule?: string;
    session_rule?: string;
    dismissal_command?: string;
    dismissal_rule?: string;
    completion_rule?: string;
  };
}

export interface StewardTopResource extends StewardNextResource {}

export interface StewardDismissResource {
  backlog_item: {
    id: string;
    state: string;
    title: string;
    backlog_reference: string;
  };
  note: {
    id: string;
    content: string;
    metadata?: Record<string, unknown> | null;
    createdAt: string;
  };
}

export interface StewardClaimedListResource extends StewardNextResource {}

export interface StewardCreateBacklogParams {
  steward: string;
  title: string;
  objective: string;
  rationale: string;
  repository_url: string;
  proposed_branch?: string;
  priority_score?: number;
}

export interface StewardCreateNoteParams {
  steward: string;
  note: string;
  backlog_item?: string;
}

export interface StewardNoteResource {
  steward: {
    id: string;
    name: string;
    slug: string;
  };
  note: {
    id: string;
    content: string;
    metadata?: Record<string, unknown> | null;
    createdAt: string;
  };
}

export interface StewardMissionResource {
  steward: {
    id: string;
    name: string;
    slug: string;
    mission: string;
  };
}

export interface StewardUnclaimResource {
  backlog_item: {
    id: string;
    title: string;
    state: string;
    backlog_reference: string;
  };
}

export interface StewardClaimResource {
  steward: {
    id: string;
    name: string;
    mission: string;
    brief: string | null;
    organization_id: string | null;
  };
  backlog_candidates: StewardBacklogCandidate[];
  prompt: string;
  prompt_version: string | null;
  claim_id: string;
  pr_context?: StewardClaimPrContext | null;
}

export class ApiClient {
  constructor(
    private baseUrl: string = PRIMARY_WEB_BASE_URL
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
    const response = await fetchWithRetry(
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

    const result = await response.json() as {
      success: boolean;
      data: ActionDetailResource;
      error?: string;
    };

    if (!result.success) {
      throw new Error(result.error);
    }

    return result.data;
  }

  async fetchTree(rootActionId: string, includeCompleted: boolean = false): Promise<ActionNode> {
    const token = await this.getAuthToken();

    // Use both x-authorization header and query param for Vercel compatibility
    const response = await fetchWithRetry(
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

    const result = await response.json() as {
      success: boolean;
      data: {
        rootActions?: ActionNode[];
      };
    };
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

    const response = await fetchWithRetry(
      `${this.baseUrl}/api/worker/next?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: {
          'x-authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          worker_id: workerId,
          agent_version: packageJson.version
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const result = await response.json() as {
      success: boolean;
      data: ActionDetailResource | null;
      error?: string;
    };

    if (!result.success) {
      throw new Error(result.error || 'API returned unsuccessful response');
    }

    // API returns null when no work is available
    return result.data;
  }

  async releaseClaim(params: { action_id: string; worker_id: string; claim_id: string }): Promise<void> {
    const token = await this.getAuthToken();

    const response = await fetchWithRetry(
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

    const result = await response.json() as {
      success: boolean;
      error?: string;
    };

    if (!result.success) {
      throw new Error(result.error || 'API returned unsuccessful response');
    }
  }

  async claimNextSteward(workerId: string, stewardId?: string): Promise<StewardClaimResource | null> {
    const token = await this.getAuthToken();

    const response = await fetchWithRetry(
      `${this.baseUrl}/api/worker/steward/next?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: {
          'x-authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          worker_id: workerId,
          ...(stewardId ? { steward_id: stewardId } : {}),
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const result = await response.json() as {
      success: boolean;
      data: StewardClaimResource | null;
      error?: string;
    };

    if (!result.success) {
      throw new Error(result.error || 'API returned unsuccessful response');
    }

    return result.data;
  }

  async releaseStewardClaim(params: { steward_id: string; worker_id: string; claim_id: string }): Promise<void> {
    const token = await this.getAuthToken();

    const response = await fetchWithRetry(
      `${this.baseUrl}/api/worker/steward/release?token=${encodeURIComponent(token)}`,
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

    const result = await response.json() as {
      success: boolean;
      error?: string;
    };

    if (!result.success) {
      throw new Error(result.error || 'API returned unsuccessful response');
    }
  }

  async nextStewardWork(): Promise<StewardNextResource | null> {
    const token = await this.getAuthToken();

    const response = await fetchWithRetry(
      `${this.baseUrl}/api/steward/backlog/claim/next?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: {
          'x-authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const result = await response.json() as {
      success: boolean;
      data: StewardNextResource | null;
      error?: string;
    };

    if (!result.success) {
      throw new Error(result.error || 'API returned unsuccessful response');
    }

    return result.data;
  }

  async topStewardBacklog(): Promise<StewardTopResource | null> {
    const token = await this.getAuthToken();

    const response = await fetchWithRetry(
      `${this.baseUrl}/api/steward/backlog/top?token=${encodeURIComponent(token)}`,
      {
        headers: {
          'x-authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const result = await response.json() as {
      success: boolean;
      data: StewardTopResource | null;
      error?: string;
    };

    if (!result.success) {
      throw new Error(result.error || 'API returned unsuccessful response');
    }

    return result.data;
  }

  async claimStewardBacklog(identifier: string): Promise<StewardNextResource> {
    const token = await this.getAuthToken();

    const response = await fetchWithRetry(
      `${this.baseUrl}/api/steward/backlog/claim?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: {
          'x-authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ identifier }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const result = await response.json() as {
      success: boolean;
      data: StewardNextResource;
      error?: string;
    };

    if (!result.success) {
      throw new Error(result.error || 'API returned unsuccessful response');
    }

    return result.data;
  }

  async listClaimedStewardBacklog(): Promise<StewardClaimedListResource[]> {
    const token = await this.getAuthToken();

    const response = await fetchWithRetry(
      `${this.baseUrl}/api/steward/backlog/claimed?token=${encodeURIComponent(token)}`,
      {
        headers: {
          'x-authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const result = await response.json() as {
      success: boolean;
      data: StewardClaimedListResource[];
      error?: string;
    };

    if (!result.success) {
      throw new Error(result.error || 'API returned unsuccessful response');
    }

    return result.data;
  }

  async unclaimStewardBacklog(identifier: string): Promise<StewardUnclaimResource> {
    const token = await this.getAuthToken();

    const response = await fetchWithRetry(
      `${this.baseUrl}/api/steward/backlog/unclaim?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: {
          'x-authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ identifier }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const result = await response.json() as {
      success: boolean;
      data: StewardUnclaimResource;
      error?: string;
    };

    if (!result.success) {
      throw new Error(result.error || 'API returned unsuccessful response');
    }

    return result.data;
  }

  async dismissStewardBacklog(identifier: string, note: string): Promise<StewardDismissResource> {
    const token = await this.getAuthToken();

    const response = await fetchWithRetry(
      `${this.baseUrl}/api/steward/backlog/dismiss?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: {
          'x-authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          identifier,
          note,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const result = await response.json() as {
      success: boolean;
      data: StewardDismissResource;
      error?: string;
    };

    if (!result.success) {
      throw new Error(result.error || 'API returned unsuccessful response');
    }

    return result.data;
  }

  async createStewardBacklog(params: StewardCreateBacklogParams): Promise<StewardNextResource> {
    const token = await this.getAuthToken();

    const response = await fetchWithRetry(
      `${this.baseUrl}/api/steward/backlog/create?token=${encodeURIComponent(token)}`,
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

    const result = await response.json() as {
      success: boolean;
      data: StewardNextResource;
      error?: string;
    };

    if (!result.success) {
      throw new Error(result.error || 'API returned unsuccessful response');
    }

    return result.data;
  }

  async createStewardNote(params: StewardCreateNoteParams): Promise<StewardNoteResource> {
    const token = await this.getAuthToken();

    const response = await fetchWithRetry(
      `${this.baseUrl}/api/steward/note/create?token=${encodeURIComponent(token)}`,
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

    const result = await response.json() as {
      success: boolean;
      data: StewardNoteResource;
      error?: string;
    };

    if (!result.success) {
      throw new Error(result.error || 'API returned unsuccessful response');
    }

    return result.data;
  }

  async getStewardMission(identifier: string): Promise<StewardMissionResource> {
    const token = await this.getAuthToken();

    const response = await fetchWithRetry(
      `${this.baseUrl}/api/steward/mission?steward=${encodeURIComponent(identifier)}&token=${encodeURIComponent(token)}`,
      {
        headers: {
          'x-authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const result = await response.json() as {
      success: boolean;
      data: StewardMissionResource;
      error?: string;
    };

    if (!result.success) {
      throw new Error(result.error || 'API returned unsuccessful response');
    }

    return result.data;
  }
}
