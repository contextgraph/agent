import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { authenticateAgent } from '../auth-flow.js';
import { isClaudeCodeAvailable, isPluginInstalled, ensurePluginInstalled } from '../plugin-setup.js';

/**
 * Main setup workflow
 */
export async function runSetup(): Promise<void> {
  console.log('\nWelcome to ContextGraph!\n');
  console.log('This setup wizard will help you get started with ContextGraph.\n');

  // Step 1: Check existing authentication
  console.log('Step 1: Checking authentication...\n');

  let needsAuth = false;
  const existingCredentials = await loadCredentials();

  if (!existingCredentials) {
    console.log('  Not authenticated yet.');
    needsAuth = true;
  } else if (isExpired(existingCredentials) || isTokenExpired(existingCredentials.clerkToken)) {
    console.log('  Your credentials have expired.');
    needsAuth = true;
  } else {
    console.log('  Already authenticated');
    console.log(`  User ID: ${existingCredentials.userId}\n`);
  }

  // Step 2: Authenticate if needed
  if (needsAuth) {
    console.log('Step 2: Authenticating with ContextGraph...\n');

    const result = await authenticateAgent();

    if (!result.success) {
      throw new Error('Authentication failed: ' + result.error);
    }

    console.log('\n  Authentication successful!');
    console.log(`  User ID: ${result.credentials.userId}\n`);
  } else {
    console.log('Step 2: Already authenticated, skipping.\n');
  }

  // Step 3: Check for Claude Code
  console.log('Step 3: Checking for Claude Code...\n');

  const hasClaudeCode = await isClaudeCodeAvailable();

  if (hasClaudeCode) {
    console.log('  Claude Code detected!\n');

    // Step 4: Install plugin (includes MCP server)
    console.log('Step 4: Installing ContextGraph plugin...\n');

    try {
      if (await isPluginInstalled()) {
        console.log('  ContextGraph plugin is already installed.\n');
      } else {
        await ensurePluginInstalled();
        console.log('');
      }
    } catch (error) {
      console.error('  Could not install plugin automatically.');
      console.error('  You can install it manually with:');
      console.error('  claude plugin marketplace add contextgraph/claude-code-plugin');
      console.error('  claude plugin install contextgraph\n');
    }

    // Show getting started instructions
    console.log('Setup complete! You\'re ready to go.\n');
    console.log('Next steps:\n');
    console.log('  1. Open Claude Code (or restart if already running)');
    console.log('  2. Ask Claude to help you plan — it has access to your action graph\n');
    console.log('  Examples:');
    console.log('    "Create an action plan for implementing user auth"');
    console.log('    "Show me my action tree"');
    console.log('    "What should I work on next?"\n');
    console.log('  Run the autonomous agent:  npx @contextgraph/agent run');
    console.log('  Web dashboard:             https://contextgraph.dev');

  } else {
    console.log('  Claude Code not detected.\n');

    // Show alternative installation options
    console.log('You have a few options:\n');
    console.log('Option 1: Install Claude Code');
    console.log('   Visit: https://claude.ai/download');
    console.log('   Then run this setup again: npx @contextgraph/agent@latest setup\n');

    console.log('Option 2: Use ContextGraph MCP server with other editors');
    console.log('   ContextGraph works with any MCP-compatible editor!\n');
    console.log('   To add the ContextGraph MCP server to your editor:');
    console.log('   - Cursor: See https://docs.cursor.com/advanced/mcp');
    console.log('   - Windsurf: See https://docs.windsurf.ai/mcp');
    console.log('   - Other: See https://modelcontextprotocol.io/clients\n');
    console.log('   MCP Server URL:');
    console.log('   https://mcp.contextgraph.dev\n');

    console.log('Option 3: Use the agent CLI directly');
    console.log('   Run autonomous agent: npx @contextgraph/agent run');
    console.log('   Execute specific action: npx @contextgraph/agent execute <action-id>');
    console.log('   Prepare an action: npx @contextgraph/agent prepare <action-id>\n');

    console.log('Authentication complete! Visit https://contextgraph.dev to get started!');
  }

  console.log('');
}
