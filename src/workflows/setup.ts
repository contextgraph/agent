import { execSync } from 'child_process';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { authenticateAgent } from '../auth-flow.js';

const PLUGIN_REPO = 'https://github.com/contextgraph/claude-code-plugin';

/**
 * Check if Claude Code CLI is available
 */
function isClaudeCodeAvailable(): boolean {
  try {
    execSync('which claude', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the ContextGraph plugin is already installed in Claude Code
 */
function isPluginInstalled(): boolean {
  try {
    const output = execSync('claude plugin list', { stdio: 'pipe' }).toString();
    return output.includes('contextgraph');
  } catch {
    return false;
  }
}

/**
 * Install the ContextGraph plugin in Claude Code (includes MCP server)
 */
function installPlugin(): void {
  console.log('Installing ContextGraph plugin for Claude Code...');
  execSync(`claude plugin install ${PLUGIN_REPO}`, { stdio: 'inherit' });
  console.log('ContextGraph plugin installed (includes MCP server)');
}

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
  console.log('Step 2: Authenticating with ContextGraph...\n');

  if (needsAuth) {
    const result = await authenticateAgent();

    if (!result.success) {
      throw new Error('Authentication failed: ' + result.error);
    }

    console.log('\n  Authentication successful!');
    console.log(`  User ID: ${result.credentials.userId}\n`);
  } else {
    console.log('  No authentication needed, credentials are valid.\n');
  }

  // Step 3: Check for Claude Code
  console.log('Step 3: Checking for Claude Code...\n');

  const hasClaudeCode = isClaudeCodeAvailable();

  if (hasClaudeCode) {
    console.log('  Claude Code detected!\n');

    // Step 4: Install plugin (includes MCP server)
    console.log('Step 4: Installing ContextGraph plugin...\n');

    try {
      if (isPluginInstalled()) {
        console.log('  ContextGraph plugin is already installed.\n');
      } else {
        installPlugin();
        console.log('');
      }
    } catch (error) {
      console.error('  Could not install plugin automatically.');
      console.error('  You can install it manually with:');
      console.error(`  claude plugin install ${PLUGIN_REPO}\n`);
    }

    // Show getting started instructions
    console.log('Setup complete! Here\'s how to get started:\n');
    console.log('1. Open Claude Code or restart if already running');
    console.log('2. Start a conversation and try these commands:');
    console.log('   - "@contextgraph help" - Learn about available commands');
    console.log('   - "@contextgraph search <query>" - Find actions in your graph');
    console.log('   - "@contextgraph create" - Create a new action\n');
    console.log('You can also run the autonomous agent to execute actions:');
    console.log('   npx @contextgraph/agent run\n');
    console.log('Visit https://contextgraph.dev to manage your action graph!');

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
