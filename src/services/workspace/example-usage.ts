/**
 * Example usage patterns for the temporary workspace system.
 *
 * These examples demonstrate how to use the temporary workspace pattern
 * in various scenarios, from simple file operations to authenticated
 * git operations with proper cleanup.
 */

import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import {
  createTempWorkspace,
  createTempWorkspaceWithClone,
  withTempWorkspace,
  withTempWorkspaceClone
} from './temporary-workspace.js';
import { withGitCredentials } from '../../git-auth-helper.js';

/**
 * Example 1: Basic workspace creation and cleanup
 *
 * Shows the fundamental pattern of creating a workspace,
 * using it, and ensuring cleanup happens.
 */
export async function example1_BasicWorkspace() {
  const workspace = await createTempWorkspace();
  console.log('Created workspace at:', workspace.path);

  try {
    // Perform operations in the workspace
    const files = await readdir(workspace.path);
    console.log('Files:', files);
  } finally {
    // Always cleanup, even if operations fail
    await workspace.cleanup();
    console.log('Workspace cleaned up');
  }
}

/**
 * Example 2: Clone a public repository
 *
 * Demonstrates cloning a public repository into a temporary workspace.
 * No authentication required for public repositories.
 */
export async function example2_ClonePublicRepo() {
  const workspace = await createTempWorkspaceWithClone({
    repositoryUrl: 'https://github.com/contextgraph/agent.git'
  });

  try {
    // Read package.json from the cloned repository
    const packageJsonPath = join(workspace.path, 'package.json');
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));
    console.log('Repository name:', packageJson.name);
    console.log('Version:', packageJson.version);
  } finally {
    await workspace.cleanup();
  }
}

/**
 * Example 3: Clone a specific branch
 *
 * Shows how to clone a specific branch instead of the default branch.
 */
export async function example3_CloneSpecificBranch() {
  const workspace = await createTempWorkspaceWithClone({
    repositoryUrl: 'https://github.com/contextgraph/agent.git',
    branch: 'main'
  });

  try {
    // Work with the specific branch
    const files = await readdir(workspace.path);
    console.log('Files in main branch:', files);
  } finally {
    await workspace.cleanup();
  }
}

/**
 * Example 4: Clone a private repository with authentication
 *
 * Demonstrates using git credentials to clone a private repository.
 * Uses the withGitCredentials helper for secure authentication.
 */
export async function example4_ClonePrivateRepo(token: string) {
  await withGitCredentials(token, async (gitEnv) => {
    const workspace = await createTempWorkspaceWithClone({
      repositoryUrl: 'https://github.com/user/private-repo.git',
      gitEnv
    });

    try {
      // Work with the private repository
      const files = await readdir(workspace.path);
      console.log('Cloned private repository, files:', files);
    } finally {
      await workspace.cleanup();
    }
  });
}

/**
 * Example 5: Using the high-level withTempWorkspace helper
 *
 * Shows the simplest pattern using the helper that manages
 * workspace lifecycle automatically.
 */
export async function example5_WithHelper() {
  const fileCount = await withTempWorkspace(async (workspacePath) => {
    // Operations are scoped to this function
    const files = await readdir(workspacePath);
    return files.length;
  });

  console.log('File count:', fileCount);
  // Workspace is automatically cleaned up
}

/**
 * Example 6: Using withTempWorkspaceClone for one-off operations
 *
 * Demonstrates the highest-level helper for clone-and-execute operations.
 * Perfect for analyzing repositories without persistent storage.
 */
export async function example6_CloneAndExecute() {
  const packageJson = await withTempWorkspaceClone(
    {
      repositoryUrl: 'https://github.com/contextgraph/agent.git'
    },
    async (workspacePath) => {
      // Clone happens automatically before this executes
      const content = await readFile(
        join(workspacePath, 'package.json'),
        'utf-8'
      );
      return JSON.parse(content);
    }
  );
  // Cleanup happens automatically after the operation

  console.log('Repository:', packageJson.name);
}

/**
 * Example 7: Error handling with guaranteed cleanup
 *
 * Shows that cleanup happens even when operations fail.
 * The workspace helper uses try/finally internally.
 */
export async function example7_ErrorHandling() {
  try {
    await withTempWorkspace(async (workspacePath) => {
      console.log('Working in:', workspacePath);
      // Simulate an error
      throw new Error('Something went wrong!');
    });
  } catch (error) {
    console.log('Caught error:', error);
    // Workspace is still cleaned up despite the error
  }
}

/**
 * Example 8: Agent workflow integration
 *
 * Complete example showing how an agent might use temporary workspaces
 * to execute actions in a repository context.
 */
export async function example8_AgentWorkflow(
  token: string,
  repositoryUrl: string,
  actionDescription: string
) {
  console.log('Executing action:', actionDescription);

  await withGitCredentials(token, async (gitEnv) => {
    const result = await withTempWorkspaceClone(
      {
        repositoryUrl,
        gitEnv
      },
      async (workspacePath) => {
        console.log('Repository cloned to:', workspacePath);

        // Agent can now:
        // 1. Read files to understand context
        const packageJsonPath = join(workspacePath, 'package.json');
        const packageJson = JSON.parse(
          await readFile(packageJsonPath, 'utf-8')
        );

        // 2. Analyze the codebase
        const srcFiles = await readdir(join(workspacePath, 'src'));
        console.log('Source files:', srcFiles);

        // 3. Execute operations (build, test, etc.)
        // Note: In real implementation, would use execFile for git/npm commands

        // 4. Return results
        return {
          repository: packageJson.name,
          version: packageJson.version,
          fileCount: srcFiles.length
        };
      }
    );

    console.log('Action completed:', result);
    // Workspace automatically cleaned up
  });
}

/**
 * Example 9: Benchmark - measuring clone performance
 *
 * Demonstrates the performance characteristics mentioned in the spec.
 * Small repos should clone in ~1.5s.
 */
export async function example9_BenchmarkClone() {
  const startTime = Date.now();

  await withTempWorkspaceClone(
    {
      repositoryUrl: 'https://github.com/contextgraph/agent.git'
    },
    async (workspacePath) => {
      const cloneTime = Date.now() - startTime;
      console.log(`Clone completed in ${cloneTime}ms`);

      const files = await readdir(workspacePath);
      console.log(`Repository has ${files.length} top-level items`);
    }
  );

  const totalTime = Date.now() - startTime;
  console.log(`Total time (including cleanup): ${totalTime}ms`);
}

/**
 * Example 10: Multiple operations in sequence
 *
 * Shows how to perform multiple operations in the same workspace
 * before cleanup.
 */
export async function example10_MultipleOperations() {
  const results = await withTempWorkspaceClone(
    {
      repositoryUrl: 'https://github.com/contextgraph/agent.git'
    },
    async (workspacePath) => {
      // Operation 1: Read package.json
      const packageJson = JSON.parse(
        await readFile(join(workspacePath, 'package.json'), 'utf-8')
      );

      // Operation 2: List source files
      const srcFiles = await readdir(join(workspacePath, 'src'));

      // Operation 3: Check for README
      const topLevel = await readdir(workspacePath);
      const hasReadme = topLevel.includes('README.md');

      return {
        name: packageJson.name,
        sourceFileCount: srcFiles.length,
        hasReadme
      };
    }
  );

  console.log('Analysis results:', results);
}
