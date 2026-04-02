import { spawn } from 'child_process';
import chalk from 'chalk';
import { ApiClient, type IntegrationSurfaceResource, type StewardNextResource } from '../api-client.js';
import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { PRIMARY_WEB_BASE_URL } from '../platform-urls.js';
import { printWrapped } from './render.js';

const DEFAULT_BASE_URL = PRIMARY_WEB_BASE_URL;

export interface StewardClaimOptions {
  identifier?: string;
  baseUrl?: string;
}

interface AvailableIntegration {
  key: string;
  name: string;
  endpoint: string | undefined;
  envVars: string[];
  description: string;
  usageReference: string | undefined;
}

function runGitCommand(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`git ${args.join(' ')} failed (exit ${code}): ${stderr || stdout}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn git: ${err.message}`));
    });
  });
}

function getAvailableIntegrations(surfaces: IntegrationSurfaceResource[]): AvailableIntegration[] {
  const integrations: AvailableIntegration[] = [];

  for (const surface of surfaces) {
    const envVars = surface.envVars.filter((envVar) => process.env[envVar]?.trim());

    if (envVars.length === 0) {
      continue;
    }

    integrations.push({
      key: surface.key,
      name: surface.name,
      endpoint: surface.defaultEndpoint,
      envVars,
      description: surface.description,
      usageReference: surface.usageReference,
    });
  }

  return integrations;
}

function printIntegrations(integrations: AvailableIntegration[]) {
  if (integrations.length === 0) {
    return;
  }

  console.log('');
  console.log(chalk.bold('## Available Integrations'));

  for (const integration of integrations) {
    console.log(`- ${chalk.bold(`${integration.name} (${integration.key})`)}`);
    if (integration.endpoint) {
      printWrapped(`Endpoint: ${integration.endpoint}`, { indent: '  ' });
    }
    printWrapped(`Available env vars: ${integration.envVars.join(', ')}`, { indent: '  ' });
    printWrapped(integration.description, { indent: '  ' });
    if (integration.usageReference) {
      printWrapped(`Use for: ${integration.usageReference}`, { indent: '  ' });
    }
  }
}

function printClaim(next: StewardNextResource, integrations: AvailableIntegration[]) {
  console.log(chalk.bold('# Steward Claim'));
  console.log(`- ${chalk.bold('Steward:')} ${chalk.cyan(`${next.steward.name} (${next.steward.slug})`)}`);
  if (next.backlog_item.id) {
    console.log(`- ${chalk.bold('Backlog ID:')} ${next.backlog_item.id}`);
  }
  if (next.backlog_item.backlog_reference) {
    console.log(`- ${chalk.bold('Backlog Ref:')} ${next.backlog_item.backlog_reference}`);
  }
  console.log(`- ${chalk.bold('Title:')} ${next.backlog_item.title}`);
  if (next.backlog_item.repository_url) {
    console.log(`- ${chalk.bold('Repository:')} ${next.backlog_item.repository_url}`);
  }

  console.log('');
  console.log(chalk.bold('## Objective'));
  printWrapped(next.backlog_item.objective, { indent: '  ' });

  console.log('');
  console.log(chalk.bold('## Rationale'));
  printWrapped(next.backlog_item.rationale, { indent: '  ' });

  printIntegrations(integrations);

  if (next.workflow?.dismissal_rule || next.workflow?.dismissal_command || next.workflow?.completion_rule) {
    console.log('');
    console.log(chalk.bold('## Workflow'));
    if (next.workflow?.dismissal_rule) {
      console.log(`- ${chalk.bold('Dismissal rule:')}`);
      printWrapped(next.workflow.dismissal_rule, { indent: '  ' });
    }
    if (next.workflow?.dismissal_command) {
      console.log(`- ${chalk.bold('Dismiss command:')}`);
      printWrapped(next.workflow.dismissal_command, { indent: '  ' });
    }
    if (next.workflow?.completion_rule) {
      console.log(`- ${chalk.bold('Completion rule:')}`);
      printWrapped(next.workflow.completion_rule, { indent: '  ' });
    }
  }

  if (next.workflow?.session_rule) {
    console.log('');
    console.log(chalk.bold('## Stop Rule'));
    printWrapped(next.workflow.session_rule, { indent: '  ' });
  }
}

export async function runStewardClaim(options: StewardClaimOptions = {}): Promise<void> {
  const credentials = await loadCredentials();

  if (!credentials) {
    console.error(chalk.red('Not authenticated.'), 'Run authentication first.');
    process.exit(1);
  }

  if (isExpired(credentials) || isTokenExpired(credentials.clerkToken)) {
    console.error(chalk.red('Token expired.'), 'Re-authenticate to continue.');
    process.exit(1);
  }

  const baseUrl = (options.baseUrl || process.env.CONTEXTGRAPH_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const apiClient = new ApiClient(baseUrl);
  const next = options.identifier
    ? await apiClient.claimStewardBacklog(options.identifier)
    : await apiClient.nextStewardWork();

  if (!next) {
    console.log(chalk.yellow('No queued steward backlog items right now.'));
    return;
  }

  let integrations: AvailableIntegration[] = [];
  try {
    integrations = getAvailableIntegrations(await apiClient.getIntegrationSurfaces());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(chalk.yellow(`Warning: failed to load integration surfaces: ${message}`));
  }

  printClaim(next, integrations);

  if (!next.backlog_item.proposed_branch) {
    throw new Error('API contract violation: claim route returned a backlog item without proposed_branch');
  }

  await runGitCommand(['checkout', '-b', next.backlog_item.proposed_branch]);
  console.log('');
  console.log(chalk.bold('## Branch'));
  console.log(chalk.green(`Created and checked out ${next.backlog_item.proposed_branch}`));
  console.log('');
  console.log(chalk.bold('## Next Step'));
  printWrapped('Do the work for this backlog item on the checked-out branch. After you open or update a PR, stop and wait for the user instead of claiming another backlog item.', {
    indent: '  ',
  });
}
