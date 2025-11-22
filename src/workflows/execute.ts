import { loadCredentials, isExpired, isTokenExpired, loadGitCredentials } from '../credentials.js';
import { executeClaude } from '../claude-sdk.js';
import { ApiClient } from '../api-client.js';
import { prepareRepositoryWorkspace } from '../repository-manager.js';
import {
  CloneError,
  UpdateError,
  PermissionError,
  InsufficientDiskSpaceError,
  NetworkError,
  isWorkspaceError,
  type WorkspaceError,
} from '../services/workspace/errors.js';

const API_BASE_URL = 'https://www.contextgraph.dev';

export async function runExecute(actionId: string): Promise<void> {
  const credentials = await loadCredentials();

  if (!credentials) {
    console.error('❌ Not authenticated. Run authentication first.');
    process.exit(1);
  }

  if (isExpired(credentials) || isTokenExpired(credentials.clerkToken)) {
    console.error('❌ Token expired. Re-authenticate to continue.');
    process.exit(1);
  }

  // Initialize API client
  const apiClient = new ApiClient();

  // Fetch complete action metadata including repository context
  console.log(`Fetching action details for ${actionId}...`);
  const action = await apiClient.getActionDetail(actionId);

  // Extract repository context for workspace preparation
  const repositoryUrl = action.resolved_repository_url || action.repository_url;
  const branch = action.resolved_branch || action.branch;

  // Prepare workspace with repository context and comprehensive error handling
  const gitCredentials = await loadGitCredentials();
  let workspacePath: string;
  let cleanup: () => Promise<void>;

  try {
    const result = await prepareRepositoryWorkspace(
      repositoryUrl ?? undefined,
      branch ?? undefined,
      gitCredentials || undefined
    );
    workspacePath = result.workspacePath;
    cleanup = result.cleanup;
  } catch (error) {
    handleRepositoryError(error, repositoryUrl, branch ?? undefined, gitCredentials);
    // handleRepositoryError will exit, but TypeScript needs this for type safety
    throw error;
  }

  console.log(`Working directory: ${workspacePath}`);

  console.log(`Fetching execution instructions for action ${actionId}...\n`);

  const response = await fetch(
    `${API_BASE_URL}/api/prompts/execute`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credentials.clerkToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ actionId }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch execute prompt: ${response.statusText}\n${errorText}`);
  }

  const { prompt } = (await response.json()) as { prompt: string };

  console.log(`Spawning Claude for execution...\n`);

  try {
    const claudeResult = await executeClaude({
      prompt,
      cwd: workspacePath,
      gitCredentials: gitCredentials || undefined,
    });

    if (claudeResult.exitCode !== 0) {
      console.error(`\n❌ Claude execution failed with exit code ${claudeResult.exitCode}`);
      process.exit(1);
    }

    console.log('\n✅ Execution complete');
  } finally {
    await cleanup();
  }
}

/**
 * Handles repository preparation errors with actionable error messages.
 *
 * Categorizes errors and provides user-friendly guidance for resolution.
 * Always exits the process after logging the error.
 *
 * @param error - The caught error
 * @param repositoryUrl - Repository URL being accessed
 * @param branch - Branch being checked out (if any)
 * @param gitCredentials - Git credentials being used (if any)
 */
function handleRepositoryError(
  error: unknown,
  repositoryUrl: string | null | undefined,
  branch: string | undefined,
  gitCredentials: Awaited<ReturnType<typeof loadGitCredentials>>
): never {
  console.error('\n❌ Failed to prepare repository workspace\n');

  // Handle workspace-specific errors with structured messages
  if (isWorkspaceError(error)) {
    const workspaceError = error as WorkspaceError;

    if (error instanceof CloneError) {
      handleCloneError(error, repositoryUrl, gitCredentials);
    } else if (error instanceof UpdateError) {
      console.error('Repository Update Error:');
      console.error(`  ${error.message}`);
      console.error(`\n💡 ${error.suggestion}`);
    } else if (error instanceof PermissionError) {
      console.error('Permission Error:');
      console.error(`  ${error.message}`);
      console.error(`\n💡 ${error.suggestion}`);
      console.error(`\nCheck that you have write access to the workspace directory:`);
      console.error(`  ${error.path}`);
    } else if (error instanceof InsufficientDiskSpaceError) {
      console.error('Disk Space Error:');
      console.error(`  ${error.message}`);
      console.error(`\n💡 ${error.suggestion}`);
      console.error(`\nTry cleaning old workspaces:`);
      console.error(`  rm -rf ~/.contextgraph/workspaces/*`);
    } else if (error instanceof NetworkError) {
      console.error('Network Error:');
      console.error(`  ${error.message}`);
      console.error(`\n💡 ${error.suggestion}`);
      console.error(`\nCheck your internet connection and try again.`);
    } else {
      // Generic workspace error
      console.error('Workspace Error:');
      console.error(`  ${workspaceError.message}`);
      console.error(`\n💡 ${workspaceError.suggestion}`);
    }
  } else {
    // Non-workspace error - try to categorize based on message
    const errorMessage = error instanceof Error ? error.message : String(error);
    const lowerMessage = errorMessage.toLowerCase();

    if (lowerMessage.includes('authentication') || lowerMessage.includes('credential')) {
      console.error('Git Authentication Failed:');
      console.error(`  ${errorMessage}`);
      console.error(`\n💡 Configure git credentials to access this repository:`);
      console.error(`  npx contextgraph auth:git`);
    } else if (lowerMessage.includes('not found') || lowerMessage.includes('404')) {
      console.error('Repository Not Found:');
      console.error(`  ${errorMessage}`);
      console.error(`\n💡 Verify the repository URL is correct:`);
      console.error(`  ${repositoryUrl || '(no URL provided)'}`);
    } else if (lowerMessage.includes('branch')) {
      console.error('Branch Error:');
      console.error(`  ${errorMessage}`);
      console.error(`\n💡 The branch '${branch || 'default'}' does not exist in the repository.`);
      console.error(`  Check available branches or create it first.`);
    } else if (lowerMessage.includes('network') || lowerMessage.includes('timeout') || lowerMessage.includes('enotfound')) {
      console.error('Network Error:');
      console.error(`  ${errorMessage}`);
      console.error(`\n💡 Check your internet connection and firewall settings.`);
      console.error(`  Ensure you can access: ${repositoryUrl || '(no URL provided)'}`);
    } else if (lowerMessage.includes('permission') || lowerMessage.includes('eacces')) {
      console.error('Permission Denied:');
      console.error(`  ${errorMessage}`);
      console.error(`\n💡 Check filesystem permissions in the workspace directory.`);
    } else {
      // Generic error
      console.error('Unexpected Error:');
      console.error(`  ${errorMessage}`);
      console.error(`\n💡 If this persists, please report the issue with details above.`);
    }
  }

  console.error('');
  process.exit(1);
}

/**
 * Handles clone-specific errors with detailed diagnostics.
 */
function handleCloneError(
  error: CloneError,
  repositoryUrl: string | null | undefined,
  gitCredentials: Awaited<ReturnType<typeof loadGitCredentials>>
): void {
  console.error('Repository Clone Error:');
  console.error(`  ${error.message}`);

  const errorMessage = error.message.toLowerCase();

  // Diagnose specific clone failure reasons
  if (errorMessage.includes('authentication') || errorMessage.includes('credential')) {
    console.error(`\n💡 Git authentication failed.`);
    if (!gitCredentials) {
      console.error(`  No credentials configured. Run:`);
      console.error(`  npx contextgraph auth:git`);
    } else {
      console.error(`  Credentials may be invalid or expired. Re-authenticate:`);
      console.error(`  npx contextgraph auth:git`);
    }
  } else if (errorMessage.includes('not found') || errorMessage.includes('404')) {
    console.error(`\n💡 Repository not found: ${repositoryUrl || '(no URL provided)'}`);
    console.error(`  - Verify the URL is correct`);
    console.error(`  - Check if the repository exists`);
    console.error(`  - Ensure you have access to the repository`);
  } else if (errorMessage.includes('permission') || errorMessage.includes('403')) {
    console.error(`\n💡 Permission denied to access this repository.`);
    if (!gitCredentials) {
      console.error(`  You may need authentication for private repositories:`);
      console.error(`  npx contextgraph auth:git`);
    } else {
      console.error(`  Your account may not have access to this repository.`);
      console.error(`  - Verify repository permissions`);
      console.error(`  - Check if you're using the correct account`);
    }
  } else if (errorMessage.includes('network') || errorMessage.includes('timeout') || errorMessage.includes('enotfound')) {
    console.error(`\n💡 Network connection failed.`);
    console.error(`  - Check your internet connection`);
    console.error(`  - Verify firewall settings`);
    console.error(`  - Ensure DNS resolution works for: ${repositoryUrl || '(no URL provided)'}`);
  } else {
    console.error(`\n💡 ${error.suggestion}`);
  }
}

