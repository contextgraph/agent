# Structured Logging Schema for Axiom

This document defines the standardized schema for all structured logs emitted by the @contextgraph/agent package. Following these conventions ensures logs are queryable, debuggable, and optimized for Axiom.

## Core Principles

1. **Async boundaries are the target** - Focus logging on external APIs, distributed operations, and failure boundaries where silent failures can corrupt state
2. **Consistent field naming** - Use standardized field names across all log statements for reliable querying
3. **Structured over unstructured** - Always emit structured JSON with typed fields rather than string interpolation
4. **Context preservation** - Include request/session identifiers to trace operations across async boundaries

## Standard Field Names

### Required Context Fields

These fields SHOULD be included in all structured logs when available:

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `timestamp` | ISO 8601 string | Event timestamp | `"2024-03-11T20:30:00.000Z"` |
| `level` | string | Log level | `"info"`, `"warn"`, `"error"` |
| `service` | string | Service/component name | `"agent"`, `"steward"` |
| `environment` | string | Environment identifier | `"production"`, `"development"` |

### Operation Context

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `operation` | string | High-level operation name | `"workspace_prep"`, `"agent_run"` |
| `request_id` | string | Request/operation identifier | `"req_abc123"` |
| `session_id` | string | Session identifier | `"session_xyz789"` |
| `run_id` | string (UUID) | Agent run identifier | `"550e8400-e29b-41d4-a716-446655440000"` |
| `action_id` | string (UUID) | Action being executed | `"660e8400-e29b-41d4-a716-446655440001"` |
| `steward_id` | string (UUID) | Steward identifier | `"770e8400-e29b-41d4-a716-446655440002"` |

### User/Actor Context

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `user_id` | string | User identifier | `"user_123"` |
| `organization_id` | string (UUID) | Organization identifier | `"880e8400-e29b-41d4-a716-446655440003"` |
| `worker_id` | string | Worker/agent identifier | `"worker_01"` |

### Performance Metrics

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `duration_ms` | number | Operation duration in milliseconds | `1234` |
| `start_time` | ISO 8601 string | Operation start timestamp | `"2024-03-11T20:30:00.000Z"` |
| `end_time` | ISO 8601 string | Operation end timestamp | `"2024-03-11T20:30:01.234Z"` |

### Error Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `error_code` | string | Machine-readable error code | `"AUTH_FAILED"`, `"TIMEOUT"` |
| `error_message` | string | Human-readable error message | `"Authentication token expired"` |
| `error_type` | string | Error classification | `"NetworkError"`, `"ValidationError"` |
| `error_stack` | string | Stack trace (development only) | `"Error: ... at ..."` |
| `retry_count` | number | Number of retry attempts | `3` |
| `is_retryable` | boolean | Whether error is retryable | `true` |

### HTTP/API Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `http_method` | string | HTTP method | `"GET"`, `"POST"` |
| `http_status` | number | HTTP status code | `200`, `404`, `500` |
| `http_path` | string | Request path | `"/api/runs"` |
| `http_url` | string | Full URL (sanitized) | `"https://api.example.com/runs"` |
| `response_size_bytes` | number | Response size | `1024` |

### LLM/AI Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `model` | string | Model identifier | `"claude-3-opus-20240229"` |
| `provider` | string | LLM provider | `"anthropic"`, `"openai"` |
| `token_count_input` | number | Input tokens | `100` |
| `token_count_output` | number | Output tokens | `250` |
| `cost_usd` | number | Operation cost in USD | `0.015` |
| `num_turns` | number | Number of conversation turns | `5` |

### Git/Repository Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `repository` | string | Repository identifier | `"contextgraph/agent"` |
| `branch` | string | Git branch | `"main"`, `"feat/logging"` |
| `commit_sha` | string | Git commit hash | `"abc123def456"` |
| `pr_number` | number | Pull request number | `42` |

## Log Levels

Use these standard log levels consistently:

- **`debug`** - Detailed diagnostic information (development only, never in production)
- **`info`** - Informational messages for normal operations
- **`warn`** - Warning messages for recoverable issues or degraded performance
- **`error`** - Error messages for failures that impact functionality

## Field Naming Conventions

1. **Use snake_case** for all field names (e.g., `user_id`, `duration_ms`)
2. **Suffix units** on numeric fields (e.g., `duration_ms`, `size_bytes`, `cost_usd`)
3. **Prefix booleans** with `is_`, `has_`, or `should_` when meaningful (e.g., `is_retryable`, `has_error`)
4. **Avoid abbreviations** except for well-known terms (e.g., `id`, `url`, `api`, `ms`)
5. **Use consistent identifiers** - always `user_id`, never `userId` or `user`

## Cardinality Guidelines

Be mindful of high-cardinality fields that can impact Axiom query performance:

- **Low cardinality** (safe): `level`, `service`, `operation`, `environment`, `error_code`, `http_method`
- **Medium cardinality** (use judiciously): `http_path`, `model`, `provider`, `branch`
- **High cardinality** (limit usage): `request_id`, `session_id`, `user_id`, `error_message`, `http_url`

**Best practices:**
- Index high-cardinality fields only when needed for filtering/grouping
- For very high-cardinality data (e.g., full error stacks), consider truncating or sampling
- Use error codes instead of full error messages for aggregation

## Usage Examples

### Basic Structured Log

```typescript
import { logEvent } from './logging-schema.js';

// Simple info log
logEvent({
  level: 'info',
  operation: 'workspace_prep',
  message: 'Workspace preparation started',
  run_id: runId,
  action_id: actionId,
});
```

### API Call with Timing

```typescript
const startTime = Date.now();
try {
  const response = await fetch(url);
  const duration_ms = Date.now() - startTime;

  logEvent({
    level: 'info',
    operation: 'api_request',
    message: 'API request completed',
    http_method: 'GET',
    http_path: '/api/runs',
    http_status: response.status,
    duration_ms,
    request_id: requestId,
  });
} catch (error) {
  const duration_ms = Date.now() - startTime;

  logEvent({
    level: 'error',
    operation: 'api_request',
    message: 'API request failed',
    http_method: 'GET',
    http_path: '/api/runs',
    duration_ms,
    error_message: error.message,
    error_type: error.constructor.name,
    request_id: requestId,
  });
}
```

### LLM Operation with Cost Tracking

```typescript
logEvent({
  level: 'info',
  operation: 'llm_completion',
  message: 'LLM completion finished',
  model: 'claude-3-opus-20240229',
  provider: 'anthropic',
  token_count_input: usage.input_tokens,
  token_count_output: usage.output_tokens,
  cost_usd: totalCost,
  duration_ms: durationMs,
  session_id: sessionId,
});
```

### Error with Retry Context

```typescript
logEvent({
  level: 'warn',
  operation: 'api_request',
  message: 'Request failed, retrying',
  error_code: 'RATE_LIMIT_EXCEEDED',
  error_message: 'Rate limit exceeded, waiting before retry',
  retry_count: attemptNumber,
  is_retryable: true,
  http_status: 429,
  request_id: requestId,
});
```

## Migration Path

When adding logging to existing code:

1. **Start with async boundaries** - External API calls, webhooks, distributed operations
2. **Add error logging first** - Capture failure modes before success cases
3. **Include required context** - Always include relevant IDs (run_id, action_id, request_id)
4. **Validate against schema** - Use the validation utilities to ensure consistency
5. **Avoid over-logging** - Don't log deterministic, synchronous code with good test coverage

## Schema Validation

See `src/logging-schema.ts` for Zod schema definitions and validation utilities.

## Related Documentation

- [Agent Execution Instrumentation](./AGENT_EXECUTION_INSTRUMENTATION.md) - Run tracking and event streaming
- [Worker Completion Architecture](./WORKER_COMPLETION_ARCHITECTURE.md) - Distributed system observability patterns
