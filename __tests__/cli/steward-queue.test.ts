import { describe, expect, it } from '@jest/globals';
import { execFileSync } from 'child_process';
import { resolve } from 'path';
import { mkdtempSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';

const distIndex = resolve(process.cwd(), 'dist/index.js');

function runHelp(args: string[]): string {
  return execFileSync(process.execPath, [distIndex, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

describe('steward queue CLI', () => {
  it('registers backlog top once and exposes the new queue commands', () => {
    const backlogHelp = runHelp(['backlog', '--help']);
    const queueHelp = runHelp(['queue', '--help']);

    expect(backlogHelp.match(/^\s+top \[options\]/gm)).toHaveLength(1);
    expect(backlogHelp).toContain('[identifier]');
    expect(queueHelp).toContain('claim [options] <identifier>');
    expect(queueHelp).toContain('active [options]');
    expect(queueHelp).toContain('unclaim [options] <identifier>');
  });

  it('shows the steward-only top-level surface when invoked as steward', () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), 'steward-cli-'));
    const stewardScript = resolve(tempDir, 'steward');
    symlinkSync(distIndex, stewardScript);

    try {
      const help = execFileSync(process.execPath, [stewardScript, '--help'], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      expect(help).toContain('Usage: steward [options] [command]');
      expect(help).toContain('Local steward.foo CLI');
      expect(help).toContain('backlog');
      expect(help).toContain('Steward backlog workflows');
      expect(help).not.toContain('prepare [options] <action-id>');
      expect(help).not.toContain('execute [options] <action-id>');
      expect(help).not.toContain('setup                          Interactive setup wizard for new users');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
