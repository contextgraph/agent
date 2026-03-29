import { describe, expect, it } from '@jest/globals';
import { execFileSync } from 'child_process';
import { resolve } from 'path';

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
    expect(queueHelp).toContain('claim [options] <identifier>');
    expect(queueHelp).toContain('active [options]');
    expect(queueHelp).toContain('unclaim [options] <identifier>');
  });
});
