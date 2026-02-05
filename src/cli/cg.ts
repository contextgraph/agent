import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { CgApiClient } from '../cg-api-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf-8')
);

const program = new Command();

program
  .name('cg')
  .description('ContextGraph CLI for agent execution')
  .version(packageJson.version);

// Global option for organization selection
program.option('--org <org-id>', 'Organization ID (use "personal" for Personal Account)');

// fetch command
program
  .command('fetch <action-id>')
  .description('Fetch action details')
  .option('--detail-level <level>', 'Detail level (small|focus|medium|large)', 'focus')
  .action(async (actionId, options) => {
    try {
      const orgId = program.opts().org;
      const client = new CgApiClient();
      const args: Record<string, any> = {
        id: actionId,
        detail_level: options.detailLevel,
      };
      if (orgId) {
        args.organization_id = orgId;
      }
      const result = await client.callTool('actions/fetch', args);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ error: errorMessage }));
      process.exit(1);
    }
  });

// search command
program
  .command('search <query>')
  .description('Search for actions')
  .option('--mode <mode>', 'Search mode (vector|keyword|hybrid)', 'hybrid')
  .option('--limit <n>', 'Maximum number of results', '10')
  .option('--include-completed', 'Include completed actions')
  .option('--parent-id <id>', 'Parent action ID to search within')
  .option('--threshold <n>', 'Minimum similarity threshold (0-1)', '0.3')
  .action(async (query, options) => {
    try {
      const orgId = program.opts().org;
      const client = new CgApiClient();
      const args: Record<string, any> = {
        query,
        search_mode: options.mode,
        limit: parseInt(options.limit, 10),
      };
      if (options.includeCompleted) {
        args.include_completed = true;
      }
      if (options.parentId) {
        args.parent_id = options.parentId;
      }
      if (options.threshold) {
        args.similarity_threshold = parseFloat(options.threshold);
      }
      if (orgId) {
        args.organization_id = orgId;
      }
      const result = await client.callTool('actions/search', args);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ error: errorMessage }));
      process.exit(1);
    }
  });

// tree command
program
  .command('tree [root-id]')
  .description('Fetch hierarchical tree view of actions')
  .option('--depth <n>', 'Maximum depth to traverse', '3')
  .option('--include-completed', 'Include completed actions')
  .action(async (rootId, options) => {
    try {
      const orgId = program.opts().org;
      const client = new CgApiClient();
      const args: Record<string, any> = {
        max_depth: parseInt(options.depth, 10),
      };
      if (rootId) {
        args.root_id = rootId;
      }
      if (options.includeCompleted) {
        args.include_completed = true;
      }
      if (orgId) {
        args.organization_id = orgId;
      }
      const result = await client.callTool('actions/fetch_tree', args);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ error: errorMessage }));
      process.exit(1);
    }
  });

// Add a placeholder command to show help when no command is provided
program.action(() => {
  program.help();
});

// Error handling for all commands
program.exitOverride((err) => {
  // Output errors as JSON to stderr
  if (err.code !== 'commander.help' && err.code !== 'commander.version') {
    console.error(JSON.stringify({
      error: err.message || 'Unknown error',
      code: err.code
    }));
    process.exit(err.exitCode || 1);
  }
  throw err;
});

// Parse and handle the command
try {
  program.parse();
} catch (error) {
  // Handle help and version exits gracefully
  if (error instanceof Error) {
    const cmdError = error as any;
    if (cmdError.code === 'commander.help' || cmdError.code === 'commander.version') {
      process.exit(0);
    }
  }
  throw error;
}
