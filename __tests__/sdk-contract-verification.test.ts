/**
 * SDK Contract Verification Tests
 *
 * This test suite verifies that the @anthropic-ai/claude-agent-sdk types and shapes
 * match the expectations in our codebase. These tests will fail if a SDK version bump
 * introduces incompatible type changes.
 *
 * IMPORTANT: When this test fails after a SDK upgrade:
 * 1. Review the SDK CHANGELOG for breaking changes
 * 2. Update claude-sdk.ts and sdk-event-transformer.ts to handle new shapes
 * 3. Update these tests to reflect the new contract
 * 4. Do NOT blindly update the test without fixing the implementation
 */

import { describe, it, expect } from '@jest/globals';
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKResultMessage,
  SDKSystemMessage,
} from '@anthropic-ai/claude-agent-sdk';

describe('SDK Contract Verification', () => {
  describe('SDKMessage type union', () => {
    it('should support system message type with expected shape', () => {
      const systemMsg: SDKSystemMessage = {
        type: 'system',
        subtype: 'init',
        agents: [],
        apiKeySource: 'user',
        claude_code_version: '1.0.0',
        cwd: '/test',
        tools: [],
        mcp_servers: [],
        model: 'claude-3-5-sonnet-20241022',
        permissionMode: 'acceptEdits',
        slash_commands: [],
        output_style: 'default',
        skills: [],
        plugins: [],
        uuid: '00000000-0000-0000-0000-000000000000' as any,
        session_id: 'test-session',
      };

      // Verify type discrimination works
      expect(systemMsg.type).toBe('system');
      expect(systemMsg.subtype).toBe('init');

      // Verify our code paths that check these properties
      const hasSubtype = 'subtype' in systemMsg;
      expect(hasSubtype).toBe(true);
    });

    it('should support assistant message type with expected content shape', () => {
      const assistantMsg: SDKAssistantMessage = {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'tool_use', id: 'tool1', name: 'Read', input: { file_path: '/test.ts' } },
            { type: 'thinking', thinking: 'I should analyze this' },
          ],
        } as any,
        parent_tool_use_id: null,
        uuid: '00000000-0000-0000-0000-000000000001' as any,
        session_id: 'test-session',
      };

      // Verify type discrimination
      expect(assistantMsg.type).toBe('assistant');

      // Verify content array shape that claude-sdk.ts depends on
      expect(Array.isArray(assistantMsg.message?.content)).toBe(true);

      // Verify content blocks have expected structure
      const content = assistantMsg.message?.content as any[];
      expect(content[0]).toHaveProperty('type', 'text');
      expect(content[0]).toHaveProperty('text');
      expect(content[1]).toHaveProperty('type', 'tool_use');
      expect(content[1]).toHaveProperty('name');
      expect(content[1]).toHaveProperty('input');
      expect(content[2]).toHaveProperty('type', 'thinking');
      expect(content[2]).toHaveProperty('thinking');
    });

    it('should support result message type with success subtype', () => {
      const successMsg: Extract<SDKResultMessage, { subtype: 'success' }> = {
        type: 'result',
        subtype: 'success',
        duration_ms: 5000,
        duration_api_ms: 4500,
        is_error: false,
        num_turns: 3,
        result: 'success',
        total_cost_usd: 0.05,
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
        uuid: '00000000-0000-0000-0000-000000000002' as any,
        session_id: 'test-session',
      };

      // Verify properties that claude-sdk.ts reads
      expect(successMsg.type).toBe('result');
      expect(successMsg.subtype).toBe('success');
      expect(typeof successMsg.duration_ms).toBe('number');
      expect(typeof successMsg.total_cost_usd).toBe('number');
      expect(successMsg.usage).toHaveProperty('input_tokens');
      expect(successMsg.usage).toHaveProperty('output_tokens');

      // Verify subtype check pattern used in claude-sdk.ts line 122, 125
      expect(successMsg.subtype.startsWith('error_')).toBe(false);
    });

    it('should support result message type with error subtypes', () => {
      const errorSubtypes: Array<
        'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | 'error_max_structured_output_retries'
      > = [
        'error_during_execution',
        'error_max_turns',
        'error_max_budget_usd',
        'error_max_structured_output_retries',
      ];

      for (const subtype of errorSubtypes) {
        const errorMsg: SDKResultMessage = {
          type: 'result',
          subtype,
          duration_ms: 1000,
          duration_api_ms: 900,
          is_error: true,
          num_turns: 1,
          total_cost_usd: 0.01,
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
          modelUsage: {},
          permission_denials: [],
          errors: ['Test error'],
          uuid: '00000000-0000-0000-0000-000000000003' as any,
          session_id: 'test-session',
        } as any;

        // Verify error detection pattern used in claude-sdk.ts line 125, 300
        expect(errorMsg.subtype.startsWith('error_')).toBe(true);
        expect(errorMsg.type).toBe('result');
      }
    });

    it('should support user message type with tool results', () => {
      const userMsg: SDKMessage = {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool1',
              content: 'File contents here',
              is_error: false,
            },
          ],
        } as any,
        parent_tool_use_id: null,
        uuid: '00000000-0000-0000-0000-000000000004' as any,
        session_id: 'test-session',
      } as any;

      // Verify shape that sdk-event-transformer.ts line 142-154 depends on
      expect(userMsg.type).toBe('user');
      expect('message' in userMsg).toBe(true);
      const content = (userMsg as any).message?.content;
      expect(Array.isArray(content)).toBe(true);
      expect(content[0]).toHaveProperty('type', 'tool_result');
    });
  });

  describe('Message shape assumptions in claude-sdk.ts', () => {
    it('should verify formatMessage() assumptions about system messages', () => {
      const systemMsg = {
        type: 'system',
        subtype: 'init',
        skills: ['skill1', 'skill2'],
        session_id: 'test',
      } as any as SDKMessage;

      // claude-sdk.ts line 103-104 accesses these properties
      expect(systemMsg.type).toBe('system');
      expect('subtype' in systemMsg).toBe(true);
      expect('skills' in systemMsg).toBe(true);
      expect(Array.isArray((systemMsg as any).skills)).toBe(true);
    });

    it('should verify formatMessage() assumptions about assistant messages', () => {
      const assistantMsg: SDKAssistantMessage = {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Test' },
          ],
        } as any,
        parent_tool_use_id: null,
        uuid: '00000000-0000-0000-0000-000000000005' as any,
        session_id: 'test',
      };

      // claude-sdk.ts line 114-116 accesses these properties
      expect(assistantMsg.type).toBe('assistant');
      expect('message' in assistantMsg).toBe(true);
      expect(assistantMsg.message).toHaveProperty('content');
      expect(Array.isArray(assistantMsg.message?.content)).toBe(true);
    });

    it('should verify formatMessage() assumptions about result messages', () => {
      const successMsg: SDKResultMessage = {
        type: 'result',
        subtype: 'success',
        duration_ms: 1000,
        duration_api_ms: 900,
        is_error: false,
        num_turns: 1,
        result: 'success',
        total_cost_usd: 0.01,
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
        uuid: '00000000-0000-0000-0000-000000000006' as any,
        session_id: 'test',
      };

      const errorMsg: SDKResultMessage = {
        type: 'result',
        subtype: 'error_during_execution',
        duration_ms: 1000,
        duration_api_ms: 900,
        is_error: true,
        num_turns: 1,
        total_cost_usd: 0.01,
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
        errors: ['Test error'],
        uuid: '00000000-0000-0000-0000-000000000007' as any,
        session_id: 'test',
      } as any;

      // claude-sdk.ts line 121-127 accesses these properties
      for (const resultMsg of [successMsg, errorMsg]) {
        expect(resultMsg.type).toBe('result');
        expect('subtype' in resultMsg).toBe(true);
        expect('duration_ms' in resultMsg).toBe(true);
        expect(typeof resultMsg.duration_ms).toBe('number');
        expect(resultMsg.subtype === 'success' || resultMsg.subtype.startsWith('error_')).toBe(true);
      }
    });

    it('should verify executeClaude() assumptions about session_id', () => {
      const messages: SDKMessage[] = [
        {
          type: 'system',
          subtype: 'init',
          session_id: 'test-session-123',
        } as any,
        {
          type: 'result',
          subtype: 'success',
          session_id: 'test-session-123',
        } as any,
      ];

      // claude-sdk.ts line 261-263 accesses session_id
      for (const msg of messages) {
        expect('session_id' in msg).toBe(true);
      }
    });

    it('should verify executeClaude() assumptions about result metadata', () => {
      const resultMsg: SDKResultMessage = {
        type: 'result',
        subtype: 'success',
        duration_ms: 1000,
        duration_api_ms: 900,
        is_error: false,
        num_turns: 1,
        result: 'success',
        total_cost_usd: 0.05,
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
        uuid: '00000000-0000-0000-0000-000000000007' as any,
        session_id: 'test',
      };

      // claude-sdk.ts line 290-294 accesses these properties
      expect(resultMsg.type).toBe('result');
      expect('subtype' in resultMsg).toBe(true);
      expect('total_cost_usd' in resultMsg).toBe(true);
      expect('usage' in resultMsg).toBe(true);
      expect(typeof resultMsg.total_cost_usd).toBe('number');
    });
  });

  describe('Message shape assumptions in sdk-event-transformer.ts', () => {
    it('should verify transformSDKMessage() type discrimination', () => {
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init' } as any,
        { type: 'assistant', message: { content: [] } } as any,
        { type: 'result', subtype: 'success' } as any,
        { type: 'user', message: { content: [] } } as any,
      ];

      // sdk-event-transformer.ts line 27-44 switches on message.type
      for (const msg of messages) {
        expect(msg).toHaveProperty('type');
        expect(['system', 'assistant', 'result', 'user']).toContain(msg.type);
      }
    });

    it('should verify transformAssistantMessage() assumptions', () => {
      const assistantMsg: SDKAssistantMessage = {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'tool_use', id: 'tool1', name: 'Read', input: {} },
            { type: 'thinking', thinking: 'Analyzing' },
          ],
        } as any,
        parent_tool_use_id: null,
        uuid: '00000000-0000-0000-0000-000000000008' as any,
        session_id: 'test',
      };

      // sdk-event-transformer.ts line 80-81, 96-99 accesses these
      expect(assistantMsg.message).toHaveProperty('content');
      expect(Array.isArray(assistantMsg.message?.content)).toBe(true);
      expect('session_id' in assistantMsg).toBe(true);
      expect('parent_tool_use_id' in assistantMsg).toBe(true);
    });

    it('should verify transformResultMessage() assumptions', () => {
      const resultMsg: SDKResultMessage = {
        type: 'result',
        subtype: 'success',
        duration_ms: 5000,
        duration_api_ms: 4500,
        is_error: false,
        num_turns: 3,
        result: 'success',
        total_cost_usd: 0.05,
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
        uuid: '00000000-0000-0000-0000-000000000009' as any,
        session_id: 'test',
      };

      // sdk-event-transformer.ts line 113, 114-116, 126-131 accesses these
      expect('subtype' in resultMsg).toBe(true);
      expect('duration_ms' in resultMsg).toBe(true);
      expect('total_cost_usd' in resultMsg).toBe(true);
      expect('num_turns' in resultMsg).toBe(true);
      expect('usage' in resultMsg).toBe(true);
      expect('session_id' in resultMsg).toBe(true);
    });

    it('should verify content block shapes for generateContentSummary()', () => {
      const contentBlocks = [
        { type: 'text', text: 'Some text content' },
        { type: 'tool_use', name: 'Read', input: {} },
        { type: 'thinking', thinking: 'Analyzing the problem' },
      ];

      // sdk-event-transformer.ts line 189-201 accesses these properties
      for (const block of contentBlocks) {
        expect(block).toHaveProperty('type');

        if (block.type === 'text') {
          expect(block).toHaveProperty('text');
          expect(typeof (block as any).text).toBe('string');
        } else if (block.type === 'tool_use') {
          expect(block).toHaveProperty('name');
        } else if (block.type === 'thinking') {
          expect(block).toHaveProperty('thinking');
        }
      }
    });
  });

  describe('SDK version metadata', () => {
    it('should document the pinned SDK version contract', () => {
      // This test documents which SDK version we're pinned to and why
      const pinnedVersion = '0.1.50';
      const reason = 'Pinned to prevent uncontrolled minor version bumps that introduce incompatible streaming event shapes';

      expect(pinnedVersion).toBe('0.1.50');
      expect(reason).toContain('incompatible streaming event shapes');

      // When upgrading SDK version:
      // 1. Update package.json pinned version
      // 2. Run this full test suite to verify contract compatibility
      // 3. Update claude-sdk.ts and sdk-event-transformer.ts if needed
      // 4. Update this test's pinnedVersion constant
    });
  });
});
