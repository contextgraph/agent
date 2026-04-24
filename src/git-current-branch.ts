import { spawn } from 'child_process';

export type CurrentBranchResult =
  | { kind: 'branch'; name: string }
  | { kind: 'detached' }
  | { kind: 'not-a-repo'; message: string };

export function detectCurrentBranch(cwd: string = process.cwd()): Promise<CurrentBranchResult> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({ kind: 'not-a-repo', message: (stderr || stdout).trim() || 'git rev-parse failed' });
        return;
      }
      const name = stdout.trim();
      if (!name || name === 'HEAD') {
        resolve({ kind: 'detached' });
        return;
      }
      resolve({ kind: 'branch', name });
    });

    proc.on('error', (err) => {
      resolve({ kind: 'not-a-repo', message: err.message });
    });
  });
}
