/**
 * Claude SDK Agent Runner
 *
 * This runner integrates with the Anthropic Claude Agent SDK to execute agent tasks.
 * It provides a library-based integration (rather than CLI spawning) with first-class
 * TypeScript support and direct API integration.
 *
 * ## Model Selection Semantics
 *
 * ### Overview
 * The Claude runner supports optional model selection through the `model` parameter in
 * `RunnerExecuteOptions`. When specified, the model parameter flows directly to the
 * Claude SDK's `query()` function. When omitted, the SDK uses its default model.
 *
 * ### Parameter Flow
 *
 * ```typescript
 * // 1. Caller specifies model (or omits it)
 * const options: RunnerExecuteOptions = {
 *   prompt: "...",
 *   model: "claude-opus-4-5-20251101"  // Optional
 * };
 *
 * // 2. claudeRunner.execute() forwards to executeClaude()
 * await claudeRunner.execute(options);
 *
 * // 3. executeClaude() passes model to SDK query()
 * const iterator = query({
 *   prompt: options.prompt,
 *   options: {
 *     ...(options.model ? { model: options.model } : {}),
 *     // ... other SDK options
 *   }
 * });
 * ```
 *
 * ### Default Model
 * When `options.model` is not specified (undefined or omitted), the Claude SDK uses
 * **Claude Sonnet** as the default model. This provides a balanced cost/performance
 * profile suitable for most agent execution workloads.
 *
 * ### Model Identifiers
 * The Claude runner accepts Anthropic-specific model identifiers. Valid examples:
 * - `"claude-opus-4-5-20251101"` - Highest capability, best for complex reasoning
 * - `"claude-sonnet-4-5-20251101"` - Balanced cost/performance (default)
 * - `"claude-haiku-4-5-20251001"` - Fast and cost-effective for simple tasks
 *
 * **Note:** Model identifiers are provider-specific. Using OpenAI model IDs
 * (e.g., "gpt-4") will result in SDK errors. See ADR-001 for cross-provider
 * model selection patterns.
 *
 * ### CLI Flag: --force-haiku
 * The ContextGraph CLI supports a `--force-haiku` flag for convenience:
 *
 * ```bash
 * cg run --provider claude --force-haiku "..."
 * ```
 *
 * **Flag Behavior:**
 * 1. The CLI converts `--force-haiku` to `options.model = "claude-haiku-4-5-20251001"`
 * 2. This happens in `cli/index.ts` before calling the runner
 * 3. The flag is **Claude-only** - it's explicitly ignored for other providers
 * 4. The CLI warns when `--force-haiku` is used with non-Claude providers
 *
 * **Precedence:**
 * - If both `--force-haiku` and an explicit `--model` are provided, the explicit
 *   model takes precedence
 * - CLI flags are converted to `options.model` before runner execution
 * - This ensures consistent behavior across all interfaces (CLI, API, MCP)
 *
 * ### Model Validation
 * Model validation happens at SDK execution time, not at the runner interface:
 * - **Invalid model identifiers** cause SDK execution errors (fail-fast)
 * - **No silent fallbacks** - errors surface immediately with clear messages
 * - **No cross-provider translation** - model IDs are passed to SDK unchanged
 *
 * This design keeps the runner interface thin and defers authoritative validation
 * to the SDK, which has up-to-date knowledge of supported models.
 *
 * ### Cost and Performance Implications
 * Different Claude models have different cost/performance trade-offs:
 *
 * | Model  | Use Case                     | Relative Cost | Relative Speed |
 * |--------|------------------------------|---------------|----------------|
 * | Opus   | Complex reasoning, hard tasks| High          | Slower         |
 * | Sonnet | General purpose (default)    | Medium        | Medium         |
 * | Haiku  | Simple tasks, fast responses | Low           | Faster         |
 *
 * **Recommendation:** Omit `model` parameter for most use cases (uses Sonnet default).
 * Only specify a model when you have specific cost or capability requirements and
 * know the trade-offs.
 *
 * ## Comparison with Codex Runner
 *
 * ### Model Selection
 * - **Claude**: Uses `model` option passed to SDK `query()` function
 * - **Codex**: Uses `--model <model>` CLI flag passed to spawned process
 * - **Common Interface**: Both accept `options.model` in `RunnerExecuteOptions`
 *
 * ### Configuration Mechanism
 * - **Claude**: Library-based configuration via SDK options object
 * - **Codex**: CLI-based configuration via command-line arguments
 *
 * ### Permission Model
 * - **Claude**: Uses `permissionMode: 'bypassPermissions'` (no sandbox concept)
 * - **Codex**: Uses `--full-auto` and `--sandbox <mode>` flags
 *
 * ### Capabilities
 * - **Claude**: `fullAccessExecution: false` - operates within SDK permission model
 * - **Codex**: `fullAccessExecution: true` - can bypass all sandbox restrictions
 *
 * ### When to Use Claude vs Codex
 * **Use Claude runner when:**
 * - Standard agent execution within normal permissions is sufficient
 * - Prefer library integration over CLI spawning
 * - Want tighter TypeScript integration and type safety
 * - Don't need unrestricted file system or network access
 *
 * **Use Codex runner when:**
 * - Need unrestricted file system or network access
 * - Executing in non-git environments
 * - Require specific sandbox mode configuration
 * - Need activity heartbeat for long operations
 *
 * ## References
 * - **Implementation**: `src/claude-sdk.ts` - `executeClaude()` function
 * - **CLI Integration**: `cli/index.ts` - `--force-haiku` flag handling
 * - **Architecture Decision**: `docs/adr/001-model-selection-semantics.md`
 * - **Codex Comparison**: `src/runners/codex-runner.ts` - Alternative runner
 * - **Runner Interface**: `src/runners/types.ts` - `RunnerExecuteOptions`
 */

import { executeClaude } from '../claude-sdk.js';
import type { AgentRunner, RunnerExecuteOptions } from './types.js';

export const claudeRunner: AgentRunner = {
  provider: 'claude',
  capabilities: {
    fullAccessExecution: false,
  },
  async execute(options: RunnerExecuteOptions) {
    return executeClaude(options);
  },
};
