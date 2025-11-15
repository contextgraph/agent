import { Command } from 'commander';

const program = new Command();

program
  .name('contextgraph-agent')
  .description('Autonomous agent for contextgraph action execution')
  .version('0.1.0');

program.parse();
