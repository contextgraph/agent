import chalk from 'chalk';

export function runStewardBacklogInstructions(): void {
  console.log(chalk.bold('# Manual Backlog Workflow'));
  console.log('- 1. Inspect the top item with `steward backlog top`.');
  console.log('- 2. Claim exactly one item with `steward backlog claim <backlog-id-or-ref>`.');
  console.log('- 3. Do the work locally in Claude Code on the checked-out branch.');
  console.log('- 4. Open or update a PR for that item, then stop and wait for the user.');
  console.log('- 5. If the item is invalid, dismiss it with `steward backlog dismiss <id-or-ref> --note \"...\"`.');
  console.log('- 6. If you are pausing or the item is too large, unclaim it with `steward backlog unclaim <id-or-ref>`.');
  console.log('- 7. If you need to recover context, use `steward backlog claimed` instead of claiming another item.');
}
