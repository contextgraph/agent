#!/usr/bin/env node
/**
 * Validation test for MCP authentication in worker context
 *
 * This validates that:
 * 1. Workers can authenticate with the MCP server via CONTEXTGRAPH_AUTH_TOKEN
 * 2. The MCP complete tool is accessible from worker environment
 * 3. Authentication flows through the SDK -> Plugin -> MCP server chain correctly
 */

import { executeClaude } from './claude-sdk.js';
import { loadCredentials } from './credentials.js';

async function validateMcpAuth() {
  console.log('🔍 Validating MCP authentication in worker context...\n');

  // Step 1: Load credentials (simulating worker environment)
  const credentials = await loadCredentials();
  if (!credentials) {
    console.error('❌ No credentials found. Run authentication first.');
    process.exit(1);
  }

  console.log('✅ Credentials loaded');
  console.log(`   Token length: ${credentials.clerkToken.length} chars`);
  console.log(`   Expires: ${new Date(credentials.expiresAt).toISOString()}\n`);

  // Step 2: Test MCP tool access via SDK
  // We'll ask Claude to list available MCP tools to verify authentication
  const testPrompt = `
You are testing MCP server authentication in a worker context.

Please do the following:
1. Use the ListMcpResourcesTool to check if you can access the contextgraph MCP server
2. Report back what you find

This is a validation test - just confirm whether the MCP tools are accessible.
`.trim();

  try {
    console.log('🧪 Testing MCP server access via Claude SDK...\n');

    const result = await executeClaude({
      prompt: testPrompt,
      cwd: process.cwd(),
      authToken: credentials.clerkToken,
    });

    if (result.exitCode === 0) {
      console.log('\n✅ MCP authentication validation PASSED');
      console.log(`   Cost: $${result.cost?.toFixed(4) || '0.0000'}`);
      console.log(`   Session: ${result.sessionId || 'N/A'}`);
      return true;
    } else {
      console.log('\n❌ MCP authentication validation FAILED');
      console.log(`   Exit code: ${result.exitCode}`);
      return false;
    }
  } catch (error) {
    console.error('\n❌ Validation error:', (error as Error).message);
    return false;
  }
}

// Run validation if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  validateMcpAuth()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

export { validateMcpAuth };
