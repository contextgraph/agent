# CLI Flag Contract Audit

This document establishes deterministic contracts for all CLI flags in the contextgraph-agent, ensuring unambiguous semantics across different polling intervals and execution contexts.

## Motivation

PR #47 revealed that `--max-steps` had implicit, interval-dependent semantics (counting all polling iterations rather than claimed work). This audit systematically reviews all CLI flags to prevent similar ambiguities.

## Contract Principles

1. **Deterministic semantics**: Flag behavior must be predictable regardless of polling intervals, network conditions, or system load
2. **Explicit units**: All numeric flags must document their units and counting semantics
3. **Boundary behavior**: Document behavior at edge cases (zero, negative, infinity)
4. **Null vs. unset**: Distinguish between explicitly set and default values where semantics differ

---

## Global Flags

### `--version`
- **Contract**: Display package version and exit
- **Determinism**: ✅ Non-interactive, no side effects
- **Edge cases**: None

---

## Command: `setup`

Interactive setup wizard. No flags.

**Determinism**: ⚠️ Interactive - not suitable for automation
**Recommendation**: Already documented as interactive; no changes needed

---

## Command: `run`

Continuous worker loop that claims and executes actions until stopped.

### `--provider <provider>`
- **Contract**: Specifies execution provider (`claude` | `codex`)
- **Default**: `claude`
- **Validation**: Rejects invalid values with exit code 1
- **Determinism**: ✅ Explicit enum, no ambiguity

### `--execution-mode <mode>`
- **Contract**: Execution mode (`restricted` | `full-access`)
- **Default**: Provider-specific default (not CLI default)
- **Validation**: Rejects invalid values with exit code 1
- **Determinism**: ✅ Explicit enum, no ambiguity

### `--force-haiku`
- **Contract**: Force all workflows to use `claude-haiku-4-5-20251001` instead of default models
- **Constraints**: Only effective when `--provider claude`
- **Validation**: Warns if used with non-claude provider
- **Determinism**: ✅ Boolean flag, clear scope

### `--skip-skills`
- **Contract**: Skip skill injection (for testing)
- **Default**: `false`
- **Determinism**: ✅ Boolean flag, no side effects on core workflow

---

## Command: `auth`

Interactive authentication flow. No flags.

**Determinism**: ⚠️ Interactive OAuth flow - not suitable for automation
**Recommendation**: Already documented as interactive; automation uses `CONTEXTGRAPH_API_TOKEN` env var

---

## Command: `prepare <action-id>`

Prepare a single action.

### `<action-id>` (argument)
- **Contract**: UUID of action to prepare
- **Validation**: Must be valid UUID
- **Determinism**: ✅ Direct target, no search/filter ambiguity

### `--provider <provider>`
- **Contract**: Same as `run` command
- **Determinism**: ✅ See above

### `--execution-mode <mode>`
- **Contract**: Same as `run` command
- **Determinism**: ✅ See above

### `--skip-skills`
- **Contract**: Same as `run` command
- **Determinism**: ✅ See above

---

## Command: `execute <action-id>`

Execute a single action.

### `<action-id>` (argument)
- **Contract**: UUID of action to execute
- **Validation**: Must be valid UUID
- **Determinism**: ✅ Direct target, no search/filter ambiguity

### `--provider <provider>`
- **Contract**: Same as `run` command
- **Determinism**: ✅ See above

### `--execution-mode <mode>`
- **Contract**: Same as `run` command
- **Determinism**: ✅ See above

### `--skip-skills`
- **Contract**: Same as `run` command
- **Determinism**: ✅ See above

---

## Command: `steward step`

Run one steward execution pass (claim → execute → release).

### `--steward-id <stewardId>`
- **Contract**: Target a specific steward UUID
- **Default**: None (accepts any steward work)
- **Validation**: No format validation currently
- **Determinism**: ✅ When set, explicit target; when unset, first available
- **Potential issue**: ⚠️ No UUID format validation - malformed IDs fail silently at API level

### `--worker-id <workerId>`
- **Contract**: Worker ID for claim/release correlation
- **Default**: Auto-generated UUID per invocation
- **Determinism**: ✅ Explicit when set; deterministic generation when unset
- **Use case**: Enables correlation across multiple step invocations

### `--dry-run`
- **Contract**: Claim and fetch prompt, but skip agent execution
- **Boundary behavior**: Still creates agent run record, still claims/releases
- **Determinism**: ✅ Boolean flag, explicit scope

### `--provider <provider>`
- **Contract**: Same as `run` command
- **Determinism**: ✅ See above

### `--execution-mode <mode>`
- **Contract**: Same as `run` command
- **Determinism**: ✅ See above

### `--skip-skills`
- **Contract**: Same as `run` command
- **Determinism**: ✅ See above

### `--base-url <baseUrl>`
- **Contract**: ContextGraph API base URL
- **Default**: `https://www.contextgraph.dev` (or `CONTEXTGRAPH_BASE_URL` env var)
- **Determinism**: ✅ Explicit URL override for testing/staging

---

## Command: `steward run`

Run steward execution loop (repeated steward step until stopped).

### `--steward-id <stewardId>`
- **Contract**: Same as `steward step`
- **Determinism**: ✅ See above
- **Potential issue**: ⚠️ Same validation gap

### `--worker-id <workerId>`
- **Contract**: Worker ID shared across all loop iterations
- **Default**: Auto-generated UUID at loop start (shared across iterations)
- **Determinism**: ✅ Single worker ID for entire loop session
- **Use case**: Enables correlation of all work done in a single loop run

### `--dry-run`
- **Contract**: Claim and fetch prompt each loop, but skip agent execution
- **Boundary behavior**: Loop continues, claims/releases still happen
- **Determinism**: ✅ Boolean flag, applied uniformly across iterations

### `--provider <provider>`
- **Contract**: Same as `run` command
- **Determinism**: ✅ See above

### `--execution-mode <mode>`
- **Contract**: Same as `run` command
- **Determinism**: ✅ See above

### `--skip-skills`
- **Contract**: Same as `run` command
- **Determinism**: ✅ See above

### `--base-url <baseUrl>`
- **Contract**: Same as `steward step`
- **Determinism**: ✅ See above

### `--interval-seconds <seconds>`
- **Contract**: Delay between loop **checks** (includes both claimed work and idle polls)
- **Default**: `30`
- **Units**: Seconds (integer)
- **Validation**: Must be non-negative integer
- **Boundary behavior**:
  - `0` = no delay (hot loop, not recommended for production)
  - Delay applies *after* each check completes (work + delay = iteration time)
- **Determinism**: ✅ **Explicit wall-clock delay between checks**
- **Clarification**: This is a pure interval timer, not affected by work duration
- **Implementation**: Uses `sleep()` + signal checking, interruptible by SIGINT/SIGTERM

### `--max-steps <count>` ✅ **FIXED IN PR #47**
- **Contract**: Maximum number of **claimed steps** before exiting
- **Default**: `undefined` (runs until stopped)
- **Units**: Count of successful claims (not total iterations)
- **Validation**: Must be positive integer when provided
- **Boundary behavior**:
  - Idle polls (no work available) are **not** counted
  - Failed claims (API errors) are **not** counted
  - Only increments when `runStewardStep()` returns `{ claimed: true }`
- **Determinism**: ✅ **Counts actual work, independent of polling frequency**
- **Test coverage**: ✅ `__tests__/workflows/steward-run.test.ts`
- **Implementation**: `stepCount` only increments when `stepResult.claimed === true`

### `--stop-on-error`
- **Contract**: Exit loop on first step error
- **Default**: `false` (continue past errors)
- **Scope**: Applies to execution errors, not claim failures
- **Boundary behavior**:
  - Claim failures (transient API errors) are retried indefinitely
  - Execution errors (agent failures) trigger exit when flag is set
- **Determinism**: ✅ Boolean flag, explicit error handling strategy
- **Implementation**: Breaks loop on error in try-catch around `runStewardStep()`

---

## Command: `whoami`

Show current authentication status. No flags.

**Determinism**: ✅ Read-only status check, no side effects

---

## Audit Findings

### ✅ Deterministic Flags (No Changes Needed)

All flags that already have deterministic, unambiguous semantics:
- `--provider`: Explicit enum
- `--execution-mode`: Explicit enum
- `--force-haiku`: Boolean with clear scope
- `--skip-skills`: Boolean test flag
- `--dry-run`: Boolean with explicit scope
- `--base-url`: Explicit URL override
- `--worker-id`: Explicit when set, deterministic generation when unset
- `--interval-seconds`: Explicit wall-clock delay
- `--max-steps`: ✅ **Fixed to count only claimed work** (PR #47)
- `--stop-on-error`: Boolean error handling strategy

### ⚠️ Validation Gaps (Non-Determinism Risks)

#### `--steward-id` UUID validation
- **Current state**: No format validation in CLI layer
- **Risk**: Malformed UUIDs fail silently at API level with ambiguous error messages
- **Impact**: Low (UUID format is well-known, errors are caught eventually)
- **Recommendation**: Add format validation for better error messages
- **Priority**: Low (cosmetic improvement, not a determinism issue)

### 🎯 Test Coverage Recommendations

#### Existing coverage
- ✅ `steward run --max-steps`: `__tests__/workflows/steward-run.test.ts`

#### Missing coverage
- ⚠️ `--interval-seconds` boundary behavior (zero, large values)
- ⚠️ `--stop-on-error` error handling path
- ⚠️ `--dry-run` claim/release behavior

**Recommendation**: Add integration tests for:
1. `--interval-seconds 0` (hot loop behavior)
2. `--stop-on-error` with simulated execution failure
3. `--dry-run` verifies claim/release without execution

---

## Summary

**Overall assessment**: ✅ **CLI contracts are deterministic**

After PR #47, all CLI flags have explicit, interval-independent semantics. The only identified gap is cosmetic (UUID validation for better error messages).

### Key findings:
1. **No hidden interval dependencies**: All timing flags are explicit wall-clock delays
2. **Counters are work-based**: `--max-steps` counts actual work, not iterations (fixed in PR #47)
3. **Boolean flags are well-scoped**: All feature toggles have clear boundaries
4. **Enums are validated**: Invalid values rejected at CLI layer

### Recommendations:
1. **Add UUID format validation** for `--steward-id` (low priority)
2. **Add integration tests** for edge cases (`--interval-seconds 0`, `--stop-on-error`, `--dry-run`)
3. **Document worker-id semantics** in help text (correlation behavior is not obvious)
