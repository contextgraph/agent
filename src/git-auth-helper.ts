import { mkdtemp, writeFile, chmod, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Creates a temporary GIT_ASKPASS helper script that securely provides credentials to git operations.
 *
 * The helper script is a shell script that echoes the provided token when invoked by git.
 * This approach keeps tokens out of process arguments and environment variables visible to other processes.
 *
 * @param token - The authentication token (GitHub or GitLab token)
 * @returns Path to the created helper script
 * @throws Error if file operations fail
 *
 * @example
 * const helperPath = await createGitAskpassHelper(token);
 * try {
 *   // Use with git operations
 *   const env = getGitEnvWithCredentials(token, helperPath);
 *   await execFile('git', ['clone', repoUrl], { env });
 * } finally {
 *   await cleanupGitAskpassHelper(helperPath);
 * }
 */
export async function createGitAskpassHelper(token: string): Promise<string> {
  // Create a temporary directory with restricted permissions
  const tempDir = await mkdtemp(join(tmpdir(), 'git-helper-'));
  const helperPath = join(tempDir, 'askpass.sh');

  // Create shell script that echoes the token
  // The script receives a prompt from git as $1 but we ignore it and always return the token
  const script = `#!/bin/sh
echo "${token}"
`;

  await writeFile(helperPath, script);

  // Set restrictive permissions: owner read/execute only (0o700)
  // This prevents other users from reading the token from the script
  await chmod(helperPath, 0o700);

  return helperPath;
}

/**
 * Cleans up the temporary GIT_ASKPASS helper script and its containing directory.
 *
 * This function should always be called after git operations complete, even if they fail.
 * Use try-finally blocks to ensure cleanup happens.
 *
 * @param helperPath - Path to the helper script (returned by createGitAskpassHelper)
 * @throws Error if cleanup fails (logged but not propagated to avoid masking original errors)
 *
 * @example
 * const helperPath = await createGitAskpassHelper(token);
 * try {
 *   // Use helper...
 * } finally {
 *   await cleanupGitAskpassHelper(helperPath);
 * }
 */
export async function cleanupGitAskpassHelper(helperPath: string): Promise<void> {
  try {
    // Extract the temporary directory path (parent of the helper script)
    const tempDir = join(helperPath, '..');

    // Remove the entire temporary directory and its contents
    await rm(tempDir, { recursive: true, force: true });
  } catch (error) {
    // Log cleanup errors but don't throw to avoid masking original errors
    // In a production environment, you might want to use a proper logging system
    console.error('Failed to cleanup git askpass helper:', error);
  }
}

/**
 * Creates a process environment with git credentials configured via GIT_ASKPASS.
 *
 * This function merges the current process environment with git-specific variables:
 * - GIT_ASKPASS: Points to the helper script
 * - GITHUB_TOKEN: Set for GitHub authentication (optional, for compatibility)
 *
 * The returned environment can be passed to child processes running git commands.
 *
 * @param token - The authentication token
 * @param helperPath - Path to the GIT_ASKPASS helper script
 * @returns Environment object suitable for passing to child_process methods
 *
 * @example
 * const helperPath = await createGitAskpassHelper(token);
 * const env = getGitEnvWithCredentials(token, helperPath);
 * await execFile('git', ['clone', 'https://github.com/user/repo.git'], { env });
 */
export function getGitEnvWithCredentials(
  token: string,
  helperPath: string
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_ASKPASS: helperPath,
    // Also set GITHUB_TOKEN for compatibility with some tools
    GITHUB_TOKEN: token,
    // Disable git's credential helper to ensure we only use GIT_ASKPASS
    GIT_TERMINAL_PROMPT: '0'
  };
}

/**
 * High-level helper that wraps a git operation with proper credential setup and cleanup.
 *
 * This function handles the entire lifecycle:
 * 1. Creates the GIT_ASKPASS helper
 * 2. Executes the provided operation with configured environment
 * 3. Ensures cleanup happens even if the operation fails
 *
 * @param token - The authentication token
 * @param operation - Async function that performs the git operation
 * @returns The result of the operation
 * @throws Any error from the operation (after cleanup)
 *
 * @example
 * await withGitCredentials(token, async (env) => {
 *   await execFile('git', ['clone', repoUrl], { env });
 * });
 */
export async function withGitCredentials<T>(
  token: string,
  operation: (env: NodeJS.ProcessEnv) => Promise<T>
): Promise<T> {
  const helperPath = await createGitAskpassHelper(token);

  try {
    const env = getGitEnvWithCredentials(token, helperPath);
    return await operation(env);
  } finally {
    await cleanupGitAskpassHelper(helperPath);
  }
}
