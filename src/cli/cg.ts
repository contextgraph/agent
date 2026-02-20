import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { CgApiClient } from '../cg-api-client.js';
import { createCommandSchema, updateCommandSchema, completeCommandSchema, formatZodError } from './schemas.js';
import { ZodError } from 'zod';

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

/**
 * Helper function to read JSON from stdin
 */
async function readStdinJson(): Promise<Record<string, any>> {
  // Check if stdin is a TTY (terminal) - if so, there's no piped input
  if (process.stdin.isTTY) {
    return {};
  }

  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      if (data.trim() === '') {
        resolve({});
      } else {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error(`Invalid JSON in stdin: ${error instanceof Error ? error.message : String(error)}`));
        }
      }
    });
    process.stdin.on('error', (error) => {
      reject(error);
    });
  });
}

// append-note command
program
  .command('append-note <action-id>')
  .description('Append a note to an action')
  .option('--content <text>', 'Note content')
  .option('--author-type <type>', 'Author type (user|agent|system)', 'agent')
  .option('--author-name <name>', 'Author name')
  .action(async (actionId, options) => {
    try {
      const orgId = program.opts().org;
      const client = new CgApiClient();

      // Read from stdin if --content is not provided
      let content = options.content;
      if (!content) {
        const stdinData = await readStdinJson();
        content = stdinData.content || '';
      }

      if (!content) {
        throw new Error('Note content is required (via --content or stdin with {"content": "..."})');
      }

      const args: Record<string, any> = {
        action_id: actionId,
        content,
        author: {
          type: options.authorType,
        },
      };

      if (options.authorName) {
        args.author.name = options.authorName;
      }

      if (orgId) {
        args.organization_id = orgId;
      }

      const result = await client.callTool('actions/append_note', args);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ error: errorMessage }));
      process.exit(1);
    }
  });

// create command
program
  .command('create')
  .description('Create a new action')
  .option('--title <text>', 'Action title')
  .option('--vision <text>', 'Action vision')
  .option('--parent-id <id>', 'Parent action ID (required)')
  .option('--depends-on <ids>', 'Comma-separated list of dependency action IDs')
  .option('--branch <branch>', 'Git branch')
  .option('--repo <url>', 'Repository URL')
  .option('--freeform <text>', 'Freeform input text')
  .option('--stdin', 'Read full JSON payload from stdin')
  .action(async (options) => {
    try {
      const orgId = program.opts().org;
      const client = new CgApiClient();

      let args: Record<string, any> = {};

      // If --stdin is provided, read JSON from stdin as base
      if (options.stdin) {
        args = await readStdinJson();
      }

      // CLI options override stdin values
      if (options.title) args.title = options.title;
      if (options.vision) args.vision = options.vision;
      if (options.parentId) args.parent_id = options.parentId;
      if (options.branch) args.branch = options.branch;
      if (options.repo) args.repository_url = options.repo;
      if (options.freeform) args.freeform_input = options.freeform;

      // Handle depends_on as comma-separated list
      if (options.dependsOn) {
        args.depends_on_ids = options.dependsOn.split(',').map((id: string) => id.trim());
      } else if (!args.depends_on_ids) {
        args.depends_on_ids = [];
      }

      if (orgId) {
        args.organization_id = orgId;
      }

      // Validate required fields
      if (!args.title) {
        throw new Error('--title is required');
      }
      if (!args.vision) {
        throw new Error('--vision is required');
      }
      if (!args.parent_id) {
        throw new Error('--parent-id is required');
      }

      // Validate schema
      try {
        createCommandSchema.parse(args);
      } catch (error) {
        if (error instanceof ZodError) {
          throw new Error(formatZodError(error));
        }
        throw error;
      }

      const result = await client.callTool('actions/create', args);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ error: errorMessage }));
      process.exit(1);
    }
  });

// update command
program
  .command('update <action-id>')
  .description('Update an existing action')
  .option('--title <text>', 'Action title')
  .option('--vision <text>', 'Action vision')
  .option('--prepared', 'Mark action as prepared')
  .option('--agent-ready', 'Mark action as ready for agent execution')
  .option('--branch <branch>', 'Git branch')
  .option('--depends-on <ids>', 'Comma-separated list of dependency action IDs')
  .option('--brief <text>', 'Brief/institutional memory')
  .option('--stdin', 'Read full JSON payload from stdin')
  .action(async (actionId, options) => {
    try {
      const orgId = program.opts().org;
      const client = new CgApiClient();

      let args: Record<string, any> = {
        action_id: actionId,
      };

      // If --stdin is provided, read JSON from stdin as base
      if (options.stdin) {
        const stdinData = await readStdinJson();
        args = { ...stdinData, action_id: actionId };
      }

      // CLI options override stdin values
      if (options.title) args.title = options.title;
      if (options.vision) args.vision = options.vision;
      if (options.prepared !== undefined) args.prepared = options.prepared;
      if (options.agentReady !== undefined) args.agentReady = options.agentReady;
      if (options.branch) args.branch = options.branch;
      if (options.brief) args.brief = options.brief;

      // Handle depends_on as comma-separated list
      if (options.dependsOn) {
        args.depends_on_ids = options.dependsOn.split(',').map((id: string) => id.trim());
      }

      if (orgId) {
        args.organization_id = orgId;
      }

      // Validate schema
      try {
        updateCommandSchema.parse(args);
      } catch (error) {
        if (error instanceof ZodError) {
          throw new Error(formatZodError(error));
        }
        throw error;
      }

      const result = await client.callTool('actions/update', args);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ error: errorMessage }));
      process.exit(1);
    }
  });

// complete command
program
  .command('complete <action-id>')
  .description('Mark an action as completed')
  .option('--visibility <level>', 'Changelog visibility (private|team|public)')
  .option('--stdin', 'Read full completion context JSON from stdin (recommended)')
  .action(async (actionId, options) => {
    try {
      const orgId = program.opts().org;
      const client = new CgApiClient();

      let args: Record<string, any> = {
        action_id: actionId,
      };

      // If --stdin is provided, read JSON from stdin as base
      if (options.stdin) {
        const stdinData = await readStdinJson();
        args = { ...stdinData, action_id: actionId };
      }

      // CLI options override stdin values
      if (options.visibility) {
        args.changelog_visibility = options.visibility;
      }

      if (orgId) {
        args.organization_id = orgId;
      }

      // Validate required fields
      if (!args.changelog_visibility) {
        throw new Error('--visibility is required (or provide via stdin)');
      }

      // Validate schema
      try {
        completeCommandSchema.parse(args);
      } catch (error) {
        if (error instanceof ZodError) {
          throw new Error(formatZodError(error));
        }
        throw error;
      }

      const result = await client.callTool('actions/complete', args);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ error: errorMessage }));
      process.exit(1);
    }
  });

// uncomplete command
program
  .command('uncomplete <action-id>')
  .description('Mark a completed action as incomplete again')
  .action(async (actionId) => {
    try {
      const orgId = program.opts().org;
      const client = new CgApiClient();
      const args: Record<string, any> = {
        action_id: actionId,
      };
      if (orgId) {
        args.organization_id = orgId;
      }
      const result = await client.callTool('actions/uncomplete', args);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ error: errorMessage }));
      process.exit(1);
    }
  });

// list-notes command
program
  .command('list-notes <action-id>')
  .description('Retrieve all notes for an action')
  .action(async (actionId) => {
    try {
      const orgId = program.opts().org;
      const client = new CgApiClient();
      const args: Record<string, any> = {
        action_id: actionId,
      };
      if (orgId) {
        args.organization_id = orgId;
      }
      const result = await client.callTool('actions/list_notes', args);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ error: errorMessage }));
      process.exit(1);
    }
  });

// move command
program
  .command('move <action-id>')
  .description('Move an action to a different parent')
  .option('--new-parent-id <id>', 'ID of the new parent action (omit to make independent)')
  .action(async (actionId, options) => {
    try {
      const orgId = program.opts().org;
      const client = new CgApiClient();
      const args: Record<string, any> = {
        action_id: actionId,
      };
      if (options.newParentId) {
        args.new_parent_id = options.newParentId;
      }
      if (orgId) {
        args.organization_id = orgId;
      }
      const result = await client.callTool('actions/move', args);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ error: errorMessage }));
      process.exit(1);
    }
  });

// delete command
program
  .command('delete <action-id>')
  .description('Delete an action and handle its children')
  .option('--child-handling <mode>', 'How to handle children (delete_recursive|reparent)', 'reparent')
  .option('--new-parent-id <id>', 'New parent for children when reparenting')
  .action(async (actionId, options) => {
    try {
      const orgId = program.opts().org;
      const client = new CgApiClient();

      // Validate that new-parent-id is provided when child-handling is reparent
      if (options.childHandling === 'reparent' && !options.newParentId) {
        throw new Error('--new-parent-id is required when --child-handling is "reparent"');
      }

      const args: Record<string, any> = {
        action_id: actionId,
        child_handling: options.childHandling,
      };
      if (options.newParentId) {
        args.new_parent_id = options.newParentId;
      }
      if (orgId) {
        args.organization_id = orgId;
      }
      const result = await client.callTool('actions/delete', args);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ error: errorMessage }));
      process.exit(1);
    }
  });

// report-completed-work command
program
  .command('report-completed-work')
  .description('Report work that has already been completed')
  .option('--title <text>', 'Action title')
  .option('--parent-id <id>', 'Parent action ID')
  .option('--visibility <level>', 'Changelog visibility (private|team|public)')
  .option('--stdin', 'Read full JSON payload from stdin (recommended)')
  .action(async (options) => {
    try {
      const orgId = program.opts().org;
      const client = new CgApiClient();

      let args: Record<string, any> = {};

      // If --stdin is provided, read JSON from stdin as base
      if (options.stdin) {
        args = await readStdinJson();
      }

      // CLI options override stdin values
      if (options.title) args.title = options.title;
      if (options.parentId) args.parent_id = options.parentId;
      if (options.visibility) args.changelog_visibility = options.visibility;

      if (orgId) {
        args.organization_id = orgId;
      }

      // Validate required fields
      if (!args.title) {
        throw new Error('--title is required (or provide via stdin)');
      }
      if (!args.parent_id) {
        throw new Error('--parent-id is required (or provide via stdin)');
      }
      if (!args.changelog_visibility) {
        throw new Error('--visibility is required (or provide via stdin)');
      }

      const result = await client.callTool('actions/report_completed_work', args);
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
  if (
    err.code !== 'commander.help' &&
    err.code !== 'commander.helpDisplayed' &&
    err.code !== 'commander.version'
  ) {
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
    if (
      cmdError.code === 'commander.help' ||
      cmdError.code === 'commander.helpDisplayed' ||
      cmdError.code === 'commander.version'
    ) {
      process.exit(0);
    }
  }
  throw error;
}
