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

**Provider Awareness Required:**
- When specifying a model, users must know which provider will execute
- Default behavior (omitting `model`) works across all providers
- This is acceptable given that provider selection is explicit in the workflow

**CLI Flag Complexity:**
- Provider-specific flags like `--force-haiku` are only valid with their corresponding provider
- The CLI warns when flags are used with incompatible providers
- This prevents silent configuration errors

#### For Cost and Performance

**No Automatic Cost Optimization:**
- The system doesn't automatically select cheaper models for simple tasks
- Users explicitly choose models when cost/performance trade-offs matter
- Future enhancement: capability-based provider selection could optimize this

**Model Awareness for Budget Control:**
- Different models have drastically different costs (e.g., Opus vs Haiku)
- Explicit model selection enables predictable cost management
- Default models are chosen to balance cost and capability

#### For Error Scenarios

**Fail-Fast Philosophy:**
- Invalid model identifiers cause immediate execution errors
- No silent fallbacks to default models (prevents unexpected costs)
- Clear error messages indicate model-provider mismatches

**Debugging Support:**
- Errors clearly indicate which provider rejected the model identifier
- Error messages from providers include valid model examples
- This aligns with the fail-fast, explicit-error architectural pattern

### 4. What Patterns Should Be Standardized?

All execution agent providers in ContextGraph **must** adhere to these patterns:

#### Pattern 1: Optional Model Parameter

```typescript
interface RunnerExecuteOptions {
  model?: string;  // MUST be optional
}
```

**Requirements:**
- Model selection MUST be optional (not required)
- Providers MUST have a sensible default model when `model` is omitted
- The default model SHOULD be documented in runner JSDoc

#### Pattern 2: Provider-Specific Identifiers

**Requirements:**
- Model identifiers MUST use the provider's native format (no translation layer)
- Identifiers MUST be passed to the provider without modification
- Documentation MUST include examples of valid identifiers for each provider

**Example:**
- ✅ Correct: Claude runner documents `claude-opus-4-5-20251101` as valid identifier
- ❌ Incorrect: Creating a translation layer that maps `"opus"` to provider-specific IDs

#### Pattern 3: Fail-Fast on Invalid Models

**Requirements:**
- Invalid model identifiers MUST cause execution errors (not warnings)
- Errors MUST surface immediately (not be logged and ignored)
- Error messages SHOULD indicate which provider rejected the identifier

**Rationale:** Silent fallbacks to default models can cause unexpected costs and behavior drift. Explicit errors force callers to fix configuration issues.

#### Pattern 4: No Interface-Level Validation

**Requirements:**
- The `RunnerExecuteOptions` interface MUST NOT validate model identifiers
- Validation MUST be deferred to the provider implementation
- This prevents stale validation logic as providers evolve their model catalogs

#### Pattern 5: CLI Flag Precedence

**Requirements:**
- Provider-specific CLI flags (like `--force-haiku`) MUST convert to `options.model` before execution
- Explicit `options.model` parameter MUST take precedence over CLI flags
- CLI MUST warn when provider-specific flags are used with incompatible providers

#### Pattern 6: Documentation Standards

**Every runner MUST document:**
1. Default model when `model` parameter is omitted
2. Format of valid model identifiers with examples
3. Any provider-specific CLI flags related to model selection
4. How the `options.model` parameter flows to the provider

**Documentation location:** JSDoc header comment in the runner file

### 5. What Guidance for Future Providers?

When integrating a new execution agent provider (Cursor, Aider, Devin, etc.), follow these steps:

#### Step 1: Determine Capabilities

**Questions to Answer:**
- What models does this provider support?
- How does the provider accept model configuration? (CLI flag? API option? Config file?)
- What's the default model if none is specified?
- What model identifier format does the provider expect?

#### Step 2: Implement Runner Interface

```typescript
export class MyProviderRunner implements AgentRunner {
  async execute(options: RunnerExecuteOptions): Promise<AgentRunResult> {
    // 1. Extract model parameter
    const model = options.model;

    // 2. Pass to provider in provider-specific format
    const providerConfig = {
      ...(model ? { model } : {}),  // Or whatever the provider expects
    };

    // 3. Let provider validate (don't validate at this layer)
    return await executeProvider(providerConfig);
  }
}
```

#### Step 3: Document Behavior

Add JSDoc header to runner file documenting:

```typescript
/**
 * [Provider Name] Agent Runner
 *
 * ## Model Selection
 * - **Default model**: [model name] (used when options.model is omitted)
 * - **Model identifiers**: [format description]
 * - **Examples**: 'model-id-1', 'model-id-2'
 * - **Parameter flow**: options.model → [how it reaches the provider]
 *
 * ## CLI Flags
 * - `--flag-name`: [description of provider-specific flags]
 */
```

#### Step 4: Add Integration Tests

```typescript
describe('MyProviderRunner model selection', () => {
  it('uses default model when options.model is omitted', async () => {
    // Verify provider called with no model override
  });

  it('passes model to provider when specified', async () => {
    const result = await runner.execute({
      model: 'valid-model-id'
    });
    // Verify provider called with correct model
  });

  it('fails fast on invalid model identifier', async () => {
    await expect(
      runner.execute({ model: 'invalid-model' })
    ).rejects.toThrow();
  });
});
```

#### Step 5: Update CLI If Needed

If the provider has convenient model selection patterns (like Claude's `--force-haiku`), add CLI support:

```typescript
// In CLI argument parser
if (options.forceMyFlag && options.provider === 'myprovider') {
  runnerOptions.model = 'provider-specific-model-id';
}

// Warn on misuse
if (options.forceMyFlag && options.provider !== 'myprovider') {
  console.warn('--force-my-flag only works with myprovider, ignoring');
}
```

## Consequences

### Positive

**Architectural Clarity:**
- Clean separation between provider-neutral interface and provider-specific implementation
- Easy to reason about: "model parameter flows to provider unchanged"
- No hidden translation layers that can become stale

**Provider Flexibility:**
- Each provider can support its full model catalog without central taxonomy
- Providers can add/change models without modifying shared interface
- Future providers integrate with minimal changes to existing code

**Fail-Fast Behavior:**
- Configuration errors surface immediately rather than causing silent failures
- Users get clear feedback when model identifiers don't match their provider
- Prevents unexpected costs from silent model substitution

**Future-Proof Scalability:**
- Pattern works for arbitrary number of providers
- No central model registry to maintain
- Adding new providers doesn't affect existing runners

### Negative

**Provider Awareness Required:**
- Users must know which provider will execute if they want to specify models
- No automatic model selection based on task complexity
- Documentation burden: each provider must document its model catalog

**CLI Flag Complexity:**
- Provider-specific flags can confuse users (e.g., `--force-haiku` ignored for Codex)
- Help text becomes more complex with multiple providers
- Users may attempt invalid flag combinations

**No Cost Optimization Layer:**
- System doesn't automatically route simple tasks to cheaper models
- Users must explicitly choose models when cost matters
- Missed opportunity for automatic cost optimization (deferred to future work)

### Future Enhancements

**Capability-Based Provider Selection (Out of Scope for ADR-001):**
- Instead of specifying provider + model, users could specify required capabilities
- System routes to appropriate provider/model combination
- Example: `{ requiresCodeExecution: true, preferCostEfficient: true }`
- This would enable automatic cost optimization while preserving explicit control

**Provider-Neutral Model Tiers (Future ADR):**
- Define abstract tiers: "fast", "balanced", "max-capability"
- Each provider maps tiers to their specific models
- Allows provider-agnostic tier selection while preserving fail-fast on incompatible identifiers
- Requires careful design to avoid hidden complexity

## References

- **Codex Runner Documentation**: `src/runners/codex-runner.ts` (JSDoc header, Section 4)
- **Claude SDK Documentation**: `src/claude-sdk.ts` (JSDoc for ExecuteClaudeOptions)
- **Runner Interface**: `src/agent-runner.ts` (RunnerExecuteOptions type)
- **CLI Implementation**: `cli/index.ts` (--force-haiku flag handling)
