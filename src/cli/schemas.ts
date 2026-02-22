import { z } from 'zod';

/**
 * CLI Validation Schemas
 *
 * These schemas validate complex stdin payloads at the CLI boundary before calling the MCP server.
 *
 * IMPORTANT: Schema drift is acceptable technical debt for Phase 1 (per parent brief),
 * but these schemas should mirror the corresponding MCP tool definitions in:
 * actions/lib/mcp/tools.ts
 *
 * Schema Sync Reference:
 * - createCommandSchema → server.tool("create", ...) at actions/lib/mcp/tools.ts:~395
 * - updateCommandSchema → server.tool("update", ...) at actions/lib/mcp/tools.ts:~542
 * - completeCommandSchema → server.tool("complete", ...) at actions/lib/mcp/tools.ts:~745
 *
 * When modifying these schemas, review the corresponding MCP tool definition to ensure
 * alignment. Follow-up work should add sync tests or schema generation to prevent drift.
 */

/**
 * Shared sub-schemas for nested structures
 *
 * These mirror the nested schema structures defined in the MCP tools.
 */

// Git commit schema for completion context
const gitCommitSchema = z.object({
  hash: z.string().describe('SHA hash (required for clickable commit links)'),
  shortHash: z.string().describe('Short SHA (7 chars, required for clickable commit links)'),
  message: z.string(),
  author: z
    .object({
      name: z.string(),
      email: z.string().optional(),
      username: z.string().optional(),
    })
    .optional(),
  timestamp: z.string().optional(),
  branch: z.string().optional(),
  repository: z.string().optional(),
  stats: z
    .object({
      filesChanged: z.number().optional(),
      insertions: z.number().optional(),
      deletions: z.number().optional(),
      files: z.array(z.string()).optional(),
    })
    .optional(),
});

// Git pull request schema for completion context
const gitPullRequestSchema = z.object({
  number: z.number().optional(),
  title: z.string(),
  url: z.string().optional(),
  repository: z.string().optional(),
  author: z
    .object({
      name: z.string().optional(),
      username: z.string().optional(),
    })
    .optional(),
  state: z.enum(['open', 'closed', 'merged', 'draft']).optional(),
  merged: z.boolean().optional(),
  mergedAt: z.string().optional(),
  branch: z
    .object({
      head: z.string(),
      base: z.string(),
    })
    .optional(),
});

// Git repository schema for completion context
const gitRepositorySchema = z.object({
  name: z.string(),
  url: z.string().optional(),
  platform: z.enum(['github', 'gitlab', 'other']).optional(),
});

// Git context schema (used in both update and complete)
const gitContextSchema = z.object({
  commits: z.array(gitCommitSchema).optional(),
  pullRequests: z.array(gitPullRequestSchema).optional(),
  repositories: z.array(gitRepositorySchema).optional(),
});

// Technical changes schema for completion context
const technicalChangesSchema = z.object({
  files_modified: z.array(z.string()).default([]),
  files_created: z.array(z.string()).default([]),
  functions_added: z.array(z.string()).default([]),
  apis_modified: z.array(z.string()).default([]),
  dependencies_added: z.array(z.string()).default([]),
  config_changes: z.array(z.string()).default([]),
});

// Outcomes schema for completion context
const outcomesSchema = z.object({
  features_implemented: z.array(z.string()).default([]),
  bugs_fixed: z.array(z.string()).default([]),
  performance_improvements: z.array(z.string()).default([]),
  tests_passing: z.boolean().optional(),
  build_status: z.enum(['success', 'failed', 'unknown']).optional(),
});

// Challenges schema for completion context
const challengesSchema = z.object({
  blockers_encountered: z.array(z.string()).default([]),
  blockers_resolved: z.array(z.string()).default([]),
  approaches_tried: z.array(z.string()).default([]),
  discoveries: z.array(z.string()).default([]),
});

// Completion context schema (used in update for selective updates)
const completionContextSchema = z.object({
  changelog_visibility: z.enum(['private', 'team', 'public']).optional(),
  technical_changes: technicalChangesSchema.optional(),
  outcomes: outcomesSchema.optional(),
  challenges: challengesSchema.optional(),
  git_context: gitContextSchema.optional(),
});

/**
 * Command-specific schemas
 */

/**
 * Schema for the `create` command
 *
 * Syncs with: server.tool("create", ...) in actions/lib/mcp/tools.ts:~395
 *
 * This schema validates the input to the `cg create` command before calling the MCP server.
 * Field changes should be synchronized with the corresponding MCP tool definition.
 */
export const createCommandSchema = z.object({
  title: z.string().min(1).optional(),
  vision: z.string().min(1).optional(),
  freeform_input: z.string().optional(),
  parent_id: z.string().uuid().optional(),
  parent_ids: z.array(z.string().uuid()).optional(),
  depends_on_ids: z.array(z.string().uuid()),
  repository_url: z.string().url().optional(),
  branch: z.string().optional(),
  graph_id: z.string().uuid().optional(),
  execution_action_id: z.string().uuid().optional(),
  organization_id: z.string().optional(),
});

/**
 * Schema for the `update` command
 *
 * Syncs with: server.tool("update", ...) in actions/lib/mcp/tools.ts:~542
 *
 * This schema validates the input to the `cg update` command before calling the MCP server.
 * Field changes should be synchronized with the corresponding MCP tool definition.
 */
export const updateCommandSchema = z.object({
  action_id: z.string().uuid(),
  title: z.string().min(1).optional(),
  vision: z.string().optional(),
  repository_url: z.string().url().nullable().optional(),
  branch: z.string().nullable().optional(),
  prepared: z.boolean().optional(),
  agentReady: z.boolean().optional(),
  learned: z.boolean().optional(),
  brief: z.string().nullable().optional(),
  completion_context: completionContextSchema.optional(),
  execution_action_id: z.string().uuid().optional(),
  organization_id: z.string().optional(),
});

/**
 * Schema for the `complete` command
 *
 * Syncs with: server.tool("complete", ...) in actions/lib/mcp/tools.ts:~745
 *
 * This schema validates the input to the `cg complete` command before calling the MCP server.
 * Field changes should be synchronized with the corresponding MCP tool definition.
 */
export const completeCommandSchema = z.object({
  action_id: z.string().uuid(),
  changelog_visibility: z.enum(['private', 'team', 'public']),
  technical_changes: technicalChangesSchema,
  outcomes: outcomesSchema,
  challenges: challengesSchema,
  git_context: gitContextSchema.optional(),
  execution_action_id: z.string().uuid().optional(),
  organization_id: z.string().optional(),
});

/**
 * Helper function to validate and format Zod errors
 */
export function formatZodError(error: z.ZodError): string {
  const errors = error.errors.map((err) => {
    const path = err.path.join('.');
    return `  - ${path}: ${err.message}`;
  });

  return `Validation failed:\n${errors.join('\n')}`;
}
