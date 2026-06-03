import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

/**
 * Represents a skill to be injected into the agent workspace
 */
export interface SkillToInject {
  /** Skill name (used in directory and frontmatter) */
  name: string;
  /** Brief description for frontmatter */
  description: string;
  /** When to invoke the skill (optional, for frontmatter trigger field) */
  trigger?: string | null;
  /** Skill body content (markdown, WITHOUT frontmatter) */
  content: string;
}

/**
 * The Agent Skills open standard directory (relative to a project or home dir).
 * Read natively by Cursor, Codex, Gemini CLI, Copilot, and others.
 */
export const STANDARD_SKILLS_DIR = join('.agents', 'skills');

/**
 * Claude-native skills directory. Kept as a parallel write target so installs
 * cover both the open standard and Claude Code / Claude.ai.
 */
export const CLAUDE_SKILLS_DIR = join('.claude', 'skills');

/**
 * Build the SKILL.md file body (frontmatter + content) for a skill.
 */
export function buildSkillMarkdown(skill: SkillToInject): string {
  const triggerSection = skill.trigger
    ? `trigger: |\n${skill.trigger.split('\n').map((line) => `  ${line}`).join('\n')}\n`
    : '';
  return `---
name: ${skill.name}
description: ${skill.description}
${triggerSection}---

${skill.content}
`;
}

/**
 * Writes skills to a `<root>/<relativeSkillsDir>/<skill-name>/SKILL.md` layout.
 *
 * Defaults to the Claude-native `.claude/skills` directory to preserve the
 * historical worker-workspace behavior. Pass `relativeSkillsDir` (e.g.
 * `STANDARD_SKILLS_DIR`) to target the Agent Skills open standard location.
 *
 * @param root - Base directory (a workspace, a project root, or a home dir)
 * @param skills - Array of skills to write
 * @param relativeSkillsDir - Skills directory relative to `root`
 */
export async function injectSkills(
  root: string,
  skills: SkillToInject[],
  relativeSkillsDir: string = CLAUDE_SKILLS_DIR
): Promise<void> {
  if (skills.length === 0) {
    return;
  }

  for (const skill of skills) {
    try {
      const skillDir = join(root, relativeSkillsDir, skill.name);
      await mkdir(skillDir, { recursive: true });

      const skillFilePath = join(skillDir, 'SKILL.md');
      await writeFile(skillFilePath, buildSkillMarkdown(skill), 'utf-8');
    } catch (error) {
      console.error(`❌ Failed to inject skill "${skill.name}":`, error);
      throw error;
    }
  }
}
