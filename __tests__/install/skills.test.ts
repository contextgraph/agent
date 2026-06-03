import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import os from 'os';
import { join } from 'path';

const mockMkdir = jest.fn() as any;
const mockWriteFile = jest.fn() as any;

jest.unstable_mockModule('fs/promises', () => ({
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
}));

const { resolveSkillRoot, resolveSkillDirs, writeSkillsForInstall } = await import(
  '../../src/install/skills.js'
);

const STANDARD = join('.agents', 'skills');
const CLAUDE = join('.claude', 'skills');

describe('resolveSkillRoot', () => {
  it('uses home for global scope', () => {
    expect(resolveSkillRoot('global')).toBe(os.homedir());
  });
  it('uses cwd for project scope', () => {
    expect(resolveSkillRoot('project', '/repo')).toBe('/repo');
  });
});

describe('resolveSkillDirs', () => {
  it('mirrors into .claude by default', () => {
    expect(resolveSkillDirs('project', { cwd: '/repo' })).toEqual([
      join('/repo', STANDARD),
      join('/repo', CLAUDE),
    ]);
  });
  it('writes only the standard dir when mirroring is disabled', () => {
    expect(resolveSkillDirs('project', { cwd: '/repo', mirrorClaude: false })).toEqual([
      join('/repo', STANDARD),
    ]);
  });
  it('resolves global dirs under the home directory', () => {
    expect(resolveSkillDirs('global')).toEqual([
      join(os.homedir(), STANDARD),
      join(os.homedir(), CLAUDE),
    ]);
  });
});

describe('writeSkillsForInstall', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  const skills = [
    { name: 'define-steward', markdown: '---\nname: define-steward\n---\nbody' },
    { name: 'plan-review', markdown: '---\nname: plan-review\n---\nbody2' },
  ];

  it('writes each skill verbatim to both standard and claude dirs', async () => {
    const written = await writeSkillsForInstall({ scope: 'project', skills, cwd: '/repo' });

    expect(written).toEqual([join('/repo', STANDARD), join('/repo', CLAUDE)]);
    // 2 skills x 2 dirs = 4 writes
    expect(mockWriteFile).toHaveBeenCalledTimes(4);
    expect(mockWriteFile).toHaveBeenCalledWith(
      join('/repo', STANDARD, 'define-steward', 'SKILL.md'),
      '---\nname: define-steward\n---\nbody',
      'utf-8'
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      join('/repo', CLAUDE, 'plan-review', 'SKILL.md'),
      '---\nname: plan-review\n---\nbody2',
      'utf-8'
    );
  });

  it('writes content as-is without adding frontmatter', async () => {
    await writeSkillsForInstall({ scope: 'global', skills: [skills[0]], mirrorClaude: false });
    const [, content] = mockWriteFile.mock.calls[0];
    expect(content).toBe('---\nname: define-steward\n---\nbody');
  });

  it('writes only the standard dir when mirroring disabled', async () => {
    const written = await writeSkillsForInstall({
      scope: 'project',
      skills: [skills[0]],
      cwd: '/repo',
      mirrorClaude: false,
    });
    expect(written).toEqual([join('/repo', STANDARD)]);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });

  it('returns [] and writes nothing for an empty skill list', async () => {
    const written = await writeSkillsForInstall({ scope: 'global', skills: [] });
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(written).toEqual([]);
  });
});
