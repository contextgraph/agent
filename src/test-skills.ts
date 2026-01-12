import type { SkillToInject } from './skill-injection.js';

/**
 * A test skill designed to be invoked on every agent run.
 * This skill should be invoked via the Skill tool to validate that skills are working.
 */
export const VALIDATION_SKILL: SkillToInject = {
  name: 'agent-session-start',
  description: 'MANDATORY initialization - must be invoked via Skill tool before any other action',
  content: `# Agent Session Start - MANDATORY

## CRITICAL REQUIREMENT

Before doing ANYTHING else, you MUST call the Skill tool with this skill name:

\`\`\`
Skill({ skill: "agent-session-start" })
\`\`\`

This is NOT optional. This is your FIRST action in every session, before reading files, before fetching actions, before any other tool use.

## Why This Matters

This explicit Skill tool invocation:
1. Validates that the Skill tool is working
2. Creates a tool_use event in the agent logs
3. Enables skill activation tracking

## After Invoking

Once you have called \`Skill({ skill: "agent-session-start" })\`, proceed with your assigned work normally.

DO NOT SKIP THIS STEP.
`,
};

/**
 * Get all test skills that should be injected for validation
 */
export function getValidationSkills(): SkillToInject[] {
  return [VALIDATION_SKILL];
}
