import { spawn } from 'child_process';

export const PLUGIN_REPO = 'https://github.com/contextgraph/claude-code-plugin';
// `claude plugin marketplace add` takes the GitHub source shorthand. We detect
// an existing registration by this source rather than by the marketplace's
// display name: the display name has drifted across releases
// ('contextgraph-marketplace' on older installs, 'steward-marketplace' in the
// current manifest), but the source repo is stable.
const MARKETPLACE_SOURCE = 'contextgraph/claude-code-plugin';
// The plugin name as declared in the plugin manifest. This is the token
// `claude plugin install <plugin>` resolves and the token `claude plugin list`
// prints before the `@<marketplace>` suffix. It must match the manifest name,
// not the legacy 'contextgraph' brand.
const PLUGIN_NAME = 'steward';

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
 * Parse the output of `claude plugin list` into the set of installed plugin
 * names. Each entry is rendered as `<plugin>@<marketplace>` (optionally behind
 * a selection marker such as `❯ `); we key on the `<plugin>` token before the
 * `@` so detection can never false-positive on a marketplace-name substring
 * (e.g. an unrelated plugin in a marketplace whose name contains 'steward').
 */
export function parseInstalledPluginNames(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.replace(/^[^A-Za-z0-9@]+/, '').trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const atIndex = line.indexOf('@');
      return (atIndex >= 0 ? line.slice(0, atIndex) : line).trim();
    })
    .filter((name) => name.length > 0);
}

/**
 * Check if the Steward marketplace is configured in Claude Code.
 * Matches on the GitHub source rather than the display name, which has drifted.
 */
async function isMarketplaceConfigured(): Promise<boolean> {
  try {
    const { stdout, exitCode } = await runCommand('claude', ['plugin', 'marketplace', 'list']);
    return exitCode === 0 && stdout.includes(MARKETPLACE_SOURCE);
  } catch {
    return false;
  }
}

/**
 * Add the Steward marketplace to Claude Code
 */
async function addMarketplace(): Promise<void> {
  console.log('Adding Steward marketplace...');
  const { exitCode } = await runCommand('claude', ['plugin', 'marketplace', 'add', MARKETPLACE_SOURCE]);

  if (exitCode !== 0) {
    throw new Error(`Failed to add marketplace (exit code ${exitCode})`);
  }
}

/**
 * Check if the Steward plugin is already installed in Claude Code
 */
export async function isPluginInstalled(): Promise<boolean> {
  try {
    const { stdout, exitCode } = await runCommand('claude', ['plugin', 'list']);
    return exitCode === 0 && parseInstalledPluginNames(stdout).includes(PLUGIN_NAME);
  } catch {
    return false;
  }
}

/**
 * Ensure the Steward plugin is installed in Claude Code.
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

  console.log('Installing Steward plugin for Claude Code...');
  const { exitCode } = await runCommand('claude', ['plugin', 'install', PLUGIN_NAME]);

  if (exitCode !== 0) {
    throw new Error(`Failed to install plugin (exit code ${exitCode})`);
  }

  console.log('Steward plugin installed (includes MCP server)');
}
