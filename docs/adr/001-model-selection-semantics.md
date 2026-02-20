# ADR-001: Model Selection Semantics Across Agent Providers

## Status

Accepted

## Context

ContextGraph supports multiple execution agent providers (Claude SDK and Codex CLI) to enable diverse execution capabilities and model/agent agnosticism. Each provider has its own model selection mechanism, yet they must integrate through a unified interface to maintain architectural consistency and enable seamless provider switching.

This ADR synthesizes model selection behavior across both providers to answer critical questions about how model selection works, how providers differ, and how future providers should be integrated.

## Decision

We adopt a **provider-neutral API surface with provider-specific model identifiers** pattern for model selection across all execution agents.

### 1. What Model Selection Semantics Exist?

Model selection in ContextGraph operates through a consistent interface defined in `RunnerExecuteOptions`:

```typescript
interface RunnerExecuteOptions {
  model?: string;  // Optional model override
  // ... other options
}
```

**Key Characteristics:**
- **Optional override**: Model selection is always optional; providers have sensible defaults
- **String-based identifiers**: Model identifiers are provider-specific strings (e.g., `claude-opus-4-5-20251101` for Claude, OpenAI model IDs for Codex)
- **No validation at interface boundary**: The common interface accepts any string; validation happens at provider level
- **No fallback behavior**: Invalid model identifiers result in provider errors rather than silent fallbacks

### 2. How Do They Differ Between Providers?

#### Claude SDK Runner

**Configuration Mechanism:**
```typescript
const iterator = query({
  prompt: options.prompt,
  options: {
    ...(options.model ? { model: options.model } : {}),
    // ... other SDK options
  }
});
```

**Characteristics:**
- **Default model**: Claude Sonnet (SDK default when model not specified)
- **Model identifiers**: Anthropic-specific (e.g., `claude-opus-4-5-20251101`, `claude-sonnet-4-5-20251101`)
- **CLI flag support**: `--force-haiku` flag in CLI maps to specific Claude model identifier
- **Documentation location**: JSDoc in `src/claude-sdk.ts`

**Model Selection Flow:**
1. Check `options.model` parameter
2. If present, pass to SDK as `model` option
3. If absent, SDK uses default (Sonnet)

#### Codex CLI Runner

**Configuration Mechanism:**
```typescript
if (options.model) {
  args.push('--model', options.model);
}
// Spawn codex CLI with args
```

**Characteristics:**
- **Default model**: Codex CLI default (not specified by runner)
- **Model identifiers**: Provider-specific (typically OpenAI model IDs for Codex)
- **CLI flag**: `--model <model>` passed directly to spawned process
- **Documentation location**: JSDoc header in `src/runners/codex-runner.ts` (Section 4)

**Model Selection Flow:**
1. Check `options.model` parameter
2. If present, append `--model` flag to CLI arguments
3. If absent, Codex CLI uses its own default

### 3. What Are the Implications?

#### For Platform Architecture

**Unified Interface, Provider-Specific Behavior:**
- The `RunnerExecuteOptions.model` field provides a consistent API surface
- Callers don't need to know which provider will execute the request
- Provider selection happens independently of model selection

**No Cross-Provider Model Translation:**
- Model identifiers are not normalized or translated between providers
- Using `claude-opus-4-5-20251101` with Codex would fail (and should fail)
- This is intentional: different providers have different model capabilities

**Error Handling Responsibility:**
- Model validation is deferred to providers (fail-fast at execution time)
- Invalid models surface as provider execution errors, not interface validation errors
- This keeps the common interface thin and prevents stale validation logic

#### For Users and Callers

**Model Selection Guidelines:**
1. **Omit `model` parameter**: Use provider defaults (recommended for most cases)
2. **Specify `model` parameter**: Only when you need a specific model tier and know which provider will execute
3. **Provider-aware model selection**: When specifying models, ensure identifier matches the provider that will run

**CLI Flag Behavior:**
- `--force-haiku` flag is **Claude-only** and explicitly ignored for other providers
- The CLI warns when `--force-haiku` is used with non-Claude providers (see `cli/index.ts` lines 58-59)
- This prevents silent misconfiguration

#### For Cost and Performance

**Model Tier Implications:**
- Different model tiers have different cost/performance trade-offs
- Model selection directly impacts execution cost, latency, and quality
- Default models are chosen to balance cost and capability for typical workloads

**Provider Defaults:**
- Claude SDK defaults to Sonnet (balanced cost/performance)
- Codex CLI default is provider-determined
- Users can override for specific needs (e.g., Haiku for simple tasks, Opus for complex reasoning)

### 4. What Patterns Should Be Standardized?

#### For All Providers

**1. Optional Model Parameter:**
Every runner must accept `options.model?: string` in `RunnerExecuteOptions` and:
- Support omitting it (use provider default)
- Support specifying it (use provided model)
- Not perform cross-provider model translation

**2. Provider-Specific Identifiers:**
- Use the provider's native model identifier format
- Do not attempt to normalize or abstract model names
- Document supported model identifiers in provider runner JSDoc

**3. Fail-Fast on Invalid Models:**
- Invalid model identifiers should cause execution errors (not silent fallbacks)
- Error messages should clearly indicate the model identifier was invalid
- Do not substitute a different model without explicit user intent

**4. Documentation Standards:**
Every runner implementation must document:
- Default model when `options.model` is omitted
- Format/examples of valid model identifiers
- Any provider-specific CLI flags that affect model selection
- How model selection flows from interface to underlying provider

#### For CLI Integration

**5. Provider-Specific Flags:**
- Provider-specific flags (like `--force-haiku`) are acceptable for CLI convenience
- Such flags must be documented as provider-specific
- CLI must warn/ignore when flags don't match the active provider

**6. Model Override Precedence:**
When both CLI flags and API parameters could specify models:
- Explicit `options.model` parameter takes precedence
- CLI flags are converted to `options.model` before runner execution
- This ensures consistent behavior across interfaces (CLI, API, MCP)

### 5. What Guidance for Future Providers?

When adding a new execution agent provider (Cursor, Aider, Devin, etc.), follow this pattern:

#### Step 1: Determine Provider Capabilities

**Questions to answer:**
- What is the provider's default model?
- What model identifiers does it support?
- How does the provider accept model configuration (CLI flag, API parameter, config file)?
- Can it validate model identifiers before execution?

#### Step 2: Implement Runner Interface

**Required behavior:**
```typescript
export const newProviderRunner: AgentRunner = {
  provider: 'new-provider',
  capabilities: { /* ... */ },
  async execute(options: RunnerExecuteOptions) {
    // 1. Check options.model
    // 2. If present, pass to provider using its native mechanism
    // 3. If absent, let provider use its default
    // 4. Do NOT translate model identifiers
    // 5. Let provider errors surface naturally
  }
};
```

#### Step 3: Document Model Selection

**Add JSDoc to runner file:**
```typescript
/**
 * ### Model Selection
 * - **Default model**: [Provider's default when options.model is omitted]
 * - **Model identifiers**: [Format and examples, e.g., "gpt-4", "claude-3-opus-20240229"]
 * - **Configuration mechanism**: [How model is passed to provider]
 * - **Validation**: [When/how invalid models are detected]
 */
```

#### Step 4: Test Model Selection Behavior

**Required test cases:**
1. Default model execution (omit `options.model`)
2. Explicit model override (specify `options.model`)
3. Invalid model identifier (verify error handling)
4. Model-specific capabilities (if applicable)

#### Step 5: Update CLI (If Applicable)

**If adding provider-specific CLI flags:**
1. Document flag as provider-specific in CLI help
2. Add provider detection logic to warn/ignore when provider doesn't match
3. Convert CLI flag to `options.model` before calling runner
4. Follow precedence pattern (explicit > flag > default)

## Consequences

### Positive

**Architectural Clarity:**
- Clear separation between interface (provider-neutral) and implementation (provider-specific)
- No leaky abstractions: model identifiers stay in provider domain
- Easy to reason about: model selection is explicit and traceable

**Provider Flexibility:**
- Each provider can support its full model catalog
- No need to map models to a common taxonomy
- Providers can add/change models without interface changes

**Fail-Fast Behavior:**
- Invalid model configurations surface immediately as execution errors
- No silent fallbacks that could cause unexpected costs or behavior
- Clear error messages guide users to correct model identifiers

**Future-Proof:**
- Pattern scales to arbitrary number of providers
- No central model registry to maintain
- New providers integrate without modifying existing runners

### Negative

**Provider Awareness Required:**
- Users specifying models must know which provider will execute
- No automatic model translation between providers
- Model identifiers are not portable across providers

**CLI Flag Complexity:**
- Provider-specific flags (like `--force-haiku`) require provider detection
- Warning messages may confuse users who don't understand provider distinctions
- Precedence rules add cognitive overhead

### Mitigation Strategies

**For Provider Awareness:**
- Default behavior (omit `model`) works across all providers
- Documentation clearly shows model identifiers are provider-specific
- Error messages indicate when model identifier doesn't match provider

**For CLI Complexity:**
- Clear help text indicating which flags apply to which providers
- Helpful warning messages when flags are ignored
- Consider future enhancement: provider-neutral model tier selection (e.g., `--tier=fast|balanced|powerful`)

## References

- **Codex Runner Documentation**: `src/runners/codex-runner.ts` (JSDoc header, Section 4)
- **Claude SDK Integration**: `src/claude-sdk.ts` (ExecuteClaudeOptions interface, lines 134-136)
- **CLI Implementation**: `cli/index.ts` (--force-haiku handling, lines 58-59)
- **Runner Interface**: `src/runners/types.ts` (RunnerExecuteOptions interface)
- **Completed Documentation Work**: PR #25 - Document Codex runner constraints and differences

## Related Decisions

- **ADR-002** (future): Provider-neutral event type vocabulary
- **ADR-003** (future): Capability-based provider selection
- **ADR-004** (future): Cost/usage tracking standardization

---

**Last Updated**: February 20, 2026
**Authors**: Agent execution team
**Reviewers**: TBD
