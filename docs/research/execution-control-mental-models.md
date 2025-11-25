# Research: Execution Control Mental Models

**Date:** November 25, 2025
**Action ID:** ff6e0e0e-3566-4345-be3b-7338e8d97224
**Context:** Understanding user mental models for controlling parallel worker execution before designing controls

## Executive Summary

The current local agent (`@context-graph/agent`) operates in **fully automated mode** with **zero execution controls**. Once you run `npx @context-graph/agent run <action-id>`, it autonomously executes everything in the action tree. This creates a gap between current behavior and the need for parallel workers with user control.

**Key finding:** Users need a mental model shift from "single agent runs everything" to "queue of work that multiple workers can pick from" — with explicit opt-in control over what enters that queue.

---

## 1. Current Behavior Analysis

### What Workers Execute Today

The local agent (`agent.ts`) implements a **fully autonomous loop**:

```typescript
// Current behavior: NO EXECUTION CONTROLS
while (iterations < maxIterations) {
  const nextAction = await getNextAction(apiClient, rootActionId);

  if (!nextAction) {
    console.log('✅ No more actions to execute. Agent complete!');
    break;
  }

  // Automatically prepare if needed
  if (!isPrepared) {
    await runPrepare(nextAction.id, { cwd: workspacePath });
    continue;
  }

  // Automatically execute
  await runExecute(nextAction.id, { cwd: workspacePath });
}
```

**Key characteristics:**

1. **Everything executes by default** — No user approval needed
2. **Depth-first traversal** — Finds next leaf action, prepares if needed, executes, repeats
3. **Dependency-aware** — Respects action dependencies (won't run blocked actions)
4. **Single-threaded** — One action at a time, serially
5. **Parent-child order** — Children must be prepared before execution
6. **No stopping point** — Runs until complete or hits max iterations (100)

### Current "Control" Mechanisms

The only controls that exist today are **implicit** and **structural**:

| Control Type | How It Works | Limitation |
|--------------|--------------|------------|
| **Dependencies** | Actions blocked by incomplete dependencies won't run | Can't say "don't run this ever" |
| **Prepared flag** | Parent actions with `prepared=false` must be prepared before children execute | Just a workflow gate, not a user control |
| **Max iterations** | Agent stops after 100 loops | Safety limit, not user control |
| **Done flag** | Completed actions are skipped | After-the-fact, not preventative |

**What's missing:** Users cannot say "don't execute this" or "only execute these specific actions."

---

## 2. User Mental Model Analysis

### The Mental Model Gap

| Current Reality | Desired State | Gap |
|-----------------|---------------|-----|
| "I run ONE agent that does EVERYTHING" | "Multiple workers pick from a queue of ready work" | Need: Queue concept + Ready state |
| "Everything executes automatically" | "I control what's ready to execute" | Need: Opt-in approval mechanism |
| "Serial execution, one thing at a time" | "Parallel execution of independent actions" | Need: Concurrency-safe work distribution |
| "Start agent → wait for completion" | "Queue work → workers pick it up → monitor progress" | Need: Separation of queueing from execution |

### Mental Model Options

#### Option A: "Approval Model" (Explicit Opt-In)
- **User thinks:** "I review and approve work before agents can do it"
- **Language:** "Approve", "Ready for execution", "Authorized"
- **UX:** Checkbox next to actions, "Approve subtree" button
- **Default:** Nothing runs unless explicitly approved
- **Best for:** Users nervous about AI autonomy, regulated environments

#### Option B: "Queue Model" (Work Management)
- **User thinks:** "I put work in a queue, workers pull from it"
- **Language:** "Queue", "Ready", "Available for workers"
- **UX:** Drag actions to "Ready Queue", priority ordering
- **Default:** Actions must be explicitly queued
- **Best for:** Users familiar with task management systems (Jira, Linear)

#### Option C: "Delegation Model" (Trust Boundaries)
- **User thinks:** "I delegate responsibility for this subtree to workers"
- **Language:** "Delegate", "Auto-execute", "Worker-managed"
- **UX:** Mark subtree as "managed by workers", workers handle everything underneath
- **Default:** Manual by default, opt-in to delegation
- **Best for:** Power users who want "set and forget" for trusted areas

### Recommended: Hybrid "Queue + Delegation"

Combine the clarity of a queue with the power of delegation:

1. **Default:** Actions are NOT ready for workers
2. **Individual queueing:** Mark single actions as "ready" → they enter the worker queue
3. **Subtree delegation:** Mark a parent as "worker-managed" → all descendants automatically enter queue when ready
4. **Clear visibility:** UI shows "Ready Queue" and which actions are delegated

**Why this works:**
- New users start with explicit control (queue individual actions)
- Power users graduate to delegation (mark subtrees as auto-managed)
- Mental model matches existing tools (Jira's backlog + auto-assignment)

---

## 3. Risk Perception Analysis

### What Are Users Worried About?

From parent action description and context:

| Fear | Why It Matters | Mitigation |
|------|----------------|------------|
| **"Executing the wrong thing"** | AI might misunderstand requirements, waste time/money | Preview before approval, clear action descriptions |
| **"Executing too many things"** | Parallel workers could spin up 50 actions, drain API credits | Rate limiting, max concurrent workers, cost visibility |
| **"Not knowing what's executing"** | Lose visibility in parallel execution chaos | Real-time dashboard, worker status, logs per action |
| **"Breaking something"** | Automated changes might conflict or break the codebase | Read-only mode option, require tests, branch protections |
| **"Losing control"** | Once started, can't stop it | Emergency stop button, pause queue, kill individual workers |

### Risk Mitigation Requirements

Based on these fears, execution controls MUST include:

1. **Before execution:**
   - Clear action descriptions (already exists)
   - Approval step (NEW: ready/queue mechanism)
   - Estimated cost/time preview (FUTURE)

2. **During execution:**
   - Real-time status dashboard (NEW)
   - Worker activity logs (NEW)
   - Kill switches (NEW: pause queue, stop worker, cancel action)

3. **After execution:**
   - Completion context (already exists)
   - Git history linking (already exists)
   - Rollback capability (FUTURE)

---

## 4. Power User Needs Analysis

### What Do Sophisticated Users Want?

| Need | Description | Priority |
|------|-------------|----------|
| **Full automation** | "Mark this entire project as auto-execute" | HIGH |
| **Fine-grained control** | "Execute A and C, but not B" | HIGH |
| **Conditional execution** | "Only execute if dependencies pass tests" | MEDIUM |
| **Priority ordering** | "Always do auth work before UI work" | MEDIUM |
| **Worker affinity** | "Only run database migrations on trusted workers" | LOW |
| **Scheduling** | "Execute overnight" | LOW |

### Power User Personas

#### Persona 1: "The Orchestrator"
- Manages 10+ parallel projects
- Wants: Bulk operations ("mark all leaf actions as ready"), global pause
- Mental model: CI/CD pipeline controller
- Analogy: GitHub Actions workflow management

#### Persona 2: "The Reviewer"
- Reviews every action before execution
- Wants: Approval workflow, diffs, preview mode
- Mental model: Code reviewer
- Analogy: Pull request review process

#### Persona 3: "The Delegator"
- Trusts workers for routine tasks, reviews for critical ones
- Wants: Smart defaults (e.g., "auto-approve refactors, require review for DB changes")
- Mental model: Engineering manager delegating work
- Analogy: JIRA auto-assignment rules

### Supporting All Three

**Minimal viable controls:**

1. **Manual queue (for Reviewer):** Explicit "mark ready" button per action
2. **Subtree delegation (for Delegator):** "Auto-execute this subtree" toggle on parent
3. **Bulk operations (for Orchestrator):** "Mark all leaves as ready" button

**Future enhancements:**
- Filters/rules: "Auto-approve actions tagged 'safe'"
- Worker pools: "Only execute 'critical' actions on trusted workers"
- Scheduling: "Execute low-priority actions after hours"

---

## 5. Comparison: How Other Tools Handle This

### GitHub Actions
- **Mental model:** Workflow files define what runs
- **Control:** Push to branch triggers workflows (implicit approval via git push)
- **Parallel:** Runs jobs in parallel by default, can specify dependencies
- **Stopping:** Cancel button on individual workflow runs
- **Lesson:** Implicit approval (git push) works because users trust their own code

### Linear (Issue Tracking)
- **Mental model:** Issues have states (backlog → todo → in progress → done)
- **Control:** Move to "In Progress" = claim the work
- **Parallel:** Multiple people can work on different issues
- **Stopping:** Unassign yourself
- **Lesson:** State transitions make work availability explicit

### Kubernetes Job Scheduling
- **Mental model:** Jobs in a queue, workers pull jobs
- **Control:** Jobs created → scheduler assigns to nodes
- **Parallel:** Concurrency limits, resource quotas
- **Stopping:** Delete job, scale down workers
- **Lesson:** Queue + resource limits = predictable parallelism

### Temporal/Conductor (Workflow Orchestration)
- **Mental model:** Workflows define state machines, workers execute activities
- **Control:** Start workflow explicitly, workers poll task queues
- **Parallel:** Workers pull from queues, can run 100s in parallel
- **Stopping:** Cancel workflow, terminate activity
- **Lesson:** Separation of workflow definition (control plane) from execution (workers) enables scale

### Best Practices from These Tools

1. **Explicit triggering:** Users initiate execution (git push, start workflow, create job)
2. **State visibility:** Clear states like "queued", "running", "complete"
3. **Concurrency controls:** Max parallel workers, rate limits
4. **Cancellation:** Emergency stop at multiple levels (workflow, job, worker)
5. **Audit trail:** Logs of what ran, when, by whom

---

## 6. Recommendations

### Recommended Mental Model: "Ready Queue"

**Core concept:** Actions have a "ready" state. Workers only execute actions marked as ready.

**User journey:**

1. **Plan work:** Create action tree (already exists)
2. **Mark ready:** User marks actions/subtrees as "ready for workers"
3. **Workers pull:** Background workers query for ready actions, execute them
4. **Monitor:** User watches dashboard showing ready queue, active workers, completed work
5. **Control:** User can pause queue, stop workers, remove actions from queue

**Key terminology:**
- **"Ready"** (not "approved" or "queued") — Less bureaucratic, implies work is prepared
- **"Workers"** (not "agents") — Clearer that these are background processes
- **"Queue"** (noun) — The list of ready actions
- **"Queue it"** (verb) — Mark as ready

### Recommended Data Model

```typescript
// Action state additions
interface Action {
  // ... existing fields ...
  ready: boolean;           // User marked as ready for workers
  readyAt?: Date;          // When it was marked ready
  autoExecute?: boolean;   // If true, children auto-marked ready when prepared
  claimedBy?: string;      // Worker ID if currently executing
  claimedAt?: Date;        // When worker claimed it
}
```

### Recommended API

```typescript
// New endpoints
POST /api/actions/:id/mark-ready
DELETE /api/actions/:id/unmark-ready
POST /api/actions/:id/toggle-auto-execute

// Updated fetch
GET /api/actions/tree?ready=true  // Filter for ready actions
GET /api/actions/next-ready       // Get next ready action for worker
```

### Recommended UX (Priority Order)

#### Phase 1: MVP (Single Worker with Queue)
1. **Action list view:** Show checkbox "Ready for worker" next to each action
2. **Subtree toggle:** Button on parent actions: "Auto-execute children"
3. **Ready queue view:** Separate panel showing all ready actions
4. **Worker status:** Simple indicator "Worker: Idle | Running: [Action Title]"

#### Phase 2: Multiple Workers
5. **Worker pool view:** List of active workers and what they're running
6. **Concurrency controls:** Setting for max concurrent workers
7. **Pause/resume:** Global pause button, per-worker stop

#### Phase 3: Advanced Controls
8. **Priority ordering:** Drag-and-drop in ready queue
9. **Bulk operations:** "Mark all leaves as ready"
10. **Filters/rules:** "Auto-ready actions tagged 'safe'"

---

## 7. Open Questions for User Research

### Questions for Early Users (Finn, James)

1. **Trust level:** Would you be comfortable marking an entire subtree as "auto-execute" or do you want to approve each action individually?

2. **Failure handling:** If a worker fails on action 5 of 10, should it:
   - Stop and wait for your review?
   - Skip it and continue with action 6?
   - Retry automatically?

3. **Visibility needs:** What do you want to see while workers are running?
   - Just a count of completed actions?
   - Real-time logs from each worker?
   - Git diffs of changes made?

4. **Stopping:** If you need to stop a worker, should it:
   - Finish current action then stop?
   - Abort immediately (may leave repo dirty)?
   - Commit work-in-progress?

5. **Queueing workflow:** Which feels more natural?
   - "Mark as ready" → implicit queueing
   - "Add to queue" → explicit queue management
   - "Assign to worker pool" → delegation language

6. **Default behavior:** For a new action tree, should:
   - Nothing run until you mark things ready? (safe default)
   - Leaf actions auto-marked ready? (fast default)
   - User chooses per-project? (flexible default)

### Metrics to Validate Mental Model

- **Time to first action queued** — Is it obvious how to queue work?
- **Error rate on first queue** — Do users queue the wrong things?
- **Ready → Claimed latency** — How long do actions sit in queue?
- **Cancellation rate** — Are users frequently stopping workers (sign of mistrust)?
- **Auto-execute adoption** — Do power users use subtree delegation?

---

## 8. Implementation Recommendations

### Starting Point (Align with Parent Action)

The parent action suggests:

> Workers only execute actions explicitly marked "ready"
> One-click to mark a subtree as ready
> Platform shows queue of ready actions
> Workers pull from ready queue only

**This aligns with the "Ready Queue" mental model recommended above.**

### Technical Architecture

```
┌─────────────────────────────────────────────────────────┐
│  User (Web UI)                                          │
│  - Views action tree                                    │
│  - Marks actions as "ready"                             │
│  - Toggles "auto-execute" on subtrees                   │
│  - Monitors ready queue and active workers              │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Platform API (contextgraph.dev)                        │
│  - Stores ready state on actions                        │
│  - Provides /api/actions/next-ready endpoint            │
│  - Tracks worker claims on actions                      │
│  - Enforces max concurrent workers                      │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Worker Daemon (local or cloud)                         │
│  - Polls for ready actions                              │
│  - Claims action (atomically)                           │
│  - Spawns Claude agent to execute                       │
│  - Reports completion/failure                           │
│  - Releases claim                                       │
└─────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Polling vs. Push:**
   - **Start with polling** (workers query every 5s for ready actions)
   - **Future:** WebSocket push for instant notifications

2. **Atomic claiming:**
   - Use DB transaction to claim action (prevent race conditions)
   - Worker must heartbeat every 30s or claim expires
   - Expired claims auto-released back to ready queue

3. **Concurrency control:**
   - Platform enforces max workers per user
   - User can set max workers in settings
   - Workers respect dependency constraints (don't claim blocked actions)

4. **Error handling:**
   - Failed actions stay claimed until user reviews
   - User can: Retry, Skip, or Cancel
   - Retry counter prevents infinite loops

---

## Conclusion

The current local agent has **zero execution controls** — it's a single-threaded, fully autonomous loop. To enable parallel workers, we need to introduce a **"Ready Queue" mental model** where:

1. Users explicitly mark actions as "ready" (or use "auto-execute" for subtrees)
2. Workers poll for ready actions and claim them atomically
3. Platform shows clear visibility into ready queue and worker status
4. Users have emergency controls (pause, stop, cancel)

This mental model:
- ✅ Addresses user fears (control, visibility, ability to stop)
- ✅ Supports power users (bulk operations, delegation)
- ✅ Aligns with familiar tools (Linear, Kubernetes, CI/CD)
- ✅ Scales to multiple workers (atomic claiming, concurrency limits)
- ✅ Maintains safety (opt-in execution, explicit approval)

**Next steps:**
1. Design data model for ready state and worker claims
2. Build UX for marking actions ready and viewing queue
3. Prototype single worker daemon that polls for ready actions
4. Validate with early users (Finn, James)
