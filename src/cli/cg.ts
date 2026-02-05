import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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
