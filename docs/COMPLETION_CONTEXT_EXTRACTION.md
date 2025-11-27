# Completion Context Extraction from Claude Agent SDK

**Status**: ✅ Validated
**Date**: 2025-11-27
**Action ID**: d52569f4-267d-4315-b401-db3e32b90318

## Executive Summary

This document answers how to capture completion context (technical_changes, outcomes, challenges) after Claude Agent SDK execution completes. The key finding: **Claude handles completion automatically via MCP tool calls** - the worker doesn't need to parse or extract completion context from SDK responses.

## Questions Answered

### 1. Does the SDK return completion data in a structured format?

**No** - The SDK does not return completion context data in its result.

The SDK's `ClaudeResult` type contains only execution metadata:

```typescript
export type ClaudeResult = {
  exitCode: number;
  sessionId?: string;  // SDK-specific: session identifier
  usage?: any;         // SDK-specific: token usage stats
  cost?: number;       // SDK-specific: total cost in USD
};
```

**Why this doesn't matter**: The execution prompt instructs Claude to call the MCP complete tool directly, which sends completion context to the backend. The worker doesn't need to capture it from the SDK response.

### 2. Do we need to parse execution logs/transcripts?

**No** - Parsing is not required.

The SDK message stream contains:
- `SDKSystemMessage` (type: 'system') - initialization
- `SDKAssistantMessage` (type: 'assistant') - Claude's responses and tool calls
- `SDKResultMessage` (type: 'result') - final execution status

While `SDKAssistantMessage` messages contain tool call information, we don't need to parse them because:
1. The completion context is sent directly to the backend via MCP tool
2. The worker's only concern is whether execution succeeded (exitCode === 0)

### 3. How do we extract the specific fields needed for MCP complete tool?

**We don't** - Claude extracts and sends them automatically.

The execution prompt (from `/api/prompts/execute`) instructs Claude to:
1. Perform the work described in the action
2. Observe what changed (files, commits, tests, etc.)
3. Call `mcp__plugin_contextgraph_actions__complete` with the completion context

Example of what Claude does internally:
```typescript
// Claude calls this tool during execution (not the worker)
mcp__plugin_contextgraph_actions__complete({
  action_id: "d52569f4-267d-4315-b401-db3e32b90318",
  changelog_visibility: "public",
  technical_changes: {
    files_modified: ["src/workflows/execute.ts", "docs/COMPLETION_CONTEXT_EXTRACTION.md"],
    files_created: ["examples/completion-extraction.ts"],
    functions_added: ["extractCompletionContext"],
    apis_modified: [],
    dependencies_added: [],
    config_changes: []
  },
  outcomes: {
    features_implemented: [],
    bugs_fixed: [],
    performance_improvements: [],
    tests_passing: true,
    build_status: "success"
  },
  challenges: {
    blockers_encountered: [],
    blockers_resolved: [],
    approaches_tried: [],
    discoveries: ["SDK doesn't expose completion context - Claude handles it via MCP"]
  }
})
```

### 4. Is there existing code that does this we can reference?

**Yes** - The current `runExecute()` workflow demonstrates the pattern:

**File**: `src/workflows/execute.ts`

```typescript
export async function runExecute(actionId: string, options?: WorkflowOptions): Promise<void> {
  const credentials = await loadCredentials();

  // Validation omitted for brevity...

  // Fetch execution prompt from backend
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

  const { prompt } = await response.json();

  // Execute with SDK - Claude handles completion via MCP tool
  const claudeResult = await executeClaude({
    prompt,
    cwd: options?.cwd || process.cwd(),
    authToken: credentials.clerkToken,  // Enables MCP authentication
  });

  // Worker only checks if execution succeeded
  if (claudeResult.exitCode !== 0) {
    console.error(`\n❌ Claude execution failed with exit code ${claudeResult.exitCode}`);
    process.exit(1);
  }

  console.log('\n✅ Execution complete');
  // No need to call complete - Claude already did it via MCP tool!
}
```

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Worker Process                              │
│                                                                       │
│  1. Load credentials                                                  │
│  2. Fetch execution prompt (includes action ID, description, etc.)   │
│  3. Call executeClaude() with prompt + authToken                    │
│     │                                                                 │
│     └──────────────────────────────────────────────┐                │
│                                                      │                │
└──────────────────────────────────────────────────────┼────────────────┘
                                                       │
                                                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Claude Agent SDK                                  │
│                                                                       │
│  • Receives prompt + authToken                                       │
│  • Sets CONTEXTGRAPH_AUTH_TOKEN env var                             │
│  • Loads contextgraph plugin                                         │
│  • Executes Claude in working directory                             │
│  • Provides MCP tools to Claude                                      │
│     │                                                                 │
│     └──────────────────────────────────────────────┐                │
│                                                      │                │
└──────────────────────────────────────────────────────┼────────────────┘
                                                       │
                                                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Claude (AI Agent)                               │
│                                                                       │
│  1. Read action description and current code                         │
│  2. Implement changes (edit files, run tests, etc.)                 │
│  3. Observe what changed:                                            │
│     - Which files were modified/created                              │
│     - What functions were added                                      │
│     - Whether tests pass                                             │
│     - Any challenges encountered                                     │
│  4. Call mcp__plugin_contextgraph_actions__complete                 │
│     with completion context ─────────────────────────┐              │
│                                                        │              │
└────────────────────────────────────────────────────────┼──────────────┘
                                                         │
                                                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    MCP Server (contextgraph)                         │
│                                                                       │
│  • Authenticates via CONTEXTGRAPH_AUTH_TOKEN                         │
│  • Receives completion context from Claude                           │
│  • Updates action in database:                                       │
│    - Sets done: true                                                 │
│    - Stores completion_context                                       │
│    - Clears claim fields (claimed_by, claim_id, claimed_at)         │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

## Worker Implementation Pattern

The worker's responsibility is simple:

```typescript
async function processAction(actionId: string, credentials: Credentials) {
  // 1. Fetch execution prompt
  const { prompt } = await fetchExecutionPrompt(actionId, credentials.clerkToken);

  // 2. Execute with SDK (Claude handles completion internally)
  const result = await executeClaude({
    prompt,
    cwd: process.cwd(),
    authToken: credentials.clerkToken,
  });

  // 3. Check if execution succeeded
  if (result.exitCode !== 0) {
    console.error('Execution failed');
    // Action remains claimed, can be retried
    return;
  }

  console.log('Execution complete');
  // Action is now marked done, claim is cleared
  // No explicit completion call needed!
}
```

## Complete MCP Tool Schema

For reference, here's what Claude sends to the MCP complete tool:

```typescript
interface CompleteActionParams {
  // REQUIRED
  action_id: string;  // UUID of the action being completed
  changelog_visibility: "private" | "team" | "public";

  // REQUIRED: Objective technical changes made
  technical_changes: {
    files_modified?: string[];        // Paths of files changed
    files_created?: string[];         // Paths of new files
    functions_added?: string[];       // Names of new functions
    apis_modified?: string[];         // API endpoints changed
    dependencies_added?: string[];    // New deps with versions
    config_changes?: string[];        // Configuration changes
  };

  // REQUIRED: Objective outcomes achieved
  outcomes: {
    features_implemented?: string[];       // User-facing features
    bugs_fixed?: string[];                 // Specific bugs fixed
    performance_improvements?: string[];   // Measurable improvements
    tests_passing?: boolean;               // Test status
    build_status?: "success" | "failed" | "unknown";
  };

  // REQUIRED: Objective challenges and learnings
  challenges: {
    blockers_encountered?: string[];   // Problems hit
    blockers_resolved?: string[];      // How they were solved
    approaches_tried?: string[];       // Different approaches attempted
    discoveries?: string[];            // Insights learned
  };

  // OPTIONAL: Git context (commits, PRs, repos)
  git_context?: {
    commits?: Array<{
      message: string;
      hash?: string;
      author?: { name: string; email?: string };
      // ... other git metadata
    }>;
    pullRequests?: Array<{
      title: string;
      number?: number;
      state?: "open" | "closed" | "merged" | "draft";
      // ... other PR metadata
    }>;
    repositories?: Array<{
      name: string;
      url?: string;
      platform?: "github" | "gitlab" | "other";
    }>;
  };
}
```

## Key Insights

1. **No parsing needed**: The worker doesn't extract completion context from SDK responses because Claude sends it directly to the backend via MCP tool.

2. **Separation of concerns**:
   - **Claude**: Performs work, observes changes, calls completion tool
   - **Worker**: Claims action, spawns Claude, verifies success
   - **Backend**: Stores completion context, updates action status

3. **Authentication flow**: The worker's authToken flows through the SDK to Claude's environment (CONTEXTGRAPH_AUTH_TOKEN), enabling authenticated MCP tool calls.

4. **Idempotency**: If execution fails (exitCode ≠ 0), the action remains claimed and can be retried. If it succeeds, Claude has already marked it complete.

## Testing

To validate this understanding, see:
- `src/workflows/execute.ts` - Current working implementation
- `docs/WORKER_COMPLETION_ARCHITECTURE.md` - Authentication validation
- Test runs of the execute workflow showing successful completions

## References

- **SDK wrapper**: `src/claude-sdk.ts`
- **Execute workflow**: `src/workflows/execute.ts`
- **Type definitions**: `src/types/actions.ts`
- **Completion architecture**: `docs/WORKER_COMPLETION_ARCHITECTURE.md`
- **MCP server**: https://mcp.contextgraph.dev
- **Plugin**: https://github.com/contextgraph/claude-code-plugin

## Conclusion

**Completion context extraction is already solved** - the worker doesn't need to extract it. The execution prompt instructs Claude to observe changes and call the MCP complete tool directly. The worker's job is simply to:

1. Load credentials
2. Fetch execution prompt
3. Call `executeClaude()` with prompt + authToken
4. Verify exitCode === 0

This architecture is clean, tested, and ready for the worker loop implementation.
