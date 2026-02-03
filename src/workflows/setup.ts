import { execSync } from 'child_process';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { authenticateAgent } from '../auth-flow.js';
import { ensurePlugin } from '../plugin-setup.js';

/**
 * Check if Claude Code CLI is available
 */
function isClaudeCodeAvailable(): boolean {
  try {
    // Check if 'claude' command exists
    execSync('which claude', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Add ContextGraph MCP server to Claude Code
 */
async function addMcpServer(): Promise<void> {
  try {
    console.log('📦 Adding ContextGraph MCP server to Claude Code...');

    // Use claude mcp add command to register the server
    // The ContextGraph MCP server is hosted at mcp.contextgraph.dev
    execSync(
      'claude mcp add contextgraph --transport http https://mcp.contextgraph.dev',
      { stdio: 'inherit' }
    );

    console.log('✅ ContextGraph MCP server added to Claude Code');
  } catch (error) {
    console.error('❌ Failed to add MCP server:', error instanceof Error ? error.message : error);
    throw error;
  }
}

/**
 * Main setup workflow
 */
export async function runSetup(): Promise<void> {
  console.log('\n🎉 Welcome to ContextGraph!\n');
  console.log('This setup wizard will help you get started with ContextGraph.\n');

  // Step 1: Check existing authentication
  console.log('📋 Step 1: Checking authentication...\n');

  let needsAuth = false;
  const existingCredentials = await loadCredentials();

  if (!existingCredentials) {
    console.log('⚠️  Not authenticated yet.');
    needsAuth = true;
  } else if (isExpired(existingCredentials) || isTokenExpired(existingCredentials.clerkToken)) {
    console.log('⚠️  Your credentials have expired.');
    needsAuth = true;
  } else {
    console.log('✅ Already authenticated');
    console.log(`   User ID: ${existingCredentials.userId}\n`);
  }

  // Step 2: Authenticate if needed
  if (needsAuth) {
    console.log('📋 Step 2: Authenticating with ContextGraph...\n');

    const result = await authenticateAgent();

    if (!result.success) {
      console.error('\n❌ Authentication failed:', result.error);
      console.error('   Please try again or visit https://contextgraph.dev for help.');
      process.exit(1);
    }

    console.log('\n✅ Authentication successful!');
    console.log(`   User ID: ${result.credentials.userId}\n`);
  }

  // Step 3: Check for Claude Code
  console.log('📋 Step 3: Checking for Claude Code...\n');

  const hasClaudeCode = isClaudeCodeAvailable();

  if (hasClaudeCode) {
    console.log('✅ Claude Code detected!\n');

    // Step 4a: Install plugin
    console.log('📋 Step 4: Setting up ContextGraph plugin...\n');

    try {
      await ensurePlugin();
      console.log('');
    } catch (error) {
      console.error('❌ Failed to set up plugin:', error instanceof Error ? error.message : error);
      console.error('   You can try again later or visit https://contextgraph.dev for help.\n');
    }

    // Step 5a: Add MCP server
    console.log('📋 Step 5: Configuring MCP server...\n');

    try {
      await addMcpServer();
      console.log('');
    } catch (error) {
      console.error('⚠️  Could not add MCP server automatically.');
      console.error('   You can add it manually with:');
      console.error('   claude mcp add contextgraph --transport http https://mcp.contextgraph.dev\n');
    }

    // Step 6a: Show getting started instructions
    console.log('🎊 Setup complete! Here\'s how to get started:\n');
    console.log('1. Open Claude Code or restart if already running');
    console.log('2. Start a conversation and try these commands:');
    console.log('   • "@contextgraph help" - Learn about available commands');
    console.log('   • "@contextgraph search <query>" - Find actions in your graph');
    console.log('   • "@contextgraph create" - Create a new action\n');
    console.log('You can also run the autonomous agent to execute actions:');
    console.log('   npx @contextgraph/agent run\n');
    console.log('Visit https://contextgraph.dev to manage your action graph!');

  } else {
    console.log('⚠️  Claude Code not detected.\n');

    // Show alternative installation options
    console.log('📖 You have a few options:\n');
    console.log('Option 1: Install Claude Code');
    console.log('   Visit: https://claude.ai/download');
    console.log('   Then run this setup again: npx @contextgraph/agent@latest setup\n');

    console.log('Option 2: Use ContextGraph MCP server with other editors');
    console.log('   ContextGraph works with any MCP-compatible editor!\n');
    console.log('   To add the ContextGraph MCP server to your editor:');
    console.log('   • Cursor: See https://docs.cursor.com/advanced/mcp');
    console.log('   • Windsurf: See https://docs.windsurf.ai/mcp');
    console.log('   • Other: See https://modelcontextprotocol.io/clients\n');
    console.log('   MCP Server URL:');
    console.log('   https://mcp.contextgraph.dev\n');

    console.log('Option 3: Use the agent CLI directly');
    console.log('   Run autonomous agent: npx @contextgraph/agent run');
    console.log('   Execute specific action: npx @contextgraph/agent execute <action-id>');
    console.log('   Prepare an action: npx @contextgraph/agent prepare <action-id>\n');

    console.log('🎊 Authentication complete! Visit https://contextgraph.dev to get started!');
  }

  console.log('');
}
