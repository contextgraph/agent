# Worker Completion Architecture

**Status**: ✅ Validated
**Date**: 2025-11-27

## Summary

This document validates the architecture for how workers complete actions after execution. The validation confirms that workers use the existing MCP complete tool (no new API endpoint needed), with authentication flowing through the CONTEXTGRAPH_AUTH_TOKEN environment variable and claim cleanup happening automatically.

## Architecture Overview

### Completion Flow

```
Worker → executeClaude() → Claude Agent SDK → MCP Plugin → MCP Server
                              ↓
                    CONTEXTGRAPH_AUTH_TOKEN
                              ↓
                    mcp__plugin_contextgraph_actions__complete
```

### Components Validated

#### 1. Worker Execution Context (`src/workflows/execute.ts`)

**Lines 46-50**:
```typescript
const claudeResult = await executeClaude({
  prompt,
  cwd: options?.cwd || process.cwd(),
  authToken: credentials.clerkToken,  // ← Auth token passed to SDK
});
```

✅ **Validated**: Workers load credentials and pass auth token to Claude SDK

#### 2. SDK Authentication Flow (`src/claude-sdk.ts`)

**Lines 148-168**:
```typescript
const iterator = query({
  prompt: options.prompt,
  options: {
    cwd: options.cwd,
    permissionMode: 'bypassPermissions',
    env: {
      ...process.env,
      // Pass auth token through environment for MCP server
      CONTEXTGRAPH_AUTH_TOKEN: options.authToken || '',  // ← Token set as env var
    },
    plugins: [
      {
        type: 'local',
        path: pluginPath,  // ← Points to contextgraph plugin
      }
    ]
  }
});
```

✅ **Validated**: SDK receives auth token and passes it to MCP server via environment variable

#### 3. MCP Plugin Configuration

**Plugin Path**: `~/.contextgraph/claude-code-plugin/plugins/contextgraph/.claude-plugin/plugin.json`

```json
{
  "name": "contextgraph",
  "mcpServers": {
    "actions": {
      "type": "http",
      "url": "https://mcp.contextgraph.dev"  // ← MCP server endpoint
    }
  }
}
```

✅ **Validated**: Plugin properly configured to connect to contextgraph MCP server

#### 4. MCP Complete Tool

**Tool**: `mcp__plugin_contextgraph_actions__complete`

The MCP server exposes this tool which:
- Accepts completion context (technical changes, outcomes, challenges)
- Marks action as `done: true`
- **Automatically clears claim fields** (claimed_by, claim_id, claimed_at) ← Implemented in backend

✅ **Validated**: Workers can call this tool directly from Claude's execution context

## Authentication Flow

1. **Worker startup**: Load credentials from `~/.contextgraph/credentials.json`
2. **SDK invocation**: Pass `clerkToken` as `authToken` parameter to `executeClaude()`
3. **Environment variable**: SDK sets `CONTEXTGRAPH_AUTH_TOKEN` in Claude's environment
4. **MCP server auth**: MCP server reads `CONTEXTGRAPH_AUTH_TOKEN` from environment to authenticate requests
5. **Tool execution**: Claude can now call MCP tools like `mcp__plugin_contextgraph_actions__complete`

## Claim Cleanup

**Status**: ✅ Already implemented in backend (commit 30006659)

When `mcp__plugin_contextgraph_actions__complete` is called with `done: true`:
- Backend service (`lib/services/actions.ts`) automatically clears:
  - `claimed_by`
  - `claim_id`
  - `claimed_at`

This was confirmed by sibling action completion context:
> "Worker API Endpoints completion states: 'No separate /worker/complete endpoint needed - MCP complete tool handles it'"

> "Clear claimed_by when completing actions (1b423513) COMPLETED claim cleanup in lib/services/actions.ts"

## Decision: No New Endpoint Needed

**Architectural Decision**: Workers will use the existing MCP complete tool, NOT a separate /worker/complete API endpoint.

**Rationale**:
1. ✅ MCP authentication already works through CONTEXTGRAPH_AUTH_TOKEN
2. ✅ Claim cleanup already implemented in backend service layer
3. ✅ Simpler architecture - no duplicate completion paths
4. ✅ Consistent with how Claude Code completes actions

## Worker Implementation Requirements

When implementing the worker loop (parent action), workers must:

1. **Load credentials** before spawning Claude
2. **Pass auth token** to `executeClaude()`
3. **No explicit completion call needed** - Claude handles it via MCP tool in the execution prompt

Example (from `src/workflows/execute.ts`):
```typescript
const credentials = await loadCredentials();
const claudeResult = await executeClaude({
  prompt: executionPrompt,
  cwd: process.cwd(),
  authToken: credentials.clerkToken,  // ← This enables MCP tool access
});
```

## Testing

The validation test (`src/validate-mcp-auth.ts`) demonstrates:
- Loading credentials in worker context
- Passing auth token to SDK
- SDK setting CONTEXTGRAPH_AUTH_TOKEN environment variable
- Claude accessing MCP tools successfully

## References

- **Backend claim cleanup**: Commit 30006659 in contextgraph.dev repository
- **Sibling validation**: "Worker API Endpoints" action completion context
- **MCP server**: https://mcp.contextgraph.dev
- **Plugin repo**: https://github.com/contextgraph/claude-code-plugin

## Conclusion

The worker completion architecture is **fully validated** and **already implemented**:
- ✅ Workers can authenticate with MCP server via CONTEXTGRAPH_AUTH_TOKEN
- ✅ MCP complete tool is accessible from worker environment
- ✅ Claim cleanup happens automatically
- ✅ No new /worker/complete endpoint needed

The worker loop implementation can proceed with confidence that completion will work as designed.
