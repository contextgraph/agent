/**
 * Example: Worker Loop with Completion Context
 *
 * This example demonstrates how a worker processes actions WITHOUT needing to
 * extract completion context from SDK responses. Claude handles completion
 * automatically via MCP tool calls.
 *
 * Action ID: d52569f4-267d-4315-b401-db3e32b90318
 */

import { loadCredentials, isExpired, isTokenExpired } from '../src/credentials.js';
import { executeClaude } from '../src/claude-sdk.js';
import type { Credentials } from '../src/types/actions.js';

const API_BASE_URL = 'https://www.contextgraph.dev';

/**
 * Fetch execution prompt for an action from the backend
 */
async function fetchExecutionPrompt(
  actionId: string,
  authToken: string
): Promise<string> {
  const response = await fetch(
    `${API_BASE_URL}/api/prompts/execute`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ actionId }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch execute prompt: ${response.statusText}\n${errorText}`);
  }

  const { prompt } = await response.json();
  return prompt;
}

/**
 * Claim a prepared action from the queue
 *
 * In the real worker loop, this would poll the backend for available work.
 * For this example, we assume an action ID is provided.
 */
async function claimAction(
  credentials: Credentials
): Promise<string | null> {
  // TODO: Implement claim endpoint call
  // For now, this is a placeholder
  console.log('🔍 Checking for available work...');
  console.log('   (In real worker: call /api/worker/claim)');
  return null;
}

/**
 * Process a single action: execute and let Claude handle completion
 *
 * This demonstrates the key insight: workers don't extract completion context.
 * Claude observes changes and calls the MCP complete tool directly.
 */
async function processAction(
  actionId: string,
  credentials: Credentials
): Promise<boolean> {
  console.log(`\n📋 Processing action: ${actionId}`);

  try {
    // Step 1: Fetch execution prompt
    console.log('📥 Fetching execution prompt...');
    const prompt = await fetchExecutionPrompt(actionId, credentials.clerkToken);

    // Step 2: Execute with SDK
    // The prompt instructs Claude to:
    // 1. Perform the work
    // 2. Observe changes (files, tests, etc.)
    // 3. Call mcp__plugin_contextgraph_actions__complete with completion context
    console.log('🤖 Spawning Claude for execution...\n');
    const result = await executeClaude({
      prompt,
      cwd: process.cwd(),
      authToken: credentials.clerkToken,  // Enables MCP authentication
    });

    // Step 3: Check result
    // Note: We only check exitCode - completion context is already sent to backend!
    if (result.exitCode !== 0) {
      console.error('\n❌ Execution failed');
      console.error('   Action remains claimed and can be retried');
      return false;
    }

    console.log('\n✅ Execution succeeded');
    console.log('   Claude has already called MCP complete tool');
    console.log('   Action is now marked done, claim is cleared');

    // Log execution metadata (for monitoring/debugging)
    if (result.sessionId) {
      console.log(`   Session ID: ${result.sessionId}`);
    }
    if (result.cost) {
      console.log(`   Cost: $${result.cost.toFixed(4)}`);
    }
    if (result.usage) {
      console.log(`   Tokens: ${result.usage.input_tokens} in, ${result.usage.output_tokens} out`);
    }

    return true;

  } catch (error) {
    console.error('\n💥 Error processing action:', (error as Error).message);
    console.error('   Action remains claimed and can be retried');
    return false;
  }
}

/**
 * Main worker loop (simplified for demonstration)
 *
 * The real worker would:
 * 1. Poll continuously for work
 * 2. Implement backoff when no work available
 * 3. Handle graceful shutdown (Ctrl+C)
 * 4. Track worker health metrics
 */
async function workerLoop() {
  console.log('🚀 Worker starting...\n');

  // Load credentials
  const credentials = await loadCredentials();
  if (!credentials) {
    console.error('❌ Not authenticated. Run authentication first.');
    process.exit(1);
  }

  if (isExpired(credentials) || isTokenExpired(credentials.clerkToken)) {
    console.error('❌ Token expired. Re-authenticate to continue.');
    process.exit(1);
  }

  console.log('✅ Authenticated');
  console.log(`   User ID: ${credentials.userId}`);

  // Main loop
  while (true) {
    // Claim next action
    const actionId = await claimAction(credentials);

    if (!actionId) {
      // No work available - implement backoff
      console.log('⏸️  No work available, sleeping...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      continue;
    }

    // Process the action
    // Completion happens automatically via MCP tool - no extraction needed!
    await processAction(actionId, credentials);

    // Continue to next action
  }
}

/**
 * Example: What NOT to do
 *
 * This shows the WRONG approach - trying to extract completion context from
 * SDK responses. This is not needed because Claude sends it via MCP tool.
 */
async function wrongApproach(actionId: string, credentials: Credentials) {
  const prompt = await fetchExecutionPrompt(actionId, credentials.clerkToken);
  const result = await executeClaude({
    prompt,
    cwd: process.cwd(),
    authToken: credentials.clerkToken,
  });

  // ❌ WRONG: Trying to extract completion context from result
  // The result only contains: exitCode, sessionId, usage, cost
  // Completion context is NOT in the SDK response!
  const completionContext = {
    // ❌ This doesn't exist in result
    technical_changes: (result as any).technical_changes,  // undefined
    outcomes: (result as any).outcomes,                     // undefined
    challenges: (result as any).challenges,                 // undefined
  };

  // ❌ WRONG: Trying to call complete manually
  // Claude already called it via MCP tool during execution!
  // await callCompleteAPI(actionId, completionContext);
}

/**
 * Example: What TO do
 *
 * This shows the CORRECT approach - just check exitCode.
 * Claude handles completion automatically.
 */
async function correctApproach(actionId: string, credentials: Credentials) {
  const prompt = await fetchExecutionPrompt(actionId, credentials.clerkToken);
  const result = await executeClaude({
    prompt,
    cwd: process.cwd(),
    authToken: credentials.clerkToken,
  });

  // ✅ CORRECT: Just check if execution succeeded
  if (result.exitCode !== 0) {
    console.error('Execution failed');
    return;
  }

  // ✅ That's it! Claude already:
  // 1. Performed the work
  // 2. Observed changes
  // 3. Called mcp__plugin_contextgraph_actions__complete
  // 4. Action is marked done, claim is cleared

  console.log('Execution complete');
}

// Export for testing
export {
  fetchExecutionPrompt,
  claimAction,
  processAction,
  workerLoop,
  correctApproach,
  wrongApproach,
};

// If run directly, show usage
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('This is an example file demonstrating completion context handling.');
  console.log('Key takeaway: Workers do NOT extract completion context from SDK responses.');
  console.log('Claude sends completion context directly to backend via MCP tool.');
  console.log('\nSee docs/COMPLETION_CONTEXT_EXTRACTION.md for full documentation.');
}
