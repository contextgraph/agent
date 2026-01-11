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
  /** Full skill content (markdown) */
  content: string;
}

/**
 * Writes skills to the workspace .claude/skills directory
 * so they are available when the Claude Code agent starts.
 *
 * @param workspacePath - Path to the workspace directory
 * @param skills - Array of skills to inject
 */
export async function injectSkills(
  workspacePath: string,
  skills: SkillToInject[]
): Promise<void> {
  if (skills.length === 0) {
    console.log('📚 No skills to inject');
    return;
  }

  console.log(`📚 Injecting ${skills.length} skill(s) into workspace...`);

  for (const skill of skills) {
    try {
      // Create skill directory
      const skillDir = join(workspacePath, '.claude', 'skills', skill.name);
      await mkdir(skillDir, { recursive: true });

      // Build SKILL.md content with frontmatter
      const skillContent = `---
name: ${skill.name}
description: ${skill.description}
---

${skill.content}
`;

      // Write SKILL.md file
      const skillFilePath = join(skillDir, 'SKILL.md');
      await writeFile(skillFilePath, skillContent, 'utf-8');

      console.log(`   ✅ Injected skill: ${skill.name}`);
    } catch (error) {
      console.error(`   ❌ Failed to inject skill "${skill.name}":`, error);
      throw error;
    }
  }

  console.log(`✅ Skills injected successfully`);
}
