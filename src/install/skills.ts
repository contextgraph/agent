import os from 'os';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { STANDARD_SKILLS_DIR, CLAUDE_SKILLS_DIR } from '../skill-injection.js';
import type { RawSkill } from './plugin-skills.js';
import type { InstallScope } from './types.js';

/**
 * Resolve the base directory that skill folders are written under for a scope.
 *
 * - `global` → the user's home directory (skills follow the developer across
 *   every project), e.g. `~/.agents/skills`.
 * - `project` → the current working directory (committable, team-shared),
 *   e.g. `<repo>/.agents/skills`.
 */
export function resolveSkillRoot(scope: InstallScope, cwd: string = process.cwd()): string {
  return scope === 'global' ? os.homedir() : cwd;
}

/**
 * The skills directories written for a given scope. Always writes the Agent
 * Skills open-standard location (`.agents/skills`); mirrors into the
 * Claude-native location (`.claude/skills`) unless disabled.
 */
export function resolveSkillDirs(
  scope: InstallScope,
  options: { mirrorClaude?: boolean; cwd?: string } = {}
): string[] {
  const { mirrorClaude = true, cwd } = options;
  const root = resolveSkillRoot(scope, cwd);
  const dirs = [join(root, STANDARD_SKILLS_DIR)];
  if (mirrorClaude) {
    dirs.push(join(root, CLAUDE_SKILLS_DIR));
  }
  return dirs;
}

export interface WriteSkillsOptions {
  scope: InstallScope;
  skills: RawSkill[];
  /** Mirror into `.claude/skills` in addition to `.agents/skills`. Default true. */
  mirrorClaude?: boolean;
  cwd?: string;
}

/**
 * Write the steward skills (verbatim `SKILL.md`) into the standard (and, by
 * default, the Claude-native) skills directory for the chosen scope.
 *
 * The markdown already carries its own frontmatter, so it is written as-is.
 * Returns the absolute base directories written, for reporting back.
 */
export async function writeSkillsForInstall(options: WriteSkillsOptions): Promise<string[]> {
  const { scope, skills, mirrorClaude = true, cwd } = options;
  if (skills.length === 0) {
    return [];
  }

  const dirs = resolveSkillDirs(scope, { mirrorClaude, cwd });
  for (const baseDir of dirs) {
    for (const skill of skills) {
      const skillDir = join(baseDir, skill.name);
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), skill.markdown, 'utf-8');
    }
  }
  return dirs;
}
