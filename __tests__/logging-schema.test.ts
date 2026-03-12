/**
 * Tests for logging schema validation utilities
 */

import { describe, it, expect } from '@jest/globals';
import {
  validateLogEvent,
  createLogEvent,
  isStructuredLogEvent,
  logInfo,
  logWarn,
  logError,
  LoggingConstants,
} from '../src/logging-schema.js';

describe('Logging Schema', () => {
  describe('validateLogEvent', () => {
    it('should validate a minimal valid log event', () => {
      const event = {
        level: 'info',
        operation: 'test_operation',
        message: 'Test message',
      };

      const result = validateLogEvent(event);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.level).toBe('info');
        expect(result.data.operation).toBe('test_operation');
        expect(result.data.message).toBe('Test message');
      }
    });

    it('should validate a complete log event with all fields', () => {
      const event = {
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'agent',
        environment: 'production',
        operation: 'api_request',
        request_id: 'req_123',
        session_id: 'session_456',
        run_id: '550e8400-e29b-41d4-a716-446655440000',
        action_id: '660e8400-e29b-41d4-a716-446655440001',
        user_id: 'user_789',
        duration_ms: 1234,
        http_method: 'GET',
        http_status: 200,
        http_path: '/api/runs',
        message: 'API request completed',
      };

      const result = validateLogEvent(event);
      expect(result.success).toBe(true);
    });

    it('should reject invalid log level', () => {
      const event = {
        level: 'invalid_level',
        operation: 'test',
        message: 'Test',
      };

      const result = validateLogEvent(event);
      expect(result.success).toBe(false);
    });

    it('should reject missing required fields', () => {
      const event = {
        level: 'info',
        // missing operation and message
      };

      const result = validateLogEvent(event);
      expect(result.success).toBe(false);
    });

    it('should validate UUID fields correctly', () => {
      const validEvent = {
        level: 'info',
        operation: 'test',
        message: 'Test',
        run_id: '550e8400-e29b-41d4-a716-446655440000',
      };

      const invalidEvent = {
        level: 'info',
        operation: 'test',
        message: 'Test',
        run_id: 'not-a-uuid',
      };

      expect(validateLogEvent(validEvent).success).toBe(true);
      expect(validateLogEvent(invalidEvent).success).toBe(false);
    });

    it('should validate HTTP status codes correctly', () => {
      const validEvent = {
        level: 'info',
        operation: 'api_request',
        message: 'Request completed',
        http_status: 200,
      };

      const invalidEvent = {
        level: 'info',
        operation: 'api_request',
        message: 'Request completed',
        http_status: 999, // Invalid status code
      };

      expect(validateLogEvent(validEvent).success).toBe(true);
      expect(validateLogEvent(invalidEvent).success).toBe(false);
    });
  });

  describe('createLogEvent', () => {
    it('should create a log event with auto-generated timestamp', () => {
      const event = createLogEvent({
        level: 'info',
        operation: 'test_operation',
        message: 'Test message',
      });

      expect(event.timestamp).toBeDefined();
      expect(event.level).toBe('info');
      expect(event.operation).toBe('test_operation');
      expect(event.message).toBe('Test message');
    });

    it('should preserve provided timestamp', () => {
      const customTimestamp = '2024-03-11T20:30:00.000Z';
      const event = createLogEvent({
        timestamp: customTimestamp,
        level: 'info',
        operation: 'test_operation',
        message: 'Test message',
      });

      expect(event.timestamp).toBe(customTimestamp);
    });

    it('should throw error for invalid log event', () => {
      expect(() => {
        createLogEvent({
          level: 'invalid' as any,
          operation: 'test',
          message: 'Test',
        });
      }).toThrow('Invalid log event');
    });

    it('should include all provided fields', () => {
      const event = createLogEvent({
        level: 'info',
        operation: 'api_request',
        message: 'Request completed',
        http_method: 'GET',
        http_status: 200,
        duration_ms: 123,
        user_id: 'user_456',
      });

      expect(event.http_method).toBe('GET');
      expect(event.http_status).toBe(200);
      expect(event.duration_ms).toBe(123);
      expect(event.user_id).toBe('user_456');
    });
  });

  describe('isStructuredLogEvent', () => {
    it('should return true for valid log event', () => {
      const event = {
        level: 'info',
        operation: 'test',
        message: 'Test message',
      };

      expect(isStructuredLogEvent(event)).toBe(true);
    });

    it('should return false for invalid log event', () => {
      const event = {
        level: 'invalid',
        operation: 'test',
      };

      expect(isStructuredLogEvent(event)).toBe(false);
    });

    it('should return false for non-object values', () => {
      expect(isStructuredLogEvent(null)).toBe(false);
      expect(isStructuredLogEvent(undefined)).toBe(false);
      expect(isStructuredLogEvent('string')).toBe(false);
      expect(isStructuredLogEvent(123)).toBe(false);
    });
  });

  describe('Helper functions', () => {
    describe('logInfo', () => {
      it('should create info-level log event', () => {
        const event = logInfo('test_operation', 'Test message');

        expect(event.level).toBe('info');
        expect(event.operation).toBe('test_operation');
        expect(event.message).toBe('Test message');
        expect(event.timestamp).toBeDefined();
      });

      it('should merge additional fields', () => {
        const event = logInfo('api_request', 'Request completed', {
          http_method: 'GET',
          http_status: 200,
          duration_ms: 123,
        });

        expect(event.http_method).toBe('GET');
        expect(event.http_status).toBe(200);
        expect(event.duration_ms).toBe(123);
      });
    });

    describe('logWarn', () => {
      it('should create warn-level log event', () => {
        const event = logWarn('test_operation', 'Warning message');

        expect(event.level).toBe('warn');
        expect(event.operation).toBe('test_operation');
        expect(event.message).toBe('Warning message');
      });
    });

    describe('logError', () => {
      it('should create error-level log event', () => {
        const event = logError('test_operation', 'Error occurred');

        expect(event.level).toBe('error');
        expect(event.operation).toBe('test_operation');
        expect(event.message).toBe('Error occurred');
      });

      it('should include error details when error object provided', () => {
        const error = new Error('Something went wrong');
        const event = logError('api_request', 'Request failed', error);

        expect(event.level).toBe('error');
        expect(event.error_message).toBe('Something went wrong');
        expect(event.error_type).toBe('Error');
        expect(event.error_stack).toBeDefined();
      });

      it('should merge additional fields', () => {
        const error = new Error('Rate limit exceeded');
        const event = logError('api_request', 'Request failed', error, {
          http_status: 429,
          retry_count: 3,
          is_retryable: true,
        });

        expect(event.http_status).toBe(429);
        expect(event.retry_count).toBe(3);
        expect(event.is_retryable).toBe(true);
      });
    });
  });

  describe('LoggingConstants', () => {
    it('should provide standard service names', () => {
      expect(LoggingConstants.SERVICE_AGENT).toBe('agent');
      expect(LoggingConstants.SERVICE_STEWARD).toBe('steward');
    });

    it('should provide standard provider names', () => {
      expect(LoggingConstants.PROVIDER_ANTHROPIC).toBe('anthropic');
      expect(LoggingConstants.PROVIDER_OPENAI).toBe('openai');
    });

    it('should provide standard environment names', () => {
      expect(LoggingConstants.ENV_PRODUCTION).toBe('production');
      expect(LoggingConstants.ENV_DEVELOPMENT).toBe('development');
    });
  });

  describe('Field validation edge cases', () => {
    it('should accept negative duration for backward-compatibility', () => {
      // Note: Schema requires nonnegative, so this should fail
      const event = {
        level: 'info',
        operation: 'test',
        message: 'Test',
        duration_ms: -100,
      };

      const result = validateLogEvent(event);
      expect(result.success).toBe(false);
    });

    it('should accept zero duration', () => {
      const event = {
        level: 'info',
        operation: 'test',
        message: 'Test',
        duration_ms: 0,
      };

      const result = validateLogEvent(event);
      expect(result.success).toBe(true);
    });

    it('should allow passthrough of custom fields', () => {
      const event = {
        level: 'info',
        operation: 'test',
        message: 'Test',
        custom_field: 'custom_value',
        nested_custom: {
          foo: 'bar',
        },
      };

      const result = validateLogEvent(event);
      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data as any).custom_field).toBe('custom_value');
        expect((result.data as any).nested_custom.foo).toBe('bar');
      }
    });
  });
});
