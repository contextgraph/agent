# Test Conventions

This directory contains all Jest tests for the `agent` repo. These conventions were established in PR #80 to address ESM mock breakages that repeatedly appeared in steward-authored test PRs (#69, #74, #77). Follow them for every new test file.

---

## ESM Mock Conventions

The repo uses `"type": "module"` and the `ts-jest` ESM preset. CommonJS-style mocking **does not work** in this environment — use the patterns below exclusively.

### 1. Never use `jest.mock()` — always use `jest.unstable_mockModule()`

`jest.mock()` works by hoisting the call to the top of the file at build time, which relies on CommonJS module caching. In an ESM context the module system uses live bindings and the hoisting transform does nothing useful.

**❌ Wrong — CommonJS pattern (breaks in ESM)**
```ts
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
}));

import { query } from '@anthropic-ai/claude-agent-sdk'; // already evaluated, mock is ignored
```

**✅ Correct — ESM pattern**
```ts
const mockQuery = jest.fn();

jest.unstable_mockModule('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery,
}));

const { executeClaude } = await import('../src/claude-sdk.js');
```

### 2. Declare mock functions *before* `jest.unstable_mockModule()`

`jest.unstable_mockModule` factories close over variables in the outer scope. Declare the mock functions first so the factory can reference them, and so your tests can call `.mockReturnValue()` / `.mockReset()` on the same reference.

```ts
const mockSpawn = jest.fn() as unknown as jest.MockedFunction<typeof import('child_process').spawn>;

jest.unstable_mockModule('child_process', () => ({
  spawn: mockSpawn,
}));

const { isClaudeCodeAvailable } = await import('../src/plugin-setup.js');
```

### 3. Use `await import()` to load modules under test — after all mocks are registered

All `jest.unstable_mockModule` calls must be registered **before** the module under test is imported. In ESM the import is live; if the module is imported first it resolves against the real module, not the mock.

Put every `await import(...)` for the module under test at the top level of the file, after the mock registrations. Top-level `await` is valid in ESM test files under the ts-jest ESM preset.

```ts
// 1. Declare mock handles
const mockMkdir = jest.fn() as any;
const mockWriteFile = jest.fn() as any;

// 2. Register mocks
jest.unstable_mockModule('fs/promises', () => ({
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
}));

// 3. Import module under test — after all mocks
const { injectSkills } = await import('../src/skill-injection.js');
```

### 4. Use `import type` for types, not value imports, from mocked modules

When a module is mocked, its runtime values are replaced. Import types separately with `import type` so TypeScript can still resolve shapes without triggering a live import.

```ts
import type { SpawnClaudeOptions } from '../src/types/actions.js';
// NOT: import { SpawnClaudeOptions } from '../src/types/actions.js'
// (would create a value import from the mocked module)
```

For types from a mocked external module, use inline `import()`:
```ts
type SkillToInject = import('../src/skill-injection.js').SkillToInject;
```

### 5. ESM-default exports (e.g. `chalk`) need `default:` in the factory

Packages that export via `export default` must be mocked with a `default` key. Include `__esModule: true` for clarity.

```ts
jest.unstable_mockModule('chalk', () => ({
  default: {
    cyan: (s: string) => s,
    dim: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
  },
  __esModule: true,
}));
```

---

## `--experimental-vm-modules` is Required

`jest.unstable_mockModule` uses Node's experimental VM module API. The test runner command in `package.json` already includes the flag:

```json
"test": "node --experimental-vm-modules ./node_modules/jest/bin/jest.js"
```

If you see `Cannot use jest.unstable_mockModule without the experimental VM modules flag` or mocks silently having no effect, check that you are running tests via `pnpm test` (not `jest` directly) and that the flag is present.

---

## Canonical Reference — Behavioral Contract Tests

`__tests__/runners/runner-contract.test.ts` (PR #69) is the canonical example of a test file that **does not need mocking at all** because it tests pure-TypeScript interfaces and factory functions directly. Read it before adding mocks to understand whether mocks are actually needed.

When mocks *are* needed, `__tests__/workflows/prompt-prefix.test.ts` is the reference for mocking multiple project-local modules (`credentials.js`, `runners/index.js`, `workspace-setup.js`, etc.) in a single workflow test.

---

## Quick Checklist

Before committing a new test file, verify:

- [ ] No `jest.mock()` calls — only `jest.unstable_mockModule()`
- [ ] Mock function handles are declared *before* the `jest.unstable_mockModule` call that uses them
- [ ] The module under test is imported with `await import(...)` *after* all mock registrations
- [ ] Types from mocked modules are imported with `import type` or inline `import()`
- [ ] ESM default exports are mocked with a `default:` key
- [ ] Tests are run via `pnpm test` (which passes `--experimental-vm-modules`)
