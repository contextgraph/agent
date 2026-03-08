# Agent Execution Instrumentation

This document describes the PostHog event instrumentation added to the agent execution workflow to track user-facing execution outcomes.

## Overview

Agent execution is the primary user-facing outcome in the product. When users trigger an agent to execute a task, they care about whether the automation succeeded or failed. This instrumentation captures that behavioral outcome.

## Events

### `agent_execution_started`

Captured when an agent execution begins.

**Distinct ID:** User ID from credentials (`credentials.userId`)

**Properties:**
- `action_id` (string): The action ID being executed
- `run_id` (string): The run ID for this execution
- `provider` (string): Agent provider (`claude` or `codex`)
- `execution_mode` (string): Execution mode (`restricted` or `full-access`)
- `has_custom_prompt` (boolean): Whether user provided a custom prompt
- `model` (string, optional): Specific model if provided (e.g., `claude-3-5-sonnet-20241022`)

**Location:** `src/workflows/execute.ts` - Before `runner.execute()` call

### `agent_execution_completed`

Captured when an agent execution completes, regardless of outcome (success, failure, or error).

**Distinct ID:** User ID from credentials (`credentials.userId`)

**Properties:**
- `action_id` (string): The action ID that was executed
- `run_id` (string): The run ID for this execution
- `provider` (string): Agent provider (`claude` or `codex`)
- `execution_mode` (string): Execution mode (`restricted` or `full-access`)
- `duration_seconds` (number): Execution duration in seconds
- `exit_code` (number, optional): Exit code from runner (0 = success, non-zero = failure)
- `cost_usd` (number, optional): Cost in USD for this execution
- `status` (string): Outcome status - one of:
  - `success`: Execution completed with exit code 0
  - `failed`: Execution completed with non-zero exit code
  - `error`: Execution threw an exception before completion
- `error_message` (string, optional): Error message for `failed` or `error` status

**Location:** `src/workflows/execute.ts` - Three capture points:
1. Success path (exit code 0)
2. Failure path (non-zero exit code)
3. Error catch block (unexpected exceptions)

## User-Facing Behavioral Choice

This instrumentation tracks the core user question: **Did my automation work?**

Users initiate executions expecting outcomes. The success/failure distinction is user-facing behavior:
- **Success**: The agent completed the task
- **Failure**: The agent encountered issues and couldn't complete
- **Error**: Infrastructure or setup problems prevented execution

This is NOT infrastructure telemetry—users directly experience these outcomes and make decisions based on them (retry, adjust prompt, file bug, etc.).

## Implementation Details

### Execution Duration Tracking

Duration is calculated from `executionStartTime` (captured just before `runner.execute()`) to when the outcome is known.

```typescript
const executionStartTime = Date.now();
// ... execution happens ...
const executionDurationSeconds = Math.round((Date.now() - executionStartTime) / 1000);
```

### Event Flushing

PostHog events are flushed in the finally block to ensure events are sent even if execution fails:

```typescript
finally {
  // ... other cleanup ...
  await shutdownPostHog();
}
```

### Testing

Instrumentation is tested in `__tests__/workflows/execute-instrumentation.test.ts` covering:
- Event capture on success
- Event capture on failure
- Event capture on error
- PostHog shutdown on all paths
- Duration tracking
- Optional properties (model, cost, etc.)

## Related Work

This complements existing steward workflow instrumentation in `src/workflows/steward-step.ts`:
- `steward_claim_accepted`
- `steward_repositories_prepared`
- `steward_execution_completed`
- `steward_execution_failed`

The steward events track steward-specific workflow steps, while these agent execution events track the general-purpose execution outcome that applies to all agent runs.

## Analytics Questions Answered

With this instrumentation, product analytics can answer:

1. **Success Rate**: What % of agent executions succeed vs. fail?
2. **Execution Duration**: How long do executions take? (p50, p95, p99)
3. **Provider Performance**: Does Claude vs. Codex have different success rates?
4. **Execution Mode Impact**: Does restricted mode have higher failure rates?
5. **Cost per Execution**: What's the typical cost? How does it vary by outcome?
6. **Error Classification**: What are the most common error messages?
7. **User Retry Behavior**: Do users retry failed executions? How quickly?

## Migration Notes

No migration needed. Events are captured starting from the commit where this instrumentation was added. Historical executions will not have these events.

PostHog client gracefully handles missing configuration (returns null), so the instrumentation is safe to deploy even if `NEXT_PUBLIC_POSTHOG_KEY` is not set.
