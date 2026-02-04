import { spawn } from 'child_process';

export const PLUGIN_REPO = 'https://github.com/contextgraph/claude-code-plugin';
const MARKETPLACE_SOURCE = 'contextgraph/claude-code-plugin';
const MARKETPLACE_NAME = 'contextgraph';
const PLUGIN_NAME = 'contextgraph';

/**
 * Run a command and capture stdout + exit code.
 */
function runCommand(command: string, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ stdout, exitCode: code ?? 1 });
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn ${command}: ${err.message}`));
    });
  });
}

/**
 * Check if Claude Code CLI is available
 */
export async function isClaudeCodeAvailable(): Promise<boolean> {
  try {
    const { exitCode } = await runCommand('claude', ['--version']);
    return exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Check if the ContextGraph marketplace is configured in Claude Code
 */
async function isMarketplaceConfigured(): Promise<boolean> {
  try {
    const { stdout, exitCode } = await runCommand('claude', ['plugin', 'marketplace', 'list']);
    return exitCode === 0 && stdout.includes(MARKETPLACE_NAME);
  } catch {
    return false;
  }
}

/**
 * Add the ContextGraph marketplace to Claude Code
 */
async function addMarketplace(): Promise<void> {
  console.log('Adding ContextGraph marketplace...');
  const { exitCode } = await runCommand('claude', ['plugin', 'marketplace', 'add', MARKETPLACE_SOURCE]);

  if (exitCode !== 0) {
    throw new Error(`Failed to add marketplace (exit code ${exitCode})`);
  }
}

/**
 * Check if the ContextGraph plugin is already installed in Claude Code
 */
export async function isPluginInstalled(): Promise<boolean> {
  try {
    const { stdout, exitCode } = await runCommand('claude', ['plugin', 'list']);
    return exitCode === 0 && stdout.includes(PLUGIN_NAME);
  } catch {
    return false;
  }
}

/**
 * Ensure the ContextGraph plugin is installed in Claude Code.
 * Adds the marketplace if needed, then installs the plugin if not already present.
 */
export async function ensurePluginInstalled(): Promise<void> {
  if (await isPluginInstalled()) {
    return;
  }

  // Ensure marketplace is configured before attempting install
  if (!await isMarketplaceConfigured()) {
    await addMarketplace();
  }

  console.log('Installing ContextGraph plugin for Claude Code...');
  const { exitCode } = await runCommand('claude', ['plugin', 'install', PLUGIN_NAME]);

  if (exitCode !== 0) {
    throw new Error(`Failed to install plugin (exit code ${exitCode})`);
  }

  console.log('ContextGraph plugin installed (includes MCP server)');
}
