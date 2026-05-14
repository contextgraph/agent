# Codex Instrumentation Gaps Analysis

**Date:** February 20, 2026
**Status:** ✅ Verified
**Impact:** Critical - Blocks production Codex usage for cost optimization

## Executive Summary

Codex executions currently **bypass all Langfuse instrumentation**, resulting in:
- ❌ **Zero Langfuse traces** generated for Codex runs
- ❌ **No cost/usage data** reaching Langfuse dashboards
- ❌ **No quality scores** collected for Codex executions
- ❌ **No observability** into Codex model performance

This creates a **critical measurement blind spot** that violates the parent action's "Measurement Before Modification" principle and blocks cost optimization work.

## Root Cause Analysis

### Architecture Overview

The actions repository uses a centralized instrumentation architecture:

1. **Langfuse Integration** (`actions/instrumentation.ts`):
   - Configures OpenTelemetry with Langfuse exporter at server cold-start
   - All AI SDK calls with `experimental_telemetry` enabled flow to Langfuse
   - Quality scores reported via direct Langfuse SDK calls

2. **LLMService** (`actions/lib/services/llm/index.ts`):
   - Centralized wrapper for all AI calls in the actions repo
   - Adds `experimental_telemetry` to every generation
   - Reports quality scores after each operation

### The Bypass Problem

**Codex Runner** (`agent/src/runners/codex-runner.ts`):
```typescript
// Line 228: Spawns external CLI process
const proc = spawn('codex', args, {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...childEnv }
});
```

**Critical finding:** The Codex runner spawns an **external CLI process** that:
1. Runs in a completely separate process space
2. Does NOT use the AI SDK
3. Does NOT call `LLMService`
4. Does NOT have access to the actions repo's instrumentation setup
5. Communicates only via JSONL events on stdout/stderr

**Verification:**
```bash
$ grep -r "langfuse\|Langfuse" agent/ --include="*.ts"
# Returns: ZERO results
```

The agent repository has **zero Langfuse dependencies**, zero instrumentation code, and zero quality score reporting.

## Impact Assessment

### 1. Langfuse Tracing: ❌ Missing

**Expected:** Codex executions should generate Langfuse traces with:
- Execution timeline with tool calls
- Model provider metadata
- Prompt and response content
- Performance metrics

**Actual:** Zero traces generated. Codex runs are completely invisible to Langfuse.

**Evidence:** The Codex runner only:
- Parses JSONL events from the CLI process
- Extracts `usage` from `turn.completed` events (line 281-283)
- Extracts `cost` from events (line 285-291)
- Stores these in memory but **never forwards to Langfuse**

### 2. Cost/Usage Reporting: ❌ Data Extracted but Not Forwarded

**Expected:** Usage data from Codex events should flow to Langfuse dashboards with proper schema mapping.

**Actual:** The Codex runner **does extract** cost and usage data from JSONL events:

```typescript
// Lines 281-291
else if (eventType === 'turn.completed' && asObject(event.usage)) {
  usage = event.usage;
}

const eventCost =
  asNumber(event.total_cost_usd) ??
  asNumber(event.cost_usd) ??
  asNumber(event.total_cost);
if (eventCost !== undefined) {
  cost = eventCost;
}
```

However, this data is:
1. Returned to the workflow executor
2. Stored in the database (via workflow completion)
3. **Never sent to Langfuse**

The parent action's instrumentation can see Codex's outer workflow wrapper but not the internal model calls happening inside the spawned CLI process.

### 3. Quality Score Collection: ❌ Missing

**Expected:** Quality scores should be collected for Codex executions to establish baselines.

**Actual:** Quality scores are only reported via `LLMService.generateTextWithTools()` and `LLMService.generateObject()`. Codex never calls these methods.

The quality score reporting code (`actions/lib/services/llm/quality-scores.ts`) requires:
- A Langfuse trace ID
- Direct Langfuse SDK client
- Service/operation context

None of this infrastructure exists in the agent repository.

### 4. Schema Differences: ⚠️ Unknown

**Finding:** Cannot document schema differences between Codex and Claude cost reporting because Codex data never reaches Langfuse to be compared.

The Codex JSONL format may differ from AI SDK's output, but this is currently academic since the data isn't forwarded anywhere.

## Comparison: Claude vs Codex Instrumentation

| Feature | Claude (AI SDK) | Codex (CLI) | Status |
|---------|----------------|-------------|--------|
| **Langfuse Traces** | ✅ Via OpenTelemetry | ❌ Not integrated | Missing |
| **Usage Data** | ✅ Via experimental_telemetry | ⚠️ Extracted but not forwarded | Blocked |
| **Cost Data** | ✅ Via experimental_telemetry | ⚠️ Extracted but not forwarded | Blocked |
| **Quality Scores** | ✅ Via LLMService | ❌ Not instrumented | Missing |
| **Model Metadata** | ✅ Via provider config | ❌ Unknown to instrumentation | Missing |
| **Tool Call Tracing** | ✅ Via AI SDK hooks | ❌ Only JSONL events | Limited |

## Architectural Constraints

### Why This Architecture Exists

1. **Separation of Concerns:**
   - `actions/` repo: Web application + orchestration layer
   - `agent/` repo: Standalone CLI + worker process

2. **Deployment Isolation:**
   - Actions repo deploys to Vercel (serverless)
   - Agent repo deploys as workers/CLI tool

3. **Codex as External Dependency:**
   - Codex CLI is an external binary (like `git` or `docker`)
   - Process boundary is necessary for security/sandboxing
   - JSONL streaming is Codex's public interface

### Why Simple Solutions Won't Work

❌ **"Just add Langfuse to agent repo"**
- Would create duplicate instrumentation infrastructure
- Breaks separation between orchestration (actions) and execution (agent)
- Agent workers would need direct Langfuse credentials

❌ **"Use AI SDK in Codex runner"**
- Codex CLI is the actual executor, not our code
- We can't control what LLM client Codex uses internally
- Process boundary is necessary for sandboxing

## Implications for Cost Optimization

Per the parent action's "Measurement Before Modification" principle:

> Cost optimization cannot proceed until failure visibility is deployed and **baselines have stabilized over 2+ weeks**.

**Current Status:**
- ✅ Claude execution baselines: Being collected via Langfuse
- ❌ Codex execution baselines: **Zero data collection**

**Blocker:** Cannot establish Codex cost baselines without instrumentation. Any cost optimization decisions involving Codex would be flying blind.

## Recommended Next Steps

This verification action is complete. The gaps are now documented. Next steps should be separate actions:

### Option 1: Bridge Architecture (Recommended)
Create a telemetry bridge that:
1. Accepts JSONL events from Codex runner
2. Translates to Langfuse trace format
3. Forwards to Langfuse from the workflow layer

**Pros:**
- Preserves architectural separation
- Minimal changes to agent repo
- Single source of truth for credentials

**Cons:**
- Schema mapping complexity
- Potential data loss if translation is imperfect

### Option 2: Agent-Side Instrumentation
Add Langfuse SDK to agent repo:
1. Initialize Langfuse client in agent workers
2. Report traces/scores from Codex runner
3. Duplicate instrumentation configuration

**Pros:**
- Direct integration, no translation layer
- Could instrument other agent-side operations

**Cons:**
- Duplicates infrastructure across repos
- Breaks separation of concerns
- Requires credential distribution to workers

### Option 3: Accept the Limitation
Document that Codex executions are unmonitored:
1. Track only aggregate usage via workflow completion data
2. Optimize based on end-to-end metrics, not per-call metrics
3. Accept blind spot for model-level performance

**Pros:**
- No engineering work required
- Architectural boundaries remain clean

**Cons:**
- Cannot optimize Codex provider/model selection
- Cannot detect Codex quality regressions
- Violates "Measurement Before Modification" principle

## Conclusion

**Verification complete:** Codex executions do NOT trigger the same Langfuse instrumentation pipeline as Claude events.

**Gap summary:**
1. ❌ Codex executions generate zero Langfuse traces (architectural bypass)
2. ⚠️ Cost/usage data is extracted but never forwarded to Langfuse
3. ❌ Quality scores cannot be collected (no infrastructure in agent repo)
4. ⚠️ Schema differences unknown (data never reaches comparison point)

**Production use blocked:** Per parent brief, Codex cannot be used for cost-sensitive optimization work until measurement infrastructure is in place and baselines are established.

**Recommendation:** Create a follow-up action to design and implement one of the three approaches above. This verification provides the necessary evidence to make an informed architectural decision.
