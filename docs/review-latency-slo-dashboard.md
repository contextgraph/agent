# Review Latency SLO Dashboard - Agent Package

## Overview

This document specifies the observability dashboard for monitoring time-to-review latency using the agent package's existing PostHog telemetry instrumentation. The dashboard surfaces key metrics from `workspace_initialized`, `agent_execution_started`, and `agent_execution_completed` events to make review velocity observable.

## Purpose

The time-to-review metric is critical for user experience. This dashboard enables:

- **SLO monitoring**: Track P50/P95/P99 latencies from workspace initialization to execution completion
- **Regression detection**: Identify workspace setup delays or agent execution bottlenecks
- **Capacity planning**: Understand execution patterns and resource utilization
- **Performance optimization**: Correlate workspace complexity with initialization time

## Telemetry Source

All metrics are captured via PostHog events emitted from the agent package:

**Event: `workspace_initialized`**
- Emitted in: `src/workspace-setup.ts`
- Properties: `action_id`, `run_id`, `repository_count`, `checkout_duration_ms`
- Purpose: Tracks workspace setup latency before agent execution

**Event: `agent_execution_started`**
- Emitted in: `src/workflows/execute.ts`
- Properties: `action_id`, `run_id`, `execution_mode`, `runner_provider`
- Purpose: Marks the beginning of agent task execution

**Event: `agent_execution_completed`**
- Emitted in: `src/workflows/execute.ts`
- Properties: `action_id`, `run_id`, `duration_seconds`, `status` (success/error/interrupted), `error_type`
- Purpose: Tracks execution completion and duration

## Key Metrics

### 1. Workspace Initialization Latency
**Definition:** Time from workspace setup start to `workspace_initialized` event

**Formula:**
```sql
SELECT
  quantile(0.50)(checkout_duration_ms) / 1000 AS p50_seconds,
  quantile(0.95)(checkout_duration_ms) / 1000 AS p95_seconds,
  quantile(0.99)(checkout_duration_ms) / 1000 AS p99_seconds
FROM events
WHERE event = 'workspace_initialized'
  AND timestamp >= now() - interval '24 hours'
```

**SLO Thresholds:**
- Target P95: < 30 seconds
- Maximum P95: < 60 seconds
- Target P99: < 60 seconds

### 2. Agent Execution Duration
**Definition:** Time from `agent_execution_started` to `agent_execution_completed`

**Formula:**
```sql
SELECT
  quantile(0.50)(duration_seconds) AS p50_seconds,
  quantile(0.95)(duration_seconds) AS p95_seconds,
  quantile(0.99)(duration_seconds) AS p99_seconds
FROM events
WHERE event = 'agent_execution_completed'
  AND status = 'success'
  AND timestamp >= now() - interval '24 hours'
```

**SLO Thresholds:**
- Target P95: < 120 seconds (2 minutes)
- Maximum P95: < 300 seconds (5 minutes)
- Target P99: < 600 seconds (10 minutes)

### 3. End-to-End Review Latency
**Definition:** Total time from workspace initialization to execution completion

**Calculation:** `checkout_duration_ms / 1000 + duration_seconds`

**SLO Thresholds:**
- Target P95: < 150 seconds
- Maximum P95: < 360 seconds
- Target P99: < 660 seconds

### 4. Success Rate
**Definition:** Percentage of executions completing successfully

**Formula:**
```sql
SELECT
  countIf(status = 'success') / count(*) * 100 AS success_rate_percent
FROM events
WHERE event = 'agent_execution_completed'
  AND timestamp >= now() - interval '24 hours'
```

**SLO Threshold:**
- Target: > 95%
- Minimum: > 90%

## Dashboard Panels

### Panel 1: SLO Status (Stat Panel)

**Metric:** P95 end-to-end review latency

**Query:**
```sql
SELECT quantile(0.95)(
  coalesce(properties.checkout_duration_ms, 0) / 1000 +
  coalesce(properties.duration_seconds, 0)
) AS p95_latency_seconds
FROM events
WHERE event IN ('workspace_initialized', 'agent_execution_completed')
  AND timestamp >= now() - interval '1 hour'
```

**Thresholds:**
- Green: < 150s
- Yellow: 150-360s
- Red: > 360s

### Panel 2: Workspace Initialization Trends (Time Series)

**Metrics:** P50, P95, P99 workspace setup latency over time

**Query:**
```sql
SELECT
  toStartOfInterval(timestamp, INTERVAL 5 MINUTE) AS time_bucket,
  quantile(0.50)(checkout_duration_ms / 1000) AS p50,
  quantile(0.95)(checkout_duration_ms / 1000) AS p95,
  quantile(0.99)(checkout_duration_ms / 1000) AS p99
FROM events
WHERE event = 'workspace_initialized'
  AND timestamp >= now() - interval '24 hours'
GROUP BY time_bucket
ORDER BY time_bucket
```

**Visualization:**
- Type: Line chart
- X-axis: Time
- Y-axis: Latency (seconds)
- Lines: P50 (solid), P95 (dashed), P99 (dotted)
- Threshold line: 60s (warning SLO)

### Panel 3: Execution Duration Distribution (Histogram)

**Metric:** Distribution of execution durations

**Query:**
```sql
SELECT
  floor(duration_seconds / 10) * 10 AS duration_bucket,
  count(*) AS execution_count
FROM events
WHERE event = 'agent_execution_completed'
  AND status = 'success'
  AND timestamp >= now() - interval '24 hours'
GROUP BY duration_bucket
ORDER BY duration_bucket
```

**Visualization:**
- Type: Bar chart
- X-axis: Duration buckets (0-10s, 10-20s, etc.)
- Y-axis: Count
- Overlay: P95 threshold line

### Panel 4: Success Rate Gauge

**Metric:** Agent execution success rate

**Query:**
```sql
SELECT
  countIf(status = 'success') / count(*) * 100 AS success_rate
FROM events
WHERE event = 'agent_execution_completed'
  AND timestamp >= now() - interval '24 hours'
```

**Visualization:**
- Type: Gauge
- Range: 0-100%
- Thresholds:
  - Green: > 95%
  - Yellow: 90-95%
  - Red: < 90%

### Panel 5: Execution Status Breakdown (Pie Chart)

**Metric:** Success vs. error vs. interrupted executions

**Query:**
```sql
SELECT
  status,
  count(*) AS count
FROM events
WHERE event = 'agent_execution_completed'
  AND timestamp >= now() - interval '24 hours'
GROUP BY status
```

**Visualization:**
- Type: Pie chart
- Colors:
  - success: Green
  - error: Red
  - interrupted: Orange

### Panel 6: Workspace Complexity vs. Initialization Time (Scatter)

**Metrics:** Correlation between repository count and checkout duration

**Query:**
```sql
SELECT
  repository_count,
  checkout_duration_ms / 1000 AS init_time_seconds
FROM events
WHERE event = 'workspace_initialized'
  AND timestamp >= now() - interval '7 days'
```

**Visualization:**
- Type: Scatter plot
- X-axis: Repository count
- Y-axis: Initialization time (seconds)
- Trend line: Linear regression

### Panel 7: Executions Per Hour (Bar Chart)

**Metric:** Throughput - executions completed per hour

**Query:**
```sql
SELECT
  toStartOfHour(timestamp) AS hour,
  count(*) AS executions
FROM events
WHERE event = 'agent_execution_completed'
  AND timestamp >= now() - interval '24 hours'
GROUP BY hour
ORDER BY hour
```

**Visualization:**
- Type: Bar chart
- X-axis: Hour
- Y-axis: Execution count
- Color: By status (success/error/interrupted)

### Panel 8: Top Slow Executions (Table)

**Metric:** Recent slowest executions with context

**Query:**
```sql
SELECT
  timestamp,
  properties.action_id AS action_id,
  properties.run_id AS run_id,
  properties.duration_seconds AS duration_seconds,
  properties.execution_mode AS execution_mode,
  properties.error_type AS error_type
FROM events
WHERE event = 'agent_execution_completed'
  AND timestamp >= now() - interval '24 hours'
ORDER BY properties.duration_seconds DESC
LIMIT 20
```

**Visualization:**
- Type: Table
- Columns: Timestamp, Action ID, Run ID, Duration, Mode, Error Type
- Sorting: By duration (descending)

## PostHog Dashboard Setup

### Prerequisites

1. PostHog account with agent telemetry events
2. Events `workspace_initialized`, `agent_execution_started`, `agent_execution_completed` being emitted
3. Dashboard creation permissions in PostHog

### Setup Steps

1. **Navigate to Dashboards** in PostHog
2. **Create New Dashboard** named "Review Latency SLO"
3. **Add Insights** using the queries specified above
4. **Configure Variables:**
   - `time_range`: Default 24h, options: 1h, 6h, 24h, 7d, 30d
   - `execution_mode`: All, steward, manual, loop
   - `runner_provider`: All, modal, local

### Alternative: Axiom Dashboard

If using Axiom for log aggregation:

**Dataset:** `agent-telemetry`

**Query Example (Workspace Init Latency P95):**
```apl
['agent-telemetry']
| where event == 'workspace_initialized'
| where _time >= ago(24h)
| summarize p95 = percentile(checkout_duration_ms / 1000, 95)
```

## Alerting Rules

### Alert 1: High Workspace Initialization Latency

**Condition:**
```sql
SELECT quantile(0.95)(checkout_duration_ms / 1000) AS p95_init_time
FROM events
WHERE event = 'workspace_initialized'
  AND timestamp >= now() - interval '10 minutes'
HAVING p95_init_time > 60
```

**Severity:** Warning
**Threshold:** P95 > 60 seconds for 10 minutes
**Action:** Investigate workspace checkout performance, check repository sizes

### Alert 2: Critical Execution Duration

**Condition:**
```sql
SELECT quantile(0.95)(duration_seconds) AS p95_duration
FROM events
WHERE event = 'agent_execution_completed'
  AND status = 'success'
  AND timestamp >= now() - interval '10 minutes'
HAVING p95_duration > 300
```

**Severity:** Critical
**Threshold:** P95 > 300 seconds (5 minutes) for 10 minutes
**Action:** Investigate agent performance, check for LLM API slowdowns

### Alert 3: Low Success Rate

**Condition:**
```sql
SELECT countIf(status = 'success') / count(*) AS success_rate
FROM events
WHERE event = 'agent_execution_completed'
  AND timestamp >= now() - interval '10 minutes'
HAVING success_rate < 0.90
```

**Severity:** Critical
**Threshold:** < 90% success rate for 10 minutes
**Action:** Investigate error logs, check for systematic failures

## Operational Usage

### Daily Monitoring

**Morning check:**
1. Verify SLO Status panel is green (P95 < 150s)
2. Check success rate gauge (should be > 95%)
3. Review execution throughput bar chart for anomalies

**Incident response:**
1. If SLO Status is red, check which component is slow:
   - High workspace init time? → Check Panel 2 (Workspace Initialization Trends)
   - High execution duration? → Check Panel 3 (Execution Duration Distribution)
2. Review Top Slow Executions table for patterns
3. Correlate with Workspace Complexity scatter plot (is repo size the cause?)
4. Check Execution Status Breakdown for elevated error rates

### Performance Optimization

**Identify bottlenecks:**
- If P95 workspace init > 60s: Optimize checkout process, consider shallow clones, reduce repository count
- If P95 execution > 300s: Investigate LLM API latency, consider timeout optimizations
- If success rate < 95%: Review error types, fix systematic failures

**Capacity planning:**
- Monitor Executions Per Hour to understand peak load
- Correlate high throughput periods with elevated latencies
- Plan infrastructure scaling based on execution patterns

## Integration with Actions Repository

This dashboard complements the actions repository's review-latency dashboard:

| Repository | Metric Scope | Measurement |
|------------|-------------|-------------|
| **Actions** | Webhook → Review Posted | End-to-end PR review pipeline |
| **Agent** | Workspace Init → Execution Complete | Agent-side execution latency |

**Combined observability:**
- Actions dashboard tracks user-facing latency (webhook receipt to comment posted)
- Agent dashboard tracks internal execution latency (workspace setup to task completion)
- Together, they provide full visibility into the critical path

## Related Documentation

- **Langfuse Session Management:** `src/langfuse-session.ts`
- **Workspace Setup:** `src/workspace-setup.ts`
- **Execution Workflow:** `src/workflows/execute.ts`
- **PostHog Integration:** `src/posthog-client.ts`

## Future Enhancements

1. **LLM Cost Correlation:** Track token usage vs. execution duration
2. **Runner Provider Comparison:** Analyze Modal vs. local execution performance
3. **Error Type Breakdown:** Categorize failures by error type for targeted fixes
4. **Predictive Alerts:** Trend-based alerts before SLOs are breached
5. **Repository-specific SLOs:** Different thresholds for different repos based on complexity

## Support

For issues or questions:
- **Time-to-review Steward:** [View in ContextGraph](https://contextgraph.dev/actions/2292c568-073b-4e00-88d0-8401b9932532)
- **GitHub Issues:** [contextgraph/agent](https://github.com/contextgraph/agent/issues)

---

**Created by:** Time-to-review Steward
**Last updated:** 2026-03-10
