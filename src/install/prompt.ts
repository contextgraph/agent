import { createInterface, type Interface } from 'readline';

/**
 * Minimal, dependency-free interactive prompts for the install flow. Backed by
 * `readline`; throws a clear error when stdin is not a TTY so callers can tell
 * the user to pass flags for non-interactive use.
 */

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function ensureInteractive(): void {
  if (!isInteractive()) {
    throw new Error(
      'Interactive input is required but no TTY is attached. Re-run with explicit flags ' +
        '(e.g. `--scope`, `--client`, `--yes`).'
    );
  }
}

function withReadline<T>(fn: (rl: Interface) => Promise<T>): Promise<T> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return fn(rl).finally(() => rl.close());
}

function question(rl: Interface, query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

export interface Choice {
  value: string;
  label: string;
  hint?: string;
  /** Pre-selected in a multi-select. */
  selected?: boolean;
}

/** Single-choice select. Returns the chosen value. */
export async function select(message: string, choices: Choice[]): Promise<string> {
  ensureInteractive();
  return withReadline(async (rl) => {
    while (true) {
      console.log(`\n${message}`);
      choices.forEach((choice, i) => {
        const hint = choice.hint ? `  — ${choice.hint}` : '';
        console.log(`  ${i + 1}) ${choice.label}${hint}`);
      });
      const answer = (await question(rl, 'Enter number: ')).trim();
      const index = Number.parseInt(answer, 10) - 1;
      if (Number.isInteger(index) && index >= 0 && index < choices.length) {
        return choices[index].value;
      }
      console.log('Please enter a valid number.');
    }
  });
}

/**
 * Multi-select. Accepts a comma/space separated list of numbers, `all`, or an
 * empty line to accept the pre-selected defaults. Returns chosen values.
 */
export async function multiselect(message: string, choices: Choice[]): Promise<string[]> {
  ensureInteractive();
  return withReadline(async (rl) => {
    while (true) {
      console.log(`\n${message}`);
      choices.forEach((choice, i) => {
        const mark = choice.selected ? '[x]' : '[ ]';
        const hint = choice.hint ? `  — ${choice.hint}` : '';
        console.log(`  ${i + 1}) ${mark} ${choice.label}${hint}`);
      });
      console.log('Enter numbers (comma/space separated), "all", or press Enter for the [x] defaults.');
      const answer = (await question(rl, 'Selection: ')).trim();

      if (answer === '') {
        return choices.filter((c) => c.selected).map((c) => c.value);
      }
      if (answer.toLowerCase() === 'all') {
        return choices.map((c) => c.value);
      }

      const tokens = answer.split(/[\s,]+/).filter(Boolean);
      const indices = tokens.map((t) => Number.parseInt(t, 10) - 1);
      if (indices.every((i) => Number.isInteger(i) && i >= 0 && i < choices.length)) {
        const unique = [...new Set(indices)];
        return unique.map((i) => choices[i].value);
      }
      console.log('Please enter valid numbers.');
    }
  });
}

/** Yes/no confirm. */
export async function confirm(message: string, defaultValue = true): Promise<boolean> {
  ensureInteractive();
  const suffix = defaultValue ? '[Y/n]' : '[y/N]';
  return withReadline(async (rl) => {
    const answer = (await question(rl, `${message} ${suffix} `)).trim().toLowerCase();
    if (answer === '') return defaultValue;
    return answer === 'y' || answer === 'yes';
  });
}
