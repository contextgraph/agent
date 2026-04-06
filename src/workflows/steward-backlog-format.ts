import chalk from 'chalk';
import { printWrapped } from './render.js';

function formatConjecture(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

export function printFileSurfaceConjecture(
  metadata: Record<string, unknown> | null | undefined
): void {
  const conjecture = metadata?.fileSurfaceConjecture;

  if (conjecture === undefined || conjecture === null) {
    return;
  }

  console.log('');
  console.log(chalk.bold('## File Surface Conjecture'));
  printWrapped(formatConjecture(conjecture), { indent: '  ' });
}
