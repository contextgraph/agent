/**
 * Sanitize environment variables for Codex execution.
 *
 * Removes restrictive sandbox flags that should not be inherited from parent environments,
 * allowing the workflow layer to control sandbox behavior explicitly through CLI flags.
 *
 * @param env - The environment object to sanitize (typically process.env)
 * @returns A new environment object with Codex-specific variables removed
 */
export function sanitizeCodexEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): Record<string, string | undefined> {
  const sanitized = { ...env };

  // Remove Codex-specific sandbox flags to avoid inheriting restrictive settings
  delete sanitized.CODEX_SANDBOX_NETWORK_DISABLED;
  delete sanitized.CODEX_SANDBOX;
  delete sanitized.CODEX_SANDBOX_POLICY;

  return sanitized;
}
