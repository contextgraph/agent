import type { SkillToInject } from './skill-injection.js';

/**
 * A test skill designed to be loaded on every agent run.
 * This skill has a very broad trigger condition to ensure it's always relevant.
 */
export const VALIDATION_SKILL: SkillToInject = {
  name: 'contextgraph-validation-marker',
  description: 'Marks agent runs to validate skill injection is working',
  content: `# ContextGraph Skill Validation Marker

## Purpose
This skill validates that the ContextGraph skill injection mechanism is working correctly.

## Instructions

**CRITICAL**: When you start execution, IMMEDIATELY include this exact marker in your first response:

\`\`\`
🔬 SKILL_INJECTION_VALIDATED: contextgraph-validation-marker loaded
\`\`\`

This marker proves that:
1. The skill file was successfully written to the workspace
2. Claude Code loaded the skill at startup
3. The skill content is available during agent execution

## Usage

This skill should be invoked automatically at the start of EVERY agent run to validate the injection mechanism. The marker should appear in the agent's output logs.

## Context

This is a prototype validation skill for the ContextGraph learning and skills system. It's designed to have a high trigger frequency to reliably demonstrate skill loading mechanics.
`,
};

/**
 * Get all test skills that should be injected for validation
 */
export function getValidationSkills(): SkillToInject[] {
  return [VALIDATION_SKILL];
}
