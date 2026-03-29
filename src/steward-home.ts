import os from 'os';
import path from 'path';

function firstDefined(values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined);
}

export function getStewardHomeDir(): string {
  const configured = firstDefined([
    process.env.STEWARD_HOME,
    process.env.STEWARD_CONFIG_DIR,
    process.env.CONTEXTGRAPH_CREDENTIALS_DIR,
  ]);

  if (configured === undefined) {
    return path.join(os.homedir(), '.steward');
  }

  const trimmed = configured.trim();
  if (trimmed.length === 0) {
    throw new Error('STEWARD_HOME must not be empty');
  }

  if (!path.isAbsolute(trimmed)) {
    throw new Error('STEWARD_HOME must be an absolute path');
  }

  return trimmed;
}
