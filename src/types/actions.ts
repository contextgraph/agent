// Type definitions extracted from actionbias for agent functionality

// ============================================================================
// Credentials and Authentication Types
// ============================================================================

export type Credentials = {
  clerkToken: string;
  userId: string;
  email?: string;
  expiresAt: string;
  createdAt: string;
};

// GitHub credentials returned from /api/cli/credentials
export interface GitHubCredentials {
  githubToken: string;
  githubUsername?: string;
  githubEmail?: string;
  gitCredentialsUsername?: string; // Username for git clone URLs (e.g., 'x-access-token' for GitHub App tokens)
}

export type CallbackResult = {
  token: string;
  userId: string;
  email?: string;
};

// ============================================================================
// Agent Runner Types
// ============================================================================

export type AgentRunResult = {
  exitCode: number;
  sessionId?: string;  // SDK-specific: session identifier
  usage?: any;         // SDK-specific: token usage stats
  cost?: number;       // SDK-specific: total cost in USD
};

export type AgentRunOptions = {
  prompt: string;
  cwd: string;
  authToken?: string;  // Optional auth token for MCP server
  executionActionId?: string; // Optional execution scope action ID for MCP enforcement
};

// Backward-compatible aliases for existing Claude-specific naming
export type ClaudeResult = AgentRunResult;
export type SpawnClaudeOptions = AgentRunOptions;

// ============================================================================
// Action Resource Types (from MCP)
// ============================================================================

export interface ActionNode {
  id: string;
  title: string;
  done: boolean;
  prepared?: boolean; // Preparation status for autonomous execution
  parent_id?: string;
  repository_url?: string | null; // Direct repository_url from action
  resolved_repository_url?: string; // Inherited/resolved URL from parent chain
  branch?: string | null; // Direct branch from action
  resolved_branch?: string; // Inherited/resolved branch from parent chain
  children?: ActionNode[]; // Optional: omitted when hasChildren is true at max depth
  hasChildren?: boolean; // True if action has children beyond max depth limit
  dependencies: Array<{
    id: string;
    title: string;
    done: boolean;
  }>; // Dependencies with completion status
  complexity?: {
    score: number;
    level: 'trivial' | 'low' | 'medium' | 'high' | 'very_high';
    confidence: number;
    hasChildren?: boolean; // Indicates if this action has children (for decomposition recommendation)
  };
}

export interface ActionTreeResource {
  rootActions: ActionNode[];
  rootAction?: string; // For scoped trees, the ID of the root action
  scope?: string; // For scoped trees, the ID of the scope action
}

export interface ActionDetailResource {
  id: string;
  graphId?: string | null;
  title: string;
  description?: string;
  vision?: string;
  freeformInput?: string;
  done: boolean;
  prepared?: boolean; // Preparation status for autonomous execution
  reviewed?: boolean; // Post-completion review status
  learned?: boolean; // Learning extraction completion status
  version: number | null;
  created_at: string;
  updated_at: string;
  repository_url?: string | null;
  resolved_repository_url?: string | null;
  branch?: string | null;
  resolved_branch?: string | null;
  resolved_repositories?: Array<{url: string; branch?: string}>;
  parent_id?: string;
  parent_chain: ActionMetadata[]; // all parent actions up to root
  family_context_summary?: string; // AI-generated summary of family context
  family_vision_summary?: string; // AI-generated summary of family vision
  execution_focused_summary?: string; // AI-generated zoom-out summary (execution-focused)
  planning_focused_summary?: string; // AI-generated zoom-in summary (planning-focused)
  summaries_generated_at?: string; // When summaries were last generated
  summaries_stale_at?: string; // When summaries became stale
  children: ActionMetadata[];
  dependencies: ActionMetadata[]; // actions this depends on
  dependents: ActionMetadata[]; // actions that depend on this one
  siblings: ActionMetadata[]; // same-parent actions (excluding current action)
  relationship_flags: RelationshipFlags; // indicates which lists each action appears in
  dependency_completion_context: DependencyCompletionContext[]; // completion context from dependencies
  completion_context?: DependencyCompletionContext; // action's own completion context if completed
  claim_id?: string; // Claim ID when action is claimed by a worker
}

// Relationship flags to help clients avoid duplicate display
export interface RelationshipFlags {
  [action_id: string]: string[]; // array of relationship types: 'ancestor', 'child', 'dependency', 'dependent', 'sibling'
}

// Completion context from dependencies for enhanced knowledge transfer
export interface DependencyCompletionContext {
  action_id: string;
  action_title: string;
  completion_timestamp: string;
  implementation_story?: string;
  impact_story?: string;
  learning_story?: string;
  changelog_visibility: string;
  // Magazine-style editorial content
  headline?: string;
  deck?: string;
  pull_quotes?: string[];
  // Multi-template content
  templateContent?: {
    engineering?: {
      headline?: string;
      deck?: string;
      implementation_story?: string;
      impact_story?: string;
      pull_quotes?: string[];
      importance?: 'high' | 'medium' | 'low';
    };
    business?: {
      headline?: string;
      deck?: string;
      impact_story?: string;
      strategic_implications?: string;
      pull_quotes?: string[];
      importance?: 'high' | 'medium' | 'low';
    };
    customer?: {
      headline?: string;
      announcement?: string;
      feature_highlights?: string;
      user_benefits?: string;
      pull_quotes?: string[];
      importance?: 'high' | 'medium' | 'low';
    };
  };
  // Objective completion data
  technical_changes?: {
    files_modified?: string[];
    files_created?: string[];
    functions_added?: string[];
    apis_modified?: string[];
    dependencies_added?: string[];
    config_changes?: string[];
  };
  outcomes?: {
    features_implemented?: string[];
    bugs_fixed?: string[];
    performance_improvements?: string[];
    tests_passing?: boolean;
    build_status?: "success" | "failed" | "unknown";
  };
  challenges?: {
    blockers_encountered?: string[];
    blockers_resolved?: string[];
    approaches_tried?: string[];
    discoveries?: string[];
  };
  alignment_reflection?: {
    purpose_interpretation?: string;
    goal_achievement_assessment?: string;
    context_influence?: string;
    assumptions_made?: string[];
  };
  // Git context information
  git_context?: {
    commits?: Array<{
      hash?: string;
      shortHash?: string;
      message: string;
      author?: {
        name: string;
        email?: string;
        username?: string;
      };
      timestamp?: string;
      branch?: string;
      repository?: string;
      stats?: {
        filesChanged?: number;
        insertions?: number;
        deletions?: number;
        files?: string[];
      };
    }>;
    pullRequests?: Array<{
      number?: number;
      title: string;
      url?: string;
      repository?: string;
      author?: {
        name?: string;
        username?: string;
      };
      state?: 'open' | 'closed' | 'merged' | 'draft';
      merged?: boolean;
      mergedAt?: string;
      branch?: {
        head: string;
        base: string;
      };
    }>;
    repositories?: Array<{
      name: string;
      url?: string;
      platform?: 'github' | 'gitlab' | 'other';
    }>;
  };
}

export interface ActionMetadata {
  id: string;
  title: string;
  description?: string;
  vision?: string;
  freeformInput?: string;
  done: boolean;
  version: number | null;
  created_at: string;
  updated_at: string;
  repository_url?: string | null;
  branch?: string | null;
}
