# Claude Agent SDK Integration Recommendation

**Date:** November 22, 2025
**Action ID:** 79afc62a-4304-4378-80a5-9fa0ea471db2
**Status:** RECOMMEND ADOPTION

## Executive Summary

After comprehensive evaluation of the Claude Agent SDK versus the current CLI invocation approach, **we recommend migrating to the SDK**. The SDK provides significant architectural, maintainability, and developer experience improvements that align well with the contextgraph agent's requirements. While migration requires moderate effort, the long-term benefits justify the investment.

**Key Findings:**
- ✅ Native TypeScript integration eliminates process spawning overhead
- ✅ Structured message streaming superior to stdout parsing
- ✅ Built-in session management and resumption capabilities
- ✅ Hook system enables better observability and control
- ⚠️ Moderate migration effort (~2-3 days)
- ⚠️ Same core limitations (cost, model constraints)

## Current Implementation Analysis

### Architecture Overview

The contextgraph agent currently uses `child_process.spawn()` to invoke the Claude CLI:

**File:** `src/claude-cli.ts`

```typescript
const shell = spawn('sh', ['-c', command], {
  cwd: options.cwd,
  stdio: ['pipe', 'pipe', 'inherit'],
  env: envVars,
});
```

**Key characteristics:**
1. **Process-based invocation**: Spawns shell subprocess with piped stdio
2. **Stream parsing**: Custom stdout parser for JSON event stream
3. **Manual formatting**: Implements custom formatters for tool use, messages
4. **Timeout management**: 20-minute timeout with manual cleanup
5. **Environment variable passing**: Git credentials via env vars
6. **Exit code handling**: Simple success/failure based on process exit

### Integration Points

The CLI is invoked from two main workflows:

1. **Execute Workflow** (`src/workflows/execute.ts:86`):
   ```typescript
   const claudeResult = await spawnClaude({
     prompt,
     cwd: workspacePath,
     gitCredentials: gitCredentials || undefined,
   });
   ```

2. **Agent Workflow** (`src/workflows/agent.ts:86`):
   - Iteratively calls `runExecute()` for each action
   - Manages multi-action execution loop
   - Currently limited to sequential execution

### Current Limitations

1. **Type Safety Issues**:
   - Manual JSON parsing of stdout with error-prone string handling
   - No compile-time validation of CLI output format
   - Custom event type definitions may drift from actual CLI behavior

2. **Process Management Overhead**:
   - Shell subprocess spawning adds latency
   - Manual timeout and cleanup logic
   - No built-in session resumption

3. **Output Parsing Complexity**:
   - Line buffering with manual split/join logic
   - Try-catch for each line parse (potential silent failures)
   - Custom formatters for tool use, thinking, etc.

4. **Limited Observability**:
   - No pre/post tool use hooks
   - Difficult to inject custom logging or validation
   - stdout/stderr mixing can complicate debugging

5. **Error Handling**:
   - Exit code only (no structured error information)
   - Stderr inherited (not captured for analysis)
   - Timeout detection via manual timer

## Claude Agent SDK Capabilities

### Core API

**Installation:**
```bash
npm install @anthropic-ai/claude-agent-sdk
```

**Primary Interface:**
```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const msg of query({
  prompt: "Execute this task",
  options: {
    cwd: "/path/to/workspace",
    maxTurns: 10,
    permissionMode: "acceptEdits",
    hooks: {
      PreToolUse: async (context) => { /* custom logic */ },
      PostToolUse: async (context) => { /* custom logic */ }
    }
  }
})) {
  if (msg.type === "result") {
    // Structured result with usage/cost data
  }
}
```

### Key Features

1. **Native TypeScript Integration**:
   - Full type definitions for all message types
   - Type-safe configuration options
   - IntelliSense support

2. **Streaming Architecture**:
   - AsyncGenerator pattern for real-time messages
   - Structured message types (assistant, user, system, result)
   - Native backpressure handling

3. **Session Management**:
   - Built-in session tracking via UUID
   - Resume capability for multi-turn conversations
   - Automatic context management and compaction

4. **Hook System** (11 events):
   - PreToolUse, PostToolUse
   - UserPromptSubmit
   - SessionStart, SessionEnd
   - Stop, SubagentStop
   - PreCompact
   - Notification
   - Each receives rich context (session ID, transcript path, tool metadata)

5. **Advanced Configuration**:
   - Model selection
   - Tool allowlisting/denylisting
   - MCP server connections
   - Custom system prompts
   - Permission mode control
   - Settings source management

6. **Result Metadata**:
   - Usage statistics (input/output tokens)
   - Cost tracking
   - Duration metrics
   - Success/error subtype classification

## Comparative Analysis

### Architecture Comparison

| Aspect | Current (CLI Spawn) | SDK Approach |
|--------|---------------------|--------------|
| **Integration** | Process spawn + stdio | Native async/await |
| **Type Safety** | Manual parsing, custom types | Full TypeScript definitions |
| **Streaming** | Stdout line buffering | AsyncGenerator pattern |
| **Error Handling** | Exit codes | Structured error messages |
| **Session Management** | None | Built-in resume capability |
| **Observability** | Limited (stdout only) | Rich hooks system |
| **Configuration** | CLI args + env vars | Typed options object |
| **Result Data** | Exit code | Usage, cost, duration, status |

### Functional Comparison

#### Advantages of SDK

1. **Developer Experience**:
   - No shell escaping or argument formatting
   - IntelliSense and compile-time validation
   - Simpler async/await patterns vs spawn callbacks

2. **Production Features**:
   - Automatic session tracking for audit logs
   - Cost/usage reporting for budget management
   - Structured error types for better error handling

3. **Extensibility**:
   - Custom tools via MCP integration
   - Programmatic subagent orchestration
   - Hook-based workflow customization

4. **Performance**:
   - Eliminates process spawn overhead
   - Native streaming (no line buffering)
   - Potential for connection pooling/reuse

5. **Maintainability**:
   - Official Anthropic support and updates
   - Type definitions track API changes
   - Reduced custom parsing code

#### Advantages of Current Approach

1. **Simplicity**:
   - Known quantity (already working)
   - Fewer dependencies (no SDK package)
   - Direct CLI invocation (easy to debug)

2. **Flexibility**:
   - Can use any Claude CLI version
   - Easy to test with different CLI configurations
   - Isolated from SDK API changes

3. **Risk**:
   - Zero migration risk
   - No testing required for SDK compatibility
   - No potential SDK bugs

### Feature Parity Analysis

| Feature | Current | SDK | Notes |
|---------|---------|-----|-------|
| Execute prompt in workspace | ✅ | ✅ | Both support |
| Pass git credentials | ✅ | ✅ | SDK uses options, not env vars |
| Stream tool use events | ✅ | ✅ | SDK has richer message types |
| Handle execution errors | ⚠️ | ✅ | SDK has structured errors |
| Session resumption | ❌ | ✅ | SDK only |
| Cost/usage tracking | ❌ | ✅ | SDK only |
| Custom hooks/callbacks | ❌ | ✅ | SDK only |
| Timeout management | ✅ | ⚠️ | Custom in both |
| Multi-turn conversations | ⚠️ | ✅ | SDK native, CLI requires re-spawn |

**Legend:** ✅ Fully supported | ⚠️ Partial support | ❌ Not supported

## Migration Analysis

### Integration Complexity

**Estimated Effort:** 2-3 developer days

**Migration Scope:**

1. **Replace spawn logic** (`src/claude-cli.ts`):
   - Remove: spawn, stdio piping, line buffering
   - Add: SDK query() call, message iteration
   - **Complexity:** Medium (rewrite core execution)

2. **Update type definitions** (`src/types/actions.ts`):
   - Replace: Custom ClaudeEvent types
   - Add: SDK message type imports
   - **Complexity:** Low (mostly imports)

3. **Modify workflow integration** (`src/workflows/execute.ts`):
   - Update: spawnClaude() calls
   - Add: Structured result handling
   - **Complexity:** Low (minimal changes)

4. **Add hooks for observability**:
   - Add: PreToolUse/PostToolUse logging
   - Add: Session tracking
   - **Complexity:** Low (optional enhancement)

5. **Update tests**:
   - Modify: Test expectations for new message types
   - Add: SDK-specific test cases
   - **Complexity:** Medium (test coverage)

### Breaking Changes

**User-Facing:**
- None (same CLI interface)
- Internal implementation change only

**Developer-Facing:**
- `ClaudeResult` type may change structure
- Event formatting logic replaced

### Migration Strategy

**Phase 1: Parallel Implementation** (Day 1)
1. Install SDK dependency
2. Create `src/claude-sdk.ts` alongside existing `claude-cli.ts`
3. Implement SDK-based execution with same interface
4. Add feature flag to switch between implementations

**Phase 2: Feature Parity** (Day 1-2)
1. Implement formatting for SDK messages
2. Add hook-based logging
3. Handle errors and edge cases
4. Ensure timeout behavior matches

**Phase 3: Testing & Validation** (Day 2)
1. Unit tests for SDK wrapper
2. Integration tests with real actions
3. Compare cost, latency, success rates
4. Validate error handling scenarios

**Phase 4: Migration & Cleanup** (Day 3)
1. Switch default to SDK implementation
2. Monitor production usage
3. Remove old CLI spawn code
4. Update documentation

**Rollback Plan:**
- Keep CLI implementation as fallback initially
- Feature flag allows instant rollback
- Monitor for 1-2 weeks before final removal

### Risks & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| SDK has bugs | Medium | High | Parallel implementation, gradual rollout |
| Breaking API changes | Low | High | Pin SDK version, monitor releases |
| Different behavior | Medium | Medium | Comprehensive testing, comparison |
| Performance regression | Low | Low | Benchmark before/after |
| Increased bundle size | Low | Low | Tree-shaking, ESM optimization |

## Architectural Impact

### Current Architecture

```
User Command
    ↓
CLI (commander)
    ↓
Workflow (execute.ts)
    ↓
spawnClaude() [spawn subprocess]
    ↓
Parse stdout [manual JSON]
    ↓
Format events [custom logic]
    ↓
Return exit code
```

### Proposed Architecture

```
User Command
    ↓
CLI (commander)
    ↓
Workflow (execute.ts)
    ↓
SDK query() [native async]
    ↓
Iterate messages [AsyncGenerator]
    ↓
Process structured messages [typed]
    ↓
Hooks: logging, validation, etc.
    ↓
Return structured result
```

### Benefits

1. **Cleaner separation**: SDK handles Claude communication, app handles business logic
2. **Better testability**: Mock SDK messages vs mocking process spawn
3. **Enhanced observability**: Hooks enable audit logging, metrics collection
4. **Future extensibility**: Easy to add custom tools, multi-agent orchestration

## Use Case Analysis

### Contextgraph Agent Requirements

1. **Execute actions in workspaces** ✅
   - SDK: Native `cwd` option
   - Current: Shell working directory

2. **Pass repository credentials** ✅
   - SDK: Via options or environment
   - Current: Environment variables

3. **Track execution progress** ✅✅
   - SDK: Rich message stream, hooks
   - Current: Stdout parsing

4. **Handle long-running tasks** ✅
   - SDK: Same timeout approach needed
   - Current: Manual 20-minute timeout

5. **Future: Multi-repository execution** ✅✅
   - SDK: Programmatic orchestration, subagents
   - Current: Would require complex spawn management

6. **Future: Session resumption** ✅
   - SDK: Built-in resume capability
   - Current: Would require custom session storage

### SDK Advantages for This Use Case

1. **Autonomous Agent Loop**:
   - Structured messages enable better decision-making
   - Session IDs support action tracking
   - Cost data helps prevent runaway execution

2. **Multi-Action Execution**:
   - Programmatic control over concurrent agents
   - Better resource management than spawn pool
   - Shared context across related actions

3. **Observability**:
   - Hooks enable action-level audit logs
   - Tool use tracking for debugging
   - Session transcripts for post-execution analysis

4. **Future Enhancements**:
   - Custom MCP tools for contextgraph API integration
   - Subagents for specialized tasks (planning, execution, review)
   - Advanced permission controls for safe autonomous operation

## Recommendations

### Primary Recommendation: ADOPT SDK

**Rationale:**
1. **Better Developer Experience**: TypeScript integration, structured messages, native async patterns
2. **Production Features**: Session management, usage tracking, structured errors
3. **Future-Proofing**: Extensibility for multi-agent, custom tools, advanced workflows
4. **Maintainability**: Official support, type definitions, reduced custom code
5. **Risk is Manageable**: Parallel implementation, gradual rollout, clear rollback plan

**Confidence Level:** High

The SDK provides tangible benefits that outweigh the migration effort. The current spawn-based approach works but limits extensibility and creates technical debt through custom parsing logic.

### Implementation Approach

**Recommended Strategy: Phased Migration**

1. **Short Term (Sprint 1)**:
   - Install SDK and create parallel implementation
   - Achieve feature parity with current approach
   - Comprehensive testing

2. **Medium Term (Sprint 2)**:
   - Switch to SDK as default
   - Add hook-based logging and observability
   - Monitor production usage

3. **Long Term (Sprint 3+)**:
   - Remove old CLI spawn code
   - Explore advanced SDK features (subagents, custom tools)
   - Consider multi-agent orchestration

### Alternative: DEFER ADOPTION

**If migration timing is a concern:**

The current approach is functional and could remain in place. However, we recommend deferring rather than rejecting, since:

1. **Technical Debt Accumulates**: Custom parsing code needs maintenance
2. **Opportunity Cost**: Missing out on SDK improvements and features
3. **Future Migration Harder**: More code built on current approach = harder migration

**Defer only if:**
- Current sprint is time-constrained
- Other critical priorities exist
- Team bandwidth is limited

**Re-evaluate in:** 1-2 months

### Reject Scenario

**Reasons to reject SDK adoption:**

We found **no compelling reasons** to permanently reject the SDK. The only valid long-term rejection scenario would be:

1. SDK proves unreliable in production (requires trial to discover)
2. Anthropic discontinues SDK support (low probability)
3. Fundamental architectural mismatch (not evident from analysis)

## Appendix

### A. SDK Dependencies

```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^1.0.0"
  }
}
```

**Impact:**
- Package size: ~50KB (acceptable for Node.js CLI)
- No transitive dependency concerns
- ESM-only package (matches current architecture)
- Requires Node.js 18+ (already required)

### B. Example SDK Implementation

```typescript
// src/claude-sdk.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export interface ClaudeResult {
  exitCode: number;
  sessionId?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  cost?: number;
}

export interface SpawnClaudeOptions {
  prompt: string;
  cwd: string;
  gitCredentials?: {
    githubToken?: string;
    gitlabToken?: string;
  };
}

export async function executeClaude(
  options: SpawnClaudeOptions
): Promise<ClaudeResult> {
  const messages: SDKMessage[] = [];
  let sessionId: string | undefined;
  let usage: any;
  let cost: number | undefined;

  try {
    for await (const msg of query({
      prompt: options.prompt,
      options: {
        cwd: options.cwd,
        maxTurns: 50,
        permissionMode: "acceptEdits",
        env: {
          ...(options.gitCredentials?.githubToken && {
            GITHUB_TOKEN: options.gitCredentials.githubToken
          }),
          ...(options.gitCredentials?.gitlabToken && {
            GITLAB_TOKEN: options.gitCredentials.gitlabToken
          })
        },
        hooks: {
          PreToolUse: async (context) => {
            console.log(`🔧 Using tool: ${context.tool}`);
          },
          PostToolUse: async (context) => {
            console.log(`✅ Tool completed: ${context.tool}`);
          }
        }
      }
    })) {
      messages.push(msg);

      // Track session ID from first message
      if (!sessionId && msg.type === "assistant" && "session_id" in msg) {
        sessionId = msg.session_id;
      }

      // Format and display messages
      if (msg.type === "assistant" && "message" in msg) {
        formatAssistantMessage(msg.message);
      } else if (msg.type === "result") {
        usage = msg.usage;
        cost = msg.cost;

        if (msg.subtype === "success") {
          console.log(`✅ Completed successfully`);
          return { exitCode: 0, sessionId, usage, cost };
        } else {
          console.error(`❌ Execution failed`);
          return { exitCode: 1, sessionId, usage, cost };
        }
      }
    }

    // If we get here without a result, something went wrong
    return { exitCode: 1, sessionId, usage, cost };
  } catch (error) {
    console.error(`Error executing Claude: ${error}`);
    return { exitCode: 1 };
  }
}

function formatAssistantMessage(message: any) {
  // Similar formatting logic to current implementation
  // ... (tool use, thinking, text content formatting)
}
```

### C. Testing Checklist

**Unit Tests:**
- [ ] SDK wrapper handles all message types
- [ ] Error handling for network failures
- [ ] Timeout behavior
- [ ] Credential passing
- [ ] Result structure validation

**Integration Tests:**
- [ ] Execute simple action end-to-end
- [ ] Handle action with tool use (Read, Edit, Write, Bash)
- [ ] Multi-turn conversation flow
- [ ] Repository with git credentials
- [ ] Error scenarios (auth failure, timeout)

**Performance Tests:**
- [ ] Compare execution time vs spawn
- [ ] Memory usage comparison
- [ ] Concurrent execution (3+ actions)
- [ ] Large workspace handling

**Acceptance Criteria:**
- [ ] All current features work with SDK
- [ ] No regression in success rate
- [ ] Execution time within 10% of current
- [ ] Error messages are informative
- [ ] Documentation updated

### D. Documentation Updates Required

1. **README.md**: Update architecture section
2. **CONTRIBUTING.md**: Add SDK development notes
3. **API_REFERENCE.md**: Document SDK wrapper API
4. **CHANGELOG.md**: Note SDK migration

### E. References

- [Claude Agent SDK Overview](https://docs.claude.com/en/api/agent-sdk/overview)
- [Claude Agent SDK TypeScript Reference](https://docs.claude.com/en/api/agent-sdk/typescript)
- [Building Agents with Claude Agent SDK - Anthropic Engineering](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)
- [GitHub - anthropics/claude-agent-sdk-typescript](https://github.com/anthropics/claude-agent-sdk-typescript)
- [Claude Code vs. Claude Agent SDK Comparison](https://drlee.io/claude-code-vs-claude-agent-sdk-whats-the-difference-177971c442a9)

---

**Prepared by:** Claude (AI Agent)
**Review Status:** Ready for team review
**Next Steps:** Discuss with team, approve migration, schedule implementation
