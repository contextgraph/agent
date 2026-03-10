# Review Latency SLO Dashboard — Quick Start

This guide provides a streamlined path to deploy the agent review latency SLO dashboard using PostHog telemetry.

## Overview

The agent review latency dashboard provides real-time visibility into workspace initialization and agent execution performance. It surfaces P50/P95/P99 latencies for the complete execution pipeline from workspace setup to task completion.

**Key capabilities:**
- Real-time SLO monitoring (P95 < 150s target, < 360s critical)
- Workspace initialization latency tracking (P95 < 60s)
- Agent execution duration analysis (P95 < 300s)
- Success rate monitoring (> 95% target)
- Error breakdown and slow execution detection

## Prerequisites

Before deploying, ensure you have:

1. **PostHog account** with agent telemetry events enabled
2. **Events being emitted:**
   - `workspace_initialized` (from `src/workspace-setup.ts`)
   - `agent_execution_started` (from `src/workflows/execute.ts`)
   - `agent_execution_completed` (from `src/workflows/execute.ts`)
3. **Dashboard creation permissions** in PostHog

## Quick Deployment

### Option 1: Import Dashboard JSON (Recommended)

1. **Open PostHog** and navigate to **Dashboards**

2. **Create New Dashboard:**
   - Click "New Dashboard"
   - Name: "Agent Review Latency SLO"
   - Description: "Real-time observability for agent execution latency"
   - Tags: `steward`, `slo`, `latency`, `agent`

3. **Import Configuration:**
   - While PostHog doesn't support JSON import directly, use the provided JSON as a reference
   - Create insights manually based on `docs/review-latency-slo-dashboard-posthog.json`

4. **Add Insights:**
   Follow the panel specifications in the JSON file to create each insight

### Option 2: Manual Dashboard Creation

Create the following insights in PostHog:

#### Insight 1: SLO Status - P95 Latency

**Type:** Big Number
**Event:** `agent_execution_completed`
**Aggregation:** P95 of `duration_seconds`
**Date Range:** Last 24 hours
**Display:** Large number with threshold coloring
- Green: < 150s
- Yellow: 150-360s
- Red: > 360s

#### Insight 2: Workspace Initialization Trends

**Type:** Line Chart
**Events:**
- P50 of `workspace_initialized.checkout_duration_ms`
- P95 of `workspace_initialized.checkout_duration_ms`
- P99 of `workspace_initialized.checkout_duration_ms`
**Date Range:** Last 24 hours
**Interval:** Hourly
**Display:** Three lines (P50 solid, P95 dashed, P99 dotted)

#### Insight 3: Success Rate

**Type:** Big Number
**Event:** `agent_execution_completed` filtered by `status = success`
**Formula:** `(success count / total count) * 100`
**Date Range:** Last 24 hours
**Display:** Percentage with gauge
- Green: > 95%
- Yellow: 90-95%
- Red: < 90%

#### Insight 4: Execution Duration Distribution

**Type:** Bar Chart
**Event:** `agent_execution_completed` with `status = success`
**Property:** `duration_seconds` (distribution)
**Date Range:** Last 24 hours
**Display:** Histogram of execution durations

#### Insight 5: Execution Status Breakdown

**Type:** Pie Chart
**Event:** `agent_execution_completed`
**Breakdown:** By `status` property
**Date Range:** Last 24 hours
**Display:** Pie chart with colors:
- success: Green
- error: Red
- interrupted: Orange

#### Insight 6: Executions Per Hour

**Type:** Bar Chart
**Event:** `agent_execution_completed`
**Breakdown:** By `status`
**Interval:** Hourly
**Date Range:** Last 24 hours
**Display:** Stacked bars by status

#### Insight 7: Top Slow Executions

**Type:** Table
**Event:** `agent_execution_completed` with `status = success`
**Columns:**
- Timestamp
- `action_id`
- `run_id`
- `duration_seconds`
- `execution_mode`
- `runner_provider`
**Sort:** By `duration_seconds` descending
**Limit:** 20

## Validation

Verify your deployment is working:

### 1. Check Events Are Flowing

In PostHog, navigate to **Activity** → **Events** and verify:

```
✓ workspace_initialized events present
✓ agent_execution_started events present
✓ agent_execution_completed events present
```

**Expected properties:**

`workspace_initialized`:
- `action_id`: UUID
- `run_id`: UUID
- `repository_count`: Number
- `checkout_duration_ms`: Number

`agent_execution_completed`:
- `action_id`: UUID
- `run_id`: UUID
- `duration_seconds`: Number
- `status`: "success" | "error" | "interrupted"
- `execution_mode`: "steward" | "manual" | "loop"
- `runner_provider`: "modal" | "local"

### 2. Verify Dashboard Panels Render

Open the dashboard and confirm:
- **SLO Status** shows current P95 latency
- **Workspace Init Trends** displays line chart with data
- **Success Rate** shows percentage gauge
- **All panels** display data (not "No data")

If panels show "No data":
- Check that events are being emitted (run an agent execution)
- Verify time range includes recent activity
- Confirm event property names match exactly

### 3. Test Alert Thresholds

Temporarily adjust SLO Status thresholds to trigger color changes:
- Lower warning threshold to 100s
- Verify panel turns yellow or red if latency exceeds threshold
- Reset thresholds to correct values (150s warning, 360s critical)

## Alert Configuration

### Alert 1: High Workspace Initialization Latency

**Metric:** P95 of `workspace_initialized.checkout_duration_ms / 1000`
**Threshold:** > 60 seconds
**Evaluation:** Every 10 minutes
**Condition:** Alert if P95 exceeds 60s for 10 consecutive minutes
**Severity:** Warning
**Action:** Investigate workspace checkout performance

**PostHog Alert Setup:**
1. Navigate to **Insights** → Select "Workspace Initialization Trends"
2. Click **Set Alert**
3. Condition: P95 value > 60
4. Frequency: Check every 10 minutes
5. Notification: Slack/Email/Webhook

### Alert 2: Critical Execution Duration

**Metric:** P95 of `agent_execution_completed.duration_seconds`
**Threshold:** > 300 seconds (5 minutes)
**Evaluation:** Every 10 minutes
**Condition:** Alert if P95 exceeds 300s for 10 consecutive minutes
**Severity:** Critical
**Action:** Investigate agent performance, check LLM API latency

**PostHog Alert Setup:**
1. Navigate to **SLO Status** insight
2. Click **Set Alert**
3. Condition: P95 value > 300
4. Frequency: Check every 10 minutes
5. Notification: Slack/PagerDuty

### Alert 3: Low Success Rate

**Metric:** Success rate percentage
**Threshold:** < 90%
**Evaluation:** Every 10 minutes
**Condition:** Alert if success rate drops below 90% for 10 consecutive minutes
**Severity:** Critical
**Action:** Investigate error logs, check for systematic failures

**PostHog Alert Setup:**
1. Navigate to **Success Rate** insight
2. Click **Set Alert**
3. Condition: Value < 90
4. Frequency: Check every 10 minutes
5. Notification: Slack/PagerDuty

## Operational Usage

### Daily Monitoring

**Morning check:**
1. Open dashboard, verify **SLO Status** is green (P95 < 150s)
2. Check **Success Rate** is above 95%
3. Review **Executions Per Hour** for volume anomalies

**Incident response:**
1. If SLO Status is red, check which component is slow:
   - High workspace init time? → Check **Workspace Initialization Trends**
   - High execution duration? → Check **Execution Duration Distribution**
2. Review **Top Slow Executions** table for patterns
3. Check **Execution Status Breakdown** for elevated error rates

### Key Metrics to Watch

| Metric | Healthy | Warning | Critical |
|--------|---------|---------|----------|
| P95 Workspace Init | < 30s | 30-60s | > 60s |
| P95 Execution Duration | < 120s | 120-300s | > 300s |
| P95 End-to-End | < 150s | 150-360s | > 360s |
| Success Rate | > 95% | 90-95% | < 90% |

## Troubleshooting

### No Data in Dashboard

**Symptoms:** All panels show "No data"

**Diagnosis:**
1. Check PostHog events: Navigate to **Activity** → **Events**
2. Search for `workspace_initialized`, `agent_execution_started`, `agent_execution_completed`
3. Verify events exist with recent timestamps

**Resolution:**
1. Confirm agent is emitting telemetry (check `src/posthog-client.ts`)
2. Verify PostHog API key is configured in environment variables
3. Run an agent execution to generate events
4. Refresh dashboard after events are emitted

### Event Properties Missing

**Symptoms:** Panels show errors about missing properties

**Diagnosis:**
Check event payload in PostHog event viewer

**Resolution:**
1. Verify event property names match exactly:
   - `checkout_duration_ms` (not `checkout_duration` or `init_time`)
   - `duration_seconds` (not `duration` or `execution_time`)
   - `status`, `action_id`, `run_id`, etc.
2. Update insight queries if property names differ
3. Check agent package version (properties may have changed)

### Threshold Colors Not Showing

**Symptoms:** Numbers display but don't change color

**Diagnosis:**
PostHog requires explicit threshold configuration

**Resolution:**
1. Edit each Big Number insight
2. Navigate to **Display** → **Conditional Formatting**
3. Add threshold rules:
   - Green: value < 150
   - Yellow: value >= 150 AND value < 360
   - Red: value >= 360
4. Save and verify color changes

## Next Steps

After successful deployment:

1. **Set up alert notifications:**
   - Configure PostHog alert destinations (Slack, email, webhook)
   - Test alert firing by temporarily lowering thresholds

2. **Review operational guide:**
   - Read `docs/review-latency-slo-dashboard.md` for detailed operational procedures
   - Understand correlation analysis between workspace complexity and initialization time

3. **Monitor for regressions:**
   - Bookmark dashboard URL for daily monitoring
   - Set up mobile notifications for critical alerts

4. **Iterate on SLO thresholds:**
   - After establishing baseline, adjust thresholds based on actual performance
   - Update alert conditions to match refined SLOs

## Integration with Actions Repository

This dashboard complements the actions repository's review-latency dashboard:

| Repository | Metric Scope | Dashboard Location |
|------------|-------------|-------------------|
| **Agent** | Workspace Init → Execution Complete | PostHog (this dashboard) |
| **Actions** | Webhook → Review Posted | Grafana + Prometheus |

**Combined observability:**
- Agent dashboard tracks internal execution latency
- Actions dashboard tracks user-facing end-to-end latency
- Together, they provide full visibility into the review pipeline

## Resources

- **Full documentation:** `docs/review-latency-slo-dashboard.md`
- **Dashboard JSON reference:** `docs/review-latency-slo-dashboard-posthog.json`
- **Telemetry implementation:**
  - `src/workspace-setup.ts` (workspace_initialized)
  - `src/workflows/execute.ts` (agent_execution_started/completed)
  - `src/posthog-client.ts` (PostHog integration)

## Support

For issues or questions:
- **Time-to-review Steward:** [View in ContextGraph](https://contextgraph.dev/actions/2292c568-073b-4e00-88d0-8401b9932532)
- **GitHub Issues:** [contextgraph/agent](https://github.com/contextgraph/agent/issues)

---

**Created by:** Time-to-review Steward
**Last updated:** 2026-03-10
