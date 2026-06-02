import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import os from 'os';
import { join } from 'path';

const mockInjectSkills = jest.fn() as any;

jest.unstable_mockModule('../../src/skill-injection.js', () => ({
  injectSkills: mockInjectSkills,
  STANDARD_SKILLS_DIR: join('.agents', 'skills'),
  CLAUDE_SKILLS_DIR: join('.claude', 'skills'),
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
    mockInjectSkills.mockResolvedValue(undefined);
  });

  const skills = [{ name: 's', description: 'd', content: 'c' }];

  it('writes to both standard and claude dirs and returns them', async () => {
    const written = await writeSkillsForInstall({ scope: 'project', skills, cwd: '/repo' });
    expect(mockInjectSkills).toHaveBeenCalledTimes(2);
    expect(mockInjectSkills).toHaveBeenCalledWith('/repo', skills, STANDARD);
    expect(mockInjectSkills).toHaveBeenCalledWith('/repo', skills, CLAUDE);
    expect(written).toEqual([join('/repo', STANDARD), join('/repo', CLAUDE)]);
  });

  it('writes only the standard dir when mirroring disabled', async () => {
    const written = await writeSkillsForInstall({
      scope: 'project',
      skills,
      cwd: '/repo',
      mirrorClaude: false,
    });
    expect(mockInjectSkills).toHaveBeenCalledTimes(1);
    expect(written).toEqual([join('/repo', STANDARD)]);
  });

  it('returns [] and writes nothing for an empty skill list', async () => {
    const written = await writeSkillsForInstall({ scope: 'global', skills: [] });
    expect(mockInjectSkills).not.toHaveBeenCalled();
    expect(written).toEqual([]);
  });
});
