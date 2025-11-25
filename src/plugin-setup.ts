import { spawn } from 'child_process';
import { access, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const PLUGIN_REPO = 'https://github.com/contextgraph/claude-code-plugin.git';
const PLUGIN_DIR = join(homedir(), '.contextgraph', 'claude-code-plugin');
const PLUGIN_PATH = join(PLUGIN_DIR, 'plugins', 'contextgraph');

/**
 * Get the path to the contextgraph plugin, cloning it if necessary
 */
export async function ensurePlugin(): Promise<string> {
  // Check if plugin already exists
  try {
    await access(PLUGIN_PATH);
    return PLUGIN_PATH;
  } catch {
    // Plugin path doesn't exist, check if repo dir exists
  }

  // Check if repo directory exists but plugin path is missing (incomplete clone or wrong structure)
  try {
    await access(PLUGIN_DIR);
    // Directory exists but plugin path doesn't - try pulling latest
    console.log('[Plugin Setup] Plugin directory exists but plugin not found, pulling latest...');
    await runCommand('git', ['pull'], PLUGIN_DIR);

    // Check again after pull
    try {
      await access(PLUGIN_PATH);
      return PLUGIN_PATH;
    } catch {
      throw new Error(`Plugin not found at ${PLUGIN_PATH} even after git pull. Check repository structure.`);
    }
  } catch {
    // Directory doesn't exist, need to clone
  }

  console.log('[Plugin Setup] Contextgraph plugin not found, cloning from GitHub...');

  // Ensure parent directory exists
  const contextgraphDir = join(homedir(), '.contextgraph');
  try {
    await mkdir(contextgraphDir, { recursive: true });
  } catch {
    // Directory might already exist
  }

  // Clone the repository
  await runCommand('git', ['clone', PLUGIN_REPO, PLUGIN_DIR]);

  // Verify plugin exists after clone
  try {
    await access(PLUGIN_PATH);
    console.log('[Plugin Setup] Plugin installed successfully');
    return PLUGIN_PATH;
  } catch {
    throw new Error(`Plugin clone succeeded but plugin path not found at ${PLUGIN_PATH}`);
  }
}

/**
 * Update the plugin to latest version
 */
export async function updatePlugin(): Promise<void> {
  try {
    await access(PLUGIN_DIR);
  } catch {
    throw new Error('Plugin not installed. Run the agent first to auto-install.');
  }

  console.log('[Plugin Setup] Updating plugin...');
  await runCommand('git', ['pull'], PLUGIN_DIR);
  console.log('[Plugin Setup] Plugin updated');
}

/**
 * Get the plugin path (without ensuring it exists)
 */
export function getPluginPath(): string {
  return PLUGIN_PATH;
}

function runCommand(command: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd, stdio: 'inherit' });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args[0]} failed with exit code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn ${command}: ${err.message}`));
    });
  });
}
