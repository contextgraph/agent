# Test Coverage Report

**Generated**: 2026-03-18
**Current Coverage**: 9.27% statements | 4.85% branches | 11.96% functions | 9.35% lines
**Target Threshold**: 80% (defined in jest.config.js)

## Executive Summary

Test coverage measurement is now enabled via `npm run test:coverage`, revealing that **core execution paths have 0% coverage** despite 39 CLI integration tests being added in PR #23.

The existing jest.config.js defines an 80% coverage threshold across all metrics, but the test script in package.json did not run coverage collection, leaving gaps invisible during development.

## Critical Gaps: 0% Coverage

These files represent the core agent execution loop and are completely untested:

### Workflows (Core Execution)
- **`src/workflows/execute.ts`** (0%) - Main execution workflow
- **`src/workflows/steward-step.ts`** (0%) - Steward step orchestration
- **`src/workflows/steward-run.ts`** (0%) - Steward run management
- **`src/workflows/prepare.ts`** (0%) - Preparation workflow
- **`src/workflows/auth.ts`** (0%) - Authentication workflow

### Runners (Task Execution)
- **`src/runners/codex-runner.ts`** (2.56%) - Codex runner implementation
- **`src/runners/claude-runner.ts`** (50%) - Claude runner wrapper

### CLI (User Interface)
- **`src/cli/cg.ts`** (0%) - Main CLI entry point
- **`src/cli/index.ts`** (0%) - CLI command handlers
- **`src/cli/schemas.ts`** (0%) - CLI argument schemas

### Infrastructure
- **`src/auth-flow.ts`** (0%) - OAuth authentication
- **`src/callback-server.ts`** (0%) - OAuth callback handling
- **`src/cg-api-client.ts`** (0%) - API client
- **`src/credentials.ts`** (0%) - Credential management
- **`src/heartbeat-manager.ts`** (0%) - Agent health monitoring
- **`src/langfuse-session.ts`** (0%) - Langfuse telemetry
- **`src/log-buffer.ts`** (0%) - Log buffering
- **`src/next-action.ts`** (0%) - Action selection logic
- **`src/posthog-client.ts`** (0%) - Analytics client
- **`src/sdk-event-transformer.ts`** (0%) - Event transformation
- **`src/workspace-setup.ts`** (0%) - Workspace initialization

## Moderate Coverage (10-60%)

- **`src/workspace-prep.ts`** (52.35%) - Workspace preparation has some test coverage
- **`src/skills-library-fetch.ts`** (40%) - Skills fetching partially covered
- **`src/plugin-setup.ts`** (10.52%) - Plugin setup minimally covered
- **`src/claude-sdk.ts`** (3.12%) - SDK wrapper minimally covered

## Well-Covered Files

- **`src/fetch-with-retry.ts`** (92.85%) - Retry logic well tested
- **`src/logging-schema.ts`** (100%) - Schema definitions fully tested
- **`src/workflows/execution-policy.ts`** (100%) - Policy logic fully tested

## Blockers to Coverage Collection

TypeScript compilation errors prevent coverage from being collected on some files:

1. **`src/workflows/setup.ts`** - Invalid 'options' property on ListrTask
2. **`src/workflows/agent.ts`** - Multiple unused imports and declarations

These errors do not prevent the code from running (build succeeds) but block Jest's coverage instrumentation.

## Test Suite Status

**Note**: As of this baseline, the test suite has pre-existing failures:
- 72 failed tests
- 127 passed tests
- 13 failed test suites
- 6 passed test suites

These failures exist on main branch and are unrelated to coverage configuration changes.

## Usage

### Run tests with coverage
```bash
npm run test:coverage
```

### Generate JSON summary for CI
```bash
npm run test:coverage:json
```

### View HTML coverage report
```bash
npm run test:coverage
open coverage/lcov-report/index.html
```

## Recommendations

### Immediate Priority: Core Execution Loop
1. Add behavioral tests for `src/workflows/execute.ts` - the main entry point
2. Add behavioral tests for `src/workflows/steward-step.ts` - steward orchestration
3. Add behavioral tests for `src/workflows/prepare.ts` - preparation workflow

### Next Priority: Runners
4. Add integration tests for `src/runners/codex-runner.ts`
5. Increase coverage of `src/runners/claude-runner.ts`

### Infrastructure Hardening
6. Fix TypeScript errors blocking coverage collection
7. Add tests for authentication flows (auth-flow.ts, callback-server.ts)
8. Add tests for credential management
9. Add tests for telemetry/observability (langfuse-session.ts, posthog-client.ts)

### CLI Testing
10. Add integration tests for CLI commands
11. Add schema validation tests

## Success Metrics

Track these metrics over time to measure test infrastructure health:

- **Statement coverage**: 9.27% → 80% (target)
- **Branch coverage**: 4.85% → 80% (target)
- **Function coverage**: 11.96% → 80% (target)
- **Line coverage**: 9.35% → 80% (target)
- **Core workflow coverage**: 0% → 60%+ (minimum for merge confidence)
- **Test suite stability**: 127 passing → all passing

## Coverage Configuration

Coverage is configured in `jest.config.js`:

```javascript
collectCoverageFrom: [
  'src/**/*.ts',
  '!src/**/*.d.ts',
  '!src/index.ts',
],
coverageThreshold: {
  global: {
    branches: 80,
    functions: 80,
    lines: 80,
    statements: 80,
  },
},
```

The threshold is currently **not enforced in CI** (tests can pass even when coverage is below 80%), but coverage gaps are now visible during development.
