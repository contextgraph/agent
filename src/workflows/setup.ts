import chalk from 'chalk';
import { Listr } from 'listr2';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { authenticateAgent } from '../auth-flow.js';
import { isClaudeCodeAvailable, isPluginInstalled, ensurePluginInstalled } from '../plugin-setup.js';

interface SetupCtx {
  needsAuth: boolean;
  userId: string | null;
  displayName: string | null;
  hasClaudeCode: boolean;
  pluginInstalled: boolean;
}

/**
 * Main setup workflow
 */
export async function runSetup(): Promise<void> {
  console.log(`\n${chalk.bold('Welcome to ContextGraph!')}`);
  console.log('This setup wizard will help you get started.\n');

  const tasks = new Listr<SetupCtx>(
    [
      {
        title: 'Checking authentication',
        task: async (ctx, task) => {
          const creds = await loadCredentials();
          if (!creds) {
            ctx.needsAuth = true;
          } else if (isExpired(creds) || isTokenExpired(creds.clerkToken)) {
            ctx.needsAuth = true;
          } else {
            ctx.needsAuth = false;
            ctx.userId = creds.userId;
            ctx.displayName = creds.email ?? creds.userId;
            task.title = `Checking authentication — logged in as ${chalk.cyan(ctx.displayName)}`;
          }
        },
      },
      {
        title: 'Authenticating with ContextGraph',
        skip: (ctx) => !ctx.needsAuth ? 'Already authenticated' : false,
        task: async (ctx, task) => {
          task.output = 'Waiting for browser...';
          const result = await authenticateAgent();
          if (!result.success) {
            throw new Error('Authentication failed: ' + result.error);
          }
          ctx.userId = result.credentials.userId;
          ctx.displayName = result.credentials.email ?? result.credentials.userId;
          task.title = `Authenticated as ${chalk.cyan(ctx.displayName)}`;
        },
        options: { bottomBar: Infinity },
      },
      {
        title: 'Checking for Claude Code',
        task: async (ctx, task) => {
          ctx.hasClaudeCode = await isClaudeCodeAvailable();
          task.title = ctx.hasClaudeCode
            ? 'Checking for Claude Code — detected'
            : 'Checking for Claude Code — not found';
        },
      },
      {
        title: 'Installing ContextGraph plugin',
        skip: (ctx) => !ctx.hasClaudeCode ? 'Claude Code not detected' : false,
        task: async (ctx, task) => {
          try {
            if (await isPluginInstalled()) {
              ctx.pluginInstalled = true;
              task.title = 'ContextGraph plugin already installed';
            } else {
              await ensurePluginInstalled();
              ctx.pluginInstalled = true;
              task.title = 'ContextGraph plugin installed';
            }
          } catch {
            ctx.pluginInstalled = false;
            task.skip('Could not install automatically — see manual instructions below');
          }
        },
      },
    ],
    {
      ctx: { needsAuth: false, userId: null, displayName: null, hasClaudeCode: false, pluginInstalled: false },
      rendererOptions: { collapseErrors: false },
    }
  );

  const ctx = await tasks.run();

  // Post-task output
  console.log('');

  if (ctx.hasClaudeCode) {
    if (!ctx.pluginInstalled) {
      console.log(chalk.yellow('Plugin could not be installed automatically.'));
      console.log('You can install it manually with:\n');
      console.log(`  ${chalk.dim('$')} claude plugin marketplace add contextgraph/claude-code-plugin`);
      console.log(`  ${chalk.dim('$')} claude plugin install contextgraph\n`);
    }

    console.log(chalk.bold.green('Setup complete!') + ' You\'re ready to go.\n');
    console.log(`There are three ways to work with ContextGraph:\n`);

    console.log(chalk.bold('1. Run the ContextGraph agent'));
    console.log('   Wraps Claude Code and automatically prepares and executes');
    console.log('   actions for you in your codebase.\n');
    console.log(`   ${chalk.cyan('npx @contextgraph/agent run')}\n`);

    console.log(chalk.bold('2. Use ContextGraph directly via Claude Code'));
    console.log('   Open Claude Code (or restart if already running) and interact');
    console.log('   with your action graph through the MCP tools.\n');
    console.log(chalk.dim('   Examples:'));
    console.log(chalk.dim('     "Create an action plan for implementing user auth"'));
    console.log(chalk.dim('     "Show me my action tree"'));
    console.log(chalk.dim('     "What should I work on next?"'));
    console.log(chalk.dim('     "Capture this discussion as an action with sub-tasks"'));
    console.log('');

    console.log(chalk.bold('3. Integrate the MCP server into other platforms'));
    console.log('   Add the ContextGraph MCP server to any compatible tool.\n');
    console.log(`   MCP Server URL: ${chalk.cyan('https://mcp.contextgraph.dev')}\n`);
    console.log(chalk.dim('   Works with: Cursor, Claude.ai, ChatGPT, Codex CLI, Windsurf,'));
    console.log(chalk.dim('   and any other MCP-compatible client.'));
    console.log('');
    console.log(`  Web dashboard:  ${chalk.cyan('https://contextgraph.dev')}`);
  } else {
    console.log('You have a few options:\n');

    console.log(chalk.bold('Option 1: Install Claude Code'));
    console.log(`   Visit: ${chalk.cyan('https://claude.ai/download')}`);
    console.log(`   Then run this setup again: ${chalk.cyan('npx @contextgraph/agent@latest setup')}\n`);

    console.log(chalk.bold('Option 2: Use ContextGraph MCP server with other editors'));
    console.log('   ContextGraph works with any MCP-compatible editor!\n');
    console.log('   To add the ContextGraph MCP server to your editor:');
    console.log(`   - Cursor: See ${chalk.cyan('https://docs.cursor.com/advanced/mcp')}`);
    console.log(`   - Windsurf: See ${chalk.cyan('https://docs.windsurf.ai/mcp')}`);
    console.log(`   - Other: See ${chalk.cyan('https://modelcontextprotocol.io/clients')}\n`);
    console.log('   MCP Server URL:');
    console.log(`   ${chalk.cyan('https://mcp.contextgraph.dev')}\n`);

    console.log(chalk.bold('Option 3: Use the agent CLI directly'));
    console.log(`   Run autonomous agent: ${chalk.cyan('npx @contextgraph/agent run')}`);
    console.log(`   Execute specific action: ${chalk.cyan('npx @contextgraph/agent execute <action-id>')}`);
    console.log(`   Prepare an action: ${chalk.cyan('npx @contextgraph/agent prepare <action-id>')}\n`);

    console.log(`Authentication complete! Visit ${chalk.cyan('https://contextgraph.dev')} to get started!`);
  }

  console.log('');
}
