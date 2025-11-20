/**
 * Structured logging for workspace operations.
 *
 * Provides consistent, structured logging with error context,
 * performance metrics, and operational insights.
 */

import { WorkspaceError, getErrorCategory } from './errors.js';

/**
 * Log levels for filtering and prioritization.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Structured log entry.
 */
export interface LogEntry {
  /**
   * Log level.
   */
  level: LogLevel;

  /**
   * Timestamp (ISO 8601).
   */
  timestamp: string;

  /**
   * Log message.
   */
  message: string;

  /**
   * Operation or context identifier.
   */
  operation?: string;

  /**
   * Repository URL (if applicable).
   */
  repositoryUrl?: string;

  /**
   * Workspace path (if applicable).
   */
  workspacePath?: string;

  /**
   * Error details (if logging an error).
   */
  error?: {
    name: string;
    message: string;
    category: string;
    recoverable: boolean;
    stack?: string;
  };

  /**
   * Performance metrics (if applicable).
   */
  metrics?: {
    durationMs?: number;
    sizeBytes?: number;
    [key: string]: any;
  };

  /**
   * Additional context.
   */
  context?: Record<string, any>;
}

/**
 * Logger configuration.
 */
export interface LoggerConfig {
  /**
   * Minimum log level to output.
   * Default: 'info'
   */
  minLevel: LogLevel;

  /**
   * Whether to include stack traces in error logs.
   * Default: true
   */
  includeStackTraces: boolean;

  /**
   * Custom log output function.
   * Default: console.log with JSON stringification
   */
  output?: (entry: LogEntry) => void;
}

/**
 * Default logger configuration.
 */
const DEFAULT_CONFIG: LoggerConfig = {
  minLevel: 'info',
  includeStackTraces: true,
  output: (entry: LogEntry) => {
    console.log(JSON.stringify(entry));
  },
};

/**
 * Log level priority for filtering.
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Workspace logger with structured output.
 */
export class WorkspaceLogger {
  private config: LoggerConfig;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Logs a debug message.
   */
  debug(message: string, context?: Record<string, any>): void {
    this.log('debug', message, { context });
  }

  /**
   * Logs an info message.
   */
  info(message: string, context?: Record<string, any>): void {
    this.log('info', message, { context });
  }

  /**
   * Logs a warning message.
   */
  warn(message: string, context?: Record<string, any>): void {
    this.log('warn', message, { context });
  }

  /**
   * Logs an error.
   */
  error(message: string, error?: Error, context?: Record<string, any>): void {
    this.log('error', message, { error, context });
  }

  /**
   * Logs the start of an operation.
   */
  operationStart(operation: string, context?: Record<string, any>): OperationLogger {
    this.info(`Starting ${operation}`, context);
    return new OperationLogger(this, operation, context);
  }

  /**
   * Internal log method.
   */
  private log(
    level: LogLevel,
    message: string,
    options: {
      operation?: string;
      repositoryUrl?: string;
      workspacePath?: string;
      error?: Error;
      metrics?: Record<string, any>;
      context?: Record<string, any>;
    } = {}
  ): void {
    // Check if this log level should be output
    if (
      LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.config.minLevel]
    ) {
      return;
    }

    const entry: LogEntry = {
      level,
      timestamp: new Date().toISOString(),
      message,
      operation: options.operation,
      repositoryUrl: options.repositoryUrl,
      workspacePath: options.workspacePath,
      context: options.context,
      metrics: options.metrics,
    };

    // Add error details if present
    if (options.error) {
      const error = options.error;
      entry.error = {
        name: error.name,
        message: error.message,
        category: getErrorCategory(error),
        recoverable: error instanceof WorkspaceError ? error.recoverable : false,
      };

      if (this.config.includeStackTraces && error.stack) {
        entry.error.stack = error.stack;
      }
    }

    // Output the log entry
    if (this.config.output) {
      this.config.output(entry);
    }
  }
}

/**
 * Operation-scoped logger for tracking operation lifecycle.
 */
export class OperationLogger {
  private startTime: number;

  constructor(
    private logger: WorkspaceLogger,
    private operation: string,
    private context?: Record<string, any>
  ) {
    this.startTime = Date.now();
  }

  /**
   * Logs operation success.
   */
  success(message?: string, metrics?: Record<string, any>): void {
    const durationMs = Date.now() - this.startTime;
    this.logger.info(message || `${this.operation} completed successfully`, {
      ...this.context,
      metrics: { ...metrics, durationMs },
    });
  }

  /**
   * Logs operation failure.
   */
  failure(error: Error, message?: string): void {
    const durationMs = Date.now() - this.startTime;
    this.logger.error(
      message || `${this.operation} failed`,
      error,
      { ...this.context, metrics: { durationMs } }
    );
  }

  /**
   * Logs operation progress.
   */
  progress(message: string, context?: Record<string, any>): void {
    this.logger.debug(`${this.operation}: ${message}`, {
      ...this.context,
      ...context,
    });
  }
}

/**
 * Global logger instance (can be replaced for testing).
 */
let globalLogger = new WorkspaceLogger();

/**
 * Gets the global logger instance.
 */
export function getLogger(): WorkspaceLogger {
  return globalLogger;
}

/**
 * Sets the global logger instance.
 */
export function setLogger(logger: WorkspaceLogger): void {
  globalLogger = logger;
}

/**
 * Configures the global logger.
 */
export function configureLogger(config: Partial<LoggerConfig>): void {
  globalLogger = new WorkspaceLogger(config);
}

/**
 * Convenience functions using global logger.
 */

export function debug(message: string, context?: Record<string, any>): void {
  globalLogger.debug(message, context);
}

export function info(message: string, context?: Record<string, any>): void {
  globalLogger.info(message, context);
}

export function warn(message: string, context?: Record<string, any>): void {
  globalLogger.warn(message, context);
}

export function error(
  message: string,
  err?: Error,
  context?: Record<string, any>
): void {
  globalLogger.error(message, err, context);
}

export function operationStart(
  operation: string,
  context?: Record<string, any>
): OperationLogger {
  return globalLogger.operationStart(operation, context);
}

/**
 * Example usage for common workspace operations.
 */

/**
 * Logs a clone operation with structured context.
 */
export function logCloneOperation(
  repositoryUrl: string,
  workspacePath: string
): OperationLogger {
  return operationStart('clone', { repositoryUrl, workspacePath });
}

/**
 * Logs an update operation with structured context.
 */
export function logUpdateOperation(
  repositoryUrl: string,
  workspacePath: string
): OperationLogger {
  return operationStart('update', { repositoryUrl, workspacePath });
}

/**
 * Logs a cleanup operation with structured context.
 */
export function logCleanupOperation(workspacePath: string): OperationLogger {
  return operationStart('cleanup', { workspacePath });
}
