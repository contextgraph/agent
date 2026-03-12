/**
 * Logging Schema - Zod validation schemas for structured logging
 *
 * This module provides:
 * - Type-safe log event schemas aligned with Axiom best practices
 * - Validation utilities to ensure logging consistency
 * - Standardized field names and types for queryability
 *
 * See docs/LOGGING_SCHEMA.md for complete field reference and usage examples.
 */

import { z } from 'zod';

/**
 * Log level enum - use consistently across all logs
 */
export const LogLevel = z.enum(['debug', 'info', 'warn', 'error']);
export type LogLevel = z.infer<typeof LogLevel>;

/**
 * Core context fields - should be included when available
 */
export const CoreContextSchema = z.object({
  timestamp: z.string().datetime().optional(), // ISO 8601 format
  level: LogLevel,
  service: z.string().optional(), // e.g., "agent", "steward"
  environment: z.string().optional(), // e.g., "production", "development"
});

/**
 * Operation context - identifies the operation being performed
 */
export const OperationContextSchema = z.object({
  operation: z.string(), // High-level operation name (required)
  request_id: z.string().optional(),
  session_id: z.string().optional(),
  run_id: z.string().uuid().optional(),
  action_id: z.string().uuid().optional(),
  steward_id: z.string().uuid().optional(),
});

/**
 * User/actor context - identifies who is performing the operation
 */
export const ActorContextSchema = z.object({
  user_id: z.string().optional(),
  organization_id: z.string().uuid().optional(),
  worker_id: z.string().optional(),
});

/**
 * Performance metrics - timing and resource usage
 */
export const PerformanceMetricsSchema = z.object({
  duration_ms: z.number().int().nonnegative().optional(),
  start_time: z.string().datetime().optional(),
  end_time: z.string().datetime().optional(),
});

/**
 * Error fields - structured error information
 */
export const ErrorFieldsSchema = z.object({
  error_code: z.string().optional(), // Machine-readable code
  error_message: z.string().optional(), // Human-readable message
  error_type: z.string().optional(), // Error class/type
  error_stack: z.string().optional(), // Stack trace (dev only)
  retry_count: z.number().int().nonnegative().optional(),
  is_retryable: z.boolean().optional(),
});

/**
 * HTTP/API fields - for external API calls
 */
export const HttpFieldsSchema = z.object({
  http_method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).optional(),
  http_status: z.number().int().min(100).max(599).optional(),
  http_path: z.string().optional(),
  http_url: z.string().url().optional(),
  response_size_bytes: z.number().int().nonnegative().optional(),
});

/**
 * LLM/AI fields - for LLM operations
 */
export const LlmFieldsSchema = z.object({
  model: z.string().optional(),
  provider: z.string().optional(), // e.g., "anthropic", "openai"
  token_count_input: z.number().int().nonnegative().optional(),
  token_count_output: z.number().int().nonnegative().optional(),
  cost_usd: z.number().nonnegative().optional(),
  num_turns: z.number().int().nonnegative().optional(),
});

/**
 * Git/repository fields - for version control context
 */
export const GitFieldsSchema = z.object({
  repository: z.string().optional(), // e.g., "contextgraph/agent"
  branch: z.string().optional(),
  commit_sha: z.string().optional(),
  pr_number: z.number().int().positive().optional(),
});

/**
 * Complete structured log event schema
 *
 * Combines all field categories into a comprehensive schema.
 * Use this for validating log events before emission.
 */
export const StructuredLogEventSchema = CoreContextSchema.merge(OperationContextSchema)
  .merge(ActorContextSchema)
  .merge(PerformanceMetricsSchema)
  .merge(ErrorFieldsSchema)
  .merge(HttpFieldsSchema)
  .merge(LlmFieldsSchema)
  .merge(GitFieldsSchema)
  .extend({
    message: z.string(), // Human-readable log message (required)
    // Allow arbitrary additional fields for extensibility
  })
  .passthrough();

export type StructuredLogEvent = z.infer<typeof StructuredLogEventSchema>;

/**
 * Validates a log event against the structured schema
 *
 * @param event - The log event to validate
 * @returns Validation result with typed data or error details
 *
 * @example
 * const result = validateLogEvent({
 *   level: 'info',
 *   operation: 'api_request',
 *   message: 'Request completed',
 *   http_method: 'GET',
 *   http_status: 200,
 *   duration_ms: 123,
 * });
 *
 * if (result.success) {
 *   console.log('Valid log event:', result.data);
 * } else {
 *   console.error('Invalid log event:', result.error.issues);
 * }
 */
export function validateLogEvent(
  event: unknown
): { success: true; data: StructuredLogEvent } | { success: false; error: z.ZodError } {
  const result = StructuredLogEventSchema.safeParse(event);
  if (result.success) {
    return { success: true, data: result.data };
  } else {
    return { success: false, error: result.error };
  }
}

/**
 * Creates a validated log event with timestamp
 *
 * This is a convenience helper that:
 * - Adds timestamp automatically
 * - Validates the event
 * - Returns a type-safe log event
 *
 * @param event - Partial log event (timestamp will be added)
 * @returns Validated log event with timestamp
 * @throws {Error} If validation fails
 *
 * @example
 * const logEvent = createLogEvent({
 *   level: 'info',
 *   operation: 'workspace_prep',
 *   message: 'Workspace preparation started',
 *   run_id: runId,
 *   action_id: actionId,
 * });
 */
export function createLogEvent(
  event: Omit<StructuredLogEvent, 'timestamp'> & { timestamp?: string }
): StructuredLogEvent {
  const eventWithTimestamp = {
    timestamp: new Date().toISOString(),
    ...event,
  };

  const result = validateLogEvent(eventWithTimestamp);
  if (!result.success) {
    const errorDetails = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
    throw new Error(`Invalid log event: ${errorDetails}`);
  }

  return result.data;
}

/**
 * Type guard to check if an object is a valid StructuredLogEvent
 *
 * @param obj - Object to check
 * @returns True if the object matches StructuredLogEvent schema
 */
export function isStructuredLogEvent(obj: unknown): obj is StructuredLogEvent {
  return validateLogEvent(obj).success;
}

/**
 * Helper to create an info-level log event
 */
export function logInfo(
  operation: string,
  message: string,
  fields?: Partial<StructuredLogEvent>
): StructuredLogEvent {
  return createLogEvent({
    level: 'info',
    operation,
    message,
    ...fields,
  });
}

/**
 * Helper to create a warn-level log event
 */
export function logWarn(
  operation: string,
  message: string,
  fields?: Partial<StructuredLogEvent>
): StructuredLogEvent {
  return createLogEvent({
    level: 'warn',
    operation,
    message,
    ...fields,
  });
}

/**
 * Helper to create an error-level log event
 */
export function logError(
  operation: string,
  message: string,
  error?: Error,
  fields?: Partial<StructuredLogEvent>
): StructuredLogEvent {
  return createLogEvent({
    level: 'error',
    operation,
    message,
    error_message: error?.message,
    error_type: error?.constructor?.name,
    error_stack: error?.stack,
    ...fields,
  });
}

/**
 * Constant field values for common use cases
 */
export const LoggingConstants = {
  SERVICE_AGENT: 'agent',
  SERVICE_STEWARD: 'steward',
  PROVIDER_ANTHROPIC: 'anthropic',
  PROVIDER_OPENAI: 'openai',
  ENV_PRODUCTION: 'production',
  ENV_DEVELOPMENT: 'development',
} as const;
