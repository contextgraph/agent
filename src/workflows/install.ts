import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import chalk from 'chalk';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { authenticateAgent } from '../auth-flow.js';
import { fetchSkillsLibrary } from '../skills-library-fetch.js';
import { isClaudeCodeAvailable, ensurePluginInstalled } from '../plugin-setup.js';
import { PRIMARY_MCP_BASE_URL, PRIMARY_WEB_BASE_URL } from '../platform-urls.js';
import {
  upsertMcpServerJson,
  upsertMcpServerToml,
  type McpHttpEntry,
} from '../install/mcp-config.js';
import {
  CLIENTS,
  detectClients,
  getClient,
  resolveClientConfigPath,
  type ClientDef,
} from '../install/clients.js';
import { writeSkillsForInstall } from '../install/skills.js';
import { MCP_SERVER_NAME, type InstallScope } from '../install/types.js';
import { isInteractive, select, multiselect } from '../install/prompt.js';

export interface InstallOptions {
  scope?: InstallScope;
  clients?: string[];
  skipSkills?: boolean;
  mirrorClaude?: boolean;
  print?: boolean;
  yes?: boolean;
  baseUrl?: string;
  mcpUrl?: string;
  cwd?: string;
}

interface ManualStep {
  label: string;
  instructions: string;
}

function jsonSnippet(jsonKey: string, entry: McpHttpEntry): string {
  return JSON.stringify({ [jsonKey]: { [MCP_SERVER_NAME]: entry } }, null, 2);
}

function tomlSnippet(url: string): string {
  return `[mcp_servers.${MCP_SERVER_NAME}]\nurl = "${url}"`;
}

/** Emit copy-paste config for every (or selected) client without writing files. */
function runPrint(entry: McpHttpEntry, clients: ClientDef[]): void {
  console.log(chalk.bold('\nSteward MCP server configuration\n'));
  console.log(`Remote MCP endpoint: ${chalk.cyan(entry.url)}\n`);
  for (const client of clients) {
    console.log(chalk.bold(`# ${client.label}`));
    if (client.kind === 'claude-plugin') {
      console.log('  claude plugin marketplace add contextgraph/claude-code-plugin');
      console.log('  claude plugin install steward\n');
    } else if (client.kind === 'mcp-json') {
      console.log(jsonSnippet(client.jsonKey ?? 'mcpServers', entry));
      console.log('');
    } else if (client.kind === 'mcp-toml') {
      console.log(tomlSnippet(entry.url));
      console.log('');
    } else {
      console.log(`  ${client.manual ?? 'Add the remote MCP URL above in the app UI.'}\n`);
    }
  }
}

async function resolveAuthToken(baseUrl: string): Promise<string> {
  const existing = await loadCredentials();
  if (existing && !isExpired(existing) && !isTokenExpired(existing.clerkToken)) {
    return existing.clerkToken;
  }

  console.log(chalk.dim('Authentication required — opening your browser...'));
  const result = await authenticateAgent({ baseUrl });
  if (!result.success) {
    throw new Error(`Authentication failed: ${result.error}`);
  }
  return result.credentials.token;
}

async function chooseScope(options: InstallOptions): Promise<InstallScope> {
  if (options.scope) {
    return options.scope;
  }
  if (!isInteractive()) {
    console.log(chalk.dim('No --scope given and not interactive; defaulting to global (~/).'));
    return 'global';
  }
  const choice = await select('Where should steward be installed?', [
    { value: 'global', label: 'Global', hint: 'follows you across every project (~/)' },
    { value: 'project', label: 'This project', hint: 'committable, shared with your team' },
  ]);
  return choice as InstallScope;
}

async function chooseClients(options: InstallOptions): Promise<ClientDef[]> {
  if (options.clients && options.clients.length > 0) {
    const resolved: ClientDef[] = [];
    for (const id of options.clients) {
      const client = getClient(id);
      if (!client) {
        throw new Error(`Unknown client "${id}". Known: ${CLIENTS.map((c) => c.id).join(', ')}`);
      }
      resolved.push(client);
    }
    return resolved;
  }

  const detected = new Set(detectClients().map((c) => c.id));

  if (!isInteractive()) {
    const auto = CLIENTS.filter((c) => detected.has(c.id));
    if (auto.length === 0) {
      throw new Error(
        'No coding agents detected and none specified. Re-run with `--client <id>` ' +
          `(known: ${CLIENTS.map((c) => c.id).join(', ')}).`
      );
    }
    console.log(chalk.dim(`Detected: ${auto.map((c) => c.label).join(', ')}`));
    return auto;
  }

  const chosen = await multiselect(
    'Which coding agents should steward be installed into?',
    CLIENTS.map((c) => ({
      value: c.id,
      label: c.label,
      hint: [detected.has(c.id) ? 'detected' : undefined, c.note].filter(Boolean).join(', ') || undefined,
      selected: detected.has(c.id),
    }))
  );
  return chosen.map((id) => getClient(id)!).filter(Boolean);
}

async function applyJsonClient(
  client: ClientDef,
  scope: InstallScope,
  entry: McpHttpEntry,
  cwd: string
): Promise<{ ok: boolean; detail: string }> {
  const filePath = resolveClientConfigPath(client, scope, cwd);
  if (!filePath) {
    return { ok: false, detail: `no config path for ${scope} scope` };
  }
  let existing: string | null = null;
  try {
    existing = await readFile(filePath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  const updated = upsertMcpServerJson(existing, client.jsonKey ?? 'mcpServers', MCP_SERVER_NAME, entry);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, updated, 'utf-8');
  return { ok: true, detail: filePath };
}

async function applyTomlClient(
  client: ClientDef,
  scope: InstallScope,
  entry: McpHttpEntry,
  cwd: string
): Promise<{ ok: boolean; detail: string }> {
  const filePath = resolveClientConfigPath(client, scope, cwd);
  if (!filePath) {
    return { ok: false, detail: `no config path for ${scope} scope` };
  }
  let existing: string | null = null;
  try {
    existing = await readFile(filePath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  const updated = upsertMcpServerToml(existing, MCP_SERVER_NAME, entry.url);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, updated, 'utf-8');
  return { ok: true, detail: filePath };
}

/**
 * Guide a developer through installing steward into their coding agent(s):
 * authenticate, write the MCP server config for each chosen client, and lay
 * down the steward skills via the Agent Skills open standard.
 */
export async function runInstall(options: InstallOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const webBaseUrl = (options.baseUrl || process.env.CONTEXTGRAPH_BASE_URL || PRIMARY_WEB_BASE_URL).replace(/\/+$/, '');
  const mcpUrl = (options.mcpUrl || PRIMARY_MCP_BASE_URL).replace(/\/+$/, '');
  const entry: McpHttpEntry = { type: 'http', url: mcpUrl };

  // Print mode: no auth, no writes — just emit copy-paste config.
  if (options.print) {
    const clients =
      options.clients && options.clients.length > 0
        ? options.clients.map((id) => {
            const c = getClient(id);
            if (!c) throw new Error(`Unknown client "${id}".`);
            return c;
          })
        : CLIENTS;
    runPrint(entry, clients);
    return;
  }

  console.log(chalk.bold('\nInstalling steward.foo into your coding agent(s)\n'));

  const token = await resolveAuthToken(webBaseUrl);
  const scope = await chooseScope(options);
  const clients = await chooseClients(options);

  if (clients.length === 0) {
    console.log(chalk.yellow('No clients selected — nothing to do.'));
    return;
  }

  const successes: string[] = [];
  const manualSteps: ManualStep[] = [];
  const failures: string[] = [];

  // Skills: the most portable asset. Write once for the chosen scope.
  if (!options.skipSkills) {
    try {
      const skills = await fetchSkillsLibrary({ authToken: token });
      if (skills.length > 0) {
        const dirs = await writeSkillsForInstall({
          scope,
          skills,
          mirrorClaude: options.mirrorClaude ?? true,
          cwd,
        });
        successes.push(`Skills (${skills.length}) → ${dirs.join(', ')}`);
      } else {
        console.log(chalk.dim('Skills library is empty — skipping skills.'));
      }
    } catch (error) {
      failures.push(`Skills: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // MCP server per client.
  for (const client of clients) {
    try {
      if (client.kind === 'claude-plugin') {
        if (await isClaudeCodeAvailable()) {
          await ensurePluginInstalled();
          successes.push(`${client.label}: plugin installed (MCP + skills + /steward: commands)`);
        } else {
          manualSteps.push({
            label: client.label,
            instructions:
              'Claude Code CLI not found. Install it, then run:\n' +
              '    claude plugin marketplace add contextgraph/claude-code-plugin\n' +
              '    claude plugin install steward',
          });
        }
      } else if (client.kind === 'mcp-json') {
        const result = await applyJsonClient(client, scope, entry, cwd);
        if (result.ok) successes.push(`${client.label}: ${result.detail}`);
        else failures.push(`${client.label}: ${result.detail}`);
      } else if (client.kind === 'mcp-toml') {
        const result = await applyTomlClient(client, scope, entry, cwd);
        if (result.ok) successes.push(`${client.label}: ${result.detail}`);
        else failures.push(`${client.label}: ${result.detail}`);
      } else if (client.kind === 'manual') {
        manualSteps.push({
          label: client.label,
          instructions: `${client.manual ?? ''}\n    MCP URL: ${mcpUrl}`.trim(),
        });
      }
    } catch (error) {
      failures.push(`${client.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Summary.
  console.log('');
  if (successes.length > 0) {
    console.log(chalk.bold.green('Configured:'));
    for (const s of successes) console.log(`  ${chalk.green('✓')} ${s}`);
  }
  if (manualSteps.length > 0) {
    console.log(chalk.bold.yellow('\nManual steps:'));
    for (const step of manualSteps) {
      console.log(`  ${chalk.yellow('•')} ${chalk.bold(step.label)}`);
      for (const line of step.instructions.split('\n')) {
        console.log(`    ${line}`);
      }
    }
  }
  if (failures.length > 0) {
    console.log(chalk.bold.red('\nCould not configure:'));
    for (const f of failures) console.log(`  ${chalk.red('✗')} ${f}`);
  }

  // `install` wires up the connection + skills; creating a steward happens
  // inside the agent (or the dashboard) afterward. Make that explicit so users
  // know what's left to do.
  const includesClaudeCode = clients.some((c) => c.kind === 'claude-plugin');
  console.log(chalk.bold('\nNext steps:'));
  console.log('  install sets up the steward connection (MCP server) and skills — not the steward itself.');
  console.log('  1. Restart (or reload MCP servers in) each agent so it picks up the steward server.');
  if (includesClaudeCode) {
    console.log('  2. In Claude Code, run `/mcp` to authorize steward, then `/steward:define-steward` to create your first steward.');
  } else {
    console.log('  2. Complete the browser authorization when your agent first connects, then define a steward from the dashboard.');
  }
  console.log(chalk.dim(`\nDashboard: ${webBaseUrl}`));
  console.log('');
}
