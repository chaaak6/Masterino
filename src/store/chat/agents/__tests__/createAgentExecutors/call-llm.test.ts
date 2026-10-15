import { type GeneralAgentCallLLMResultPayload } from '@lobechat/agent-runtime';
import { LOADING_FLAT } from '@lobechat/const';
import { countContextTokens } from '@lobechat/context-engine';
import type { MessageToolCall } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import { createAgentExecutors } from '@/store/chat/agents/createAgentExecutors';

import {
  createAssistantMessage,
  createCallLLMInstruction,
  createMockStore,
  createUserMessage,
} from './fixtures';
import {
  createInitialState,
  createTestContext,
  executeWithMockContext,
  expectMessageCreated,
  expectNextContext,
  expectValidExecutorResult,
} from './helpers';

// Mock external services at module level
vi.mock('@/services/chat', () => ({
  collectClientProviderMediaTokenEstimates: vi.fn(() => []),
  chatService: {
    createAssistantMessageStream: vi.fn(),
    getChatCompletion: vi.fn(),
  },
}));

vi.mock('@/services/message', () => ({
  messageService: {
    cancelCompression: vi.fn(),
    createCompressionGroup: vi.fn(),
    failCompression: vi.fn(),
    finalizeCompression: vi.fn(),
    updateMessage: vi.fn(),
  },
}));

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    currentActiveTopicSummary: vi.fn().mockReturnValue(undefined),
  },
}));

vi.mock('@/store/file/store', () => ({
  getFileStoreState: vi.fn().mockReturnValue({
    uploadBase64FileWithProgress: vi.fn().mockResolvedValue(null),
  }),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {},
}));

vi.mock('@/store/agent/store', () => ({
  getAgentStoreState: vi.fn().mockReturnValue({}),
}));

/**
 * Helper to mock chatService.createAssistantMessageStream
 * Simulates streaming by calling onMessageHandle with chunks then onFinish
 */
const mockStreamResponse = (response: {
  content?: string;
  finishType?: string;
  tool_calls?: MessageToolCall[];
  usage?: any;
}) => {
  const { content = '', finishType = 'stop', tool_calls, usage } = response;

  vi.mocked(chatService.createAssistantMessageStream).mockImplementation(async (params: any) => {
    // Simulate text streaming
    if (content && params.onMessageHandle) {
      await params.onMessageHandle({ type: 'text', text: content });
    }

    // Simulate tool call streaming
    if (tool_calls && params.onMessageHandle) {
      await params.onMessageHandle({
        isAnimationActives: tool_calls.map(() => true),
        tool_calls,
        type: 'tool_calls',
      });
    }

    // Simulate finish
    if (params.onFinish) {
      await params.onFinish(content, {
        toolCalls: tool_calls,
        type: finishType,
        usage,
      });
    }
  });
};

describe('call_llm executor', () => {
  it('Given a failed model stream, Then the run fails without executing partial tool calls', async () => {
    const mockStore = createMockStore();
    const context = createTestContext();
    mockStore.dbMessagesMap[context.messageKey] = [];
    mockStreamResponse({ content: '<html>partial', finishType: 'error' });
    const result = await executeWithMockContext({
      context,
      executor: 'call_llm',
      instruction: createCallLLMInstruction(),
      mockStore,
      state: createInitialState(),
    });
    expect(result.newState.status).toBe('error');
    expect(result.nextContext?.phase).not.toBe('llm_result');
  });
  it.each(['text', 'reasoning', 'tool_calls'])(
    'Given a recovered %s stream, Then the retry hint clears before completion',
    async (type) => {
      const mockStore = createMockStore();
      const context = createTestContext();
      mockStore.dbMessagesMap[context.messageKey] = [];
      vi.mocked(chatService.createAssistantMessageStream).mockImplementation(
        async (params: any) => {
          await params.recovery.onRetry({
            attempt: 1,
            maxAttempts: 3,
            offline: false,
            delayMs: 1000,
          });
          expect(mockStore.operations[context.operationId].metadata.streamRecovery).toBeDefined();
          params.recovery.onRecovered();
          await params.onMessageHandle(
            type === 'tool_calls'
              ? { type, tool_calls: [], isAnimationActives: [] }
              : { type, text: 'Recovered output' },
          );
          expect(mockStore.operations[context.operationId].metadata.streamRecovery).toBeUndefined();
          expect(mockStore.operations[context.operationId].status).toBe('running');
          await params.onFinish('Recovered output', { type: 'done' });
        },
      );
      await executeWithMockContext({
        context,
        executor: 'call_llm',
        instruction: createCallLLMInstruction(),
        mockStore,
        state: createInitialState(),
      });
    },
  );

  it('Given a retry followed by an unexpected stream rejection, Then recovery metadata is cleared', async () => {
    const mockStore = createMockStore();
    const context = createTestContext();
    mockStore.dbMessagesMap[context.messageKey] = [];
    vi.mocked(chatService.createAssistantMessageStream).mockImplementation(async (params: any) => {
      await params.recovery.onRetry({ attempt: 2, maxAttempts: 3, offline: false, delayMs: 3000 });
      throw new Error('stream callback failed');
    });
    await expect(
      executeWithMockContext({
        context,
        executor: 'call_llm',
        instruction: createCallLLMInstruction(),
        mockStore,
        state: createInitialState(),
      }),
    ).rejects.toThrow('stream callback failed');
    expect(mockStore.operations[context.operationId].metadata.streamRecovery).toBeUndefined();
  });

  describe('Basic Behavior', () => {
    it('should create assistant message with LOADING_FLAT content', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({ agentId: 'test-session', topicId: 'test-topic' });
      const instruction = createCallLLMInstruction({
        model: 'gpt-4',
        provider: 'openai',
        messages: [createUserMessage()],
      });
      const state = createInitialState({ operationId: 'test-session' });

      mockStreamResponse({ content: 'AI response' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expectMessageCreated(mockStore, 'assistant');
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'test-session',
          content: LOADING_FLAT,
          role: 'assistant',
          model: 'gpt-4',
          provider: 'openai',
          topicId: 'test-topic',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should call chatService.createAssistantMessageStream with correct params', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const userMsg = createUserMessage({ content: 'Hello' });
      const instruction = createCallLLMInstruction({
        model: 'gpt-4',
        provider: 'openai',
        messages: [userMsg],
      });
      const state = createInitialState();

      mockStreamResponse({ content: 'AI response' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(chatService.createAssistantMessageStream).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            model: 'gpt-4',
            provider: 'openai',
          }),
        }),
      );
    });

    it('discards partial content and stale tools before a context-compression retry', async () => {
      const mockStore = createMockStore();
      const context = createTestContext();
      mockStore.dbMessagesMap[context.messageKey] = [];
      const staleTool: MessageToolCall = {
        function: { arguments: '{"path":"stale"}', name: 'filesystem____write' },
        id: 'stale-tool',
        type: 'function',
      };

      vi.mocked(chatService.createAssistantMessageStream).mockImplementation(
        async (params: any) => {
          await params.onMessageHandle?.({ text: 'stale partial', type: 'text' });
          await params.onMessageHandle?.({ text: 'stale reasoning', type: 'reasoning' });
          await params.onMessageHandle?.({ tool_calls: [staleTool], type: 'tool_calls' });

          await params.contextBudget.onProviderAttemptDiscard({
            attempt: 1,
            error: { type: 'ExceededContextWindow' },
            willRetry: true,
          });

          await params.onMessageHandle?.({ text: 'final only', type: 'text' });
          await params.onFinish?.('final only', { type: 'stop' });
        },
      );

      const result = await executeWithMockContext({
        context,
        executor: 'call_llm',
        instruction: createCallLLMInstruction({
          messages: [createUserMessage()],
          model: 'gpt-4',
          provider: 'openai',
        }),
        mockStore,
        state: createInitialState({ operationId: context.operationId }),
      });

      const payload = result.nextContext!.payload as GeneralAgentCallLLMResultPayload;
      expect(payload).toMatchObject({
        hasToolsCalling: false,
        result: { content: 'final only', tool_calls: undefined },
        toolsCalling: [],
      });
      expect(JSON.stringify(payload)).not.toContain('stale');
      expect(mockStore.optimisticUpdateMessageContent).toHaveBeenCalledWith(
        expect.any(String),
        'final only',
        expect.objectContaining({ tools: undefined }),
        expect.anything(),
      );
      expect(mockStore.internal_dispatchMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'updateMessage',
          value: expect.objectContaining({ content: '', tools: undefined }),
        }),
        expect.anything(),
      );
    });

    it('should forward request metadata to chatService', async () => {
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction({
        messages: [createUserMessage({ content: 'Hello' })],
      });
      const state = createInitialState();

      mockStreamResponse({ content: 'AI response' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        metadata: { trigger: RequestTrigger.Onboarding },
        state,
        mockStore,
        context,
      });

      expect(chatService.createAssistantMessageStream).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { trigger: RequestTrigger.Onboarding },
        }),
      );
    });

    it('should merge activated tools even when selectedTools are provided', async () => {
      const mockStore = createMockStore();
      const context = createTestContext();
      const userMsg = createUserMessage({ content: 'Use notebook' });
      const instruction = createCallLLMInstruction({
        model: 'gpt-4',
        provider: 'openai',
        messages: [userMsg],
      });
      const state = createInitialState();
      const notebookTool = {
        function: { name: 'lobe-notebook____createDocument' },
        type: 'function',
      } as const;
      const activatedTool = {
        function: { name: 'lobe-skills____runSkill' },
        type: 'function',
      } as const;
      const toolsEngine = {
        generateToolsDetailed: vi.fn().mockReturnValue({
          enabledManifests: [{ identifier: 'lobe-skills' }],
          enabledToolIds: ['lobe-skills'],
          tools: [activatedTool],
        }),
      };

      mockStreamResponse({ content: 'AI response' });
      mockStore.dbMessagesMap[context.messageKey] = [];
      mockStore.operations[context.operationId] = {
        abortController: new AbortController(),
        childOperationIds: [],
        context: {
          agentId: context.agentId,
          messageId: context.parentId,
          topicId: context.topicId,
        },
        id: context.operationId,
        metadata: { startTime: Date.now() },
        status: 'running',
        type: 'execAgentRuntime',
      } as any;

      const executors = createAgentExecutors({
        agentConfig: {
          agentConfig: { model: 'gpt-4', provider: 'openai' } as any,
          chatConfig: {} as any,
          enabledManifests: [{ identifier: 'lobe-notebook' }] as any,
          enabledToolIds: ['lobe-notebook'],
          isBuiltinAgent: false,
          plugins: ['lobe-notebook'],
          tools: [notebookTool] as any,
        },
        get: () => mockStore,
        messageKey: context.messageKey,
        operationId: context.operationId,
        parentId: context.parentId,
        toolsEngine: toolsEngine as any,
      });

      await executors.call_llm!(instruction, state, {
        initialContext: {
          selectedTools: [{ identifier: 'lobe-notebook', name: 'Notebook' }],
        },
        phase: 'init',
        stepContext: {
          activatedToolIds: ['lobe-skills', 'lobe-activator'],
        },
      } as any);

      expect(toolsEngine.generateToolsDetailed).toHaveBeenCalledWith(
        expect.objectContaining({
          skipDefaultTools: true,
          toolIds: ['lobe-skills', 'lobe-activator'],
        }),
      );
      expect(chatService.createAssistantMessageStream).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            resolvedAgentConfig: expect.objectContaining({
              enabledToolIds: ['lobe-notebook', 'lobe-skills'],
              tools: [notebookTool, activatedTool],
            }),
          }),
        }),
      );
    });

    it('should associate message with operation', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      mockStreamResponse({ content: 'AI response' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.associateMessageWithOperation).toHaveBeenCalledWith(
        expect.any(String),
        context.operationId,
      );
    });

    it('should return correct result structure with events and newState', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      mockStreamResponse({ content: 'AI response' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expectValidExecutorResult(result);
      expect(result.events).toEqual([]);
      expect(result.newState).toBeDefined();
      expect(result.nextContext).toBeDefined();
    });
  });

  describe('Skip Create First Message Mode', () => {
    it('should reuse parentId when skipCreateFirstMessage is true', async () => {
      // Given
      const mockStore = createMockStore();
      const parentId = 'msg_existing';
      const context = createTestContext({ parentId });
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      mockStreamResponse({ content: 'AI response' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
        skipCreateFirstMessage: true,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).not.toHaveBeenCalled();
      // The stream should still be called (message reuse doesn't skip LLM call)
      expect(chatService.createAssistantMessageStream).toHaveBeenCalled();
    });
  });

  describe('Parent Message ID Handling', () => {
    it('should use llmPayload.parentMessageId if provided', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({ parentId: 'msg_context_parent' });
      const instruction = createCallLLMInstruction({
        parentMessageId: 'msg_payload_parent',
      });
      const state = createInitialState();

      mockStreamResponse({ content: 'AI response' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          parentId: 'msg_payload_parent',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should fall back to context.parentId if parentMessageId not provided', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({ parentId: 'msg_context_parent' });
      const instruction = createCallLLMInstruction({
        parentMessageId: undefined,
      });
      const state = createInitialState();

      mockStreamResponse({ content: 'AI response' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          parentId: 'msg_context_parent',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });
  });

  describe('Usage Tracking', () => {
    it('should accumulate LLM usage from currentStepUsage', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction({
        model: 'gpt-4',
        provider: 'openai',
      });
      const state = createInitialState({
        usage: {
          humanInteraction: {
            approvalRequests: 0,
            promptRequests: 0,
            selectRequests: 0,
            totalWaitingTimeMs: 0,
          },
          llm: {
            apiCalls: 1,
            processingTimeMs: 0,
            tokens: {
              input: 100,
              output: 50,
              total: 150,
            },
          },
          tools: {
            byTool: [],
            totalCalls: 0,
            totalTimeMs: 0,
          },
        },
      });

      mockStreamResponse({
        content: 'AI response',
        usage: {
          totalInputTokens: 50,
          totalOutputTokens: 30,
          totalTokens: 80,
        },
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.newState.usage).toBeDefined();
      expect(result.newState.usage.llm.tokens.input).toBeGreaterThan(state.usage.llm.tokens.input);
      expect(result.newState.usage.llm.tokens.output).toBeGreaterThan(
        state.usage.llm.tokens.output,
      );
    });

    it('should update state.usage and state.cost correctly', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction({
        model: 'gpt-4',
        provider: 'openai',
      });
      const state = createInitialState({
        usage: {
          humanInteraction: {
            approvalRequests: 0,
            promptRequests: 0,
            selectRequests: 0,
            totalWaitingTimeMs: 0,
          },
          llm: {
            apiCalls: 0,
            processingTimeMs: 0,
            tokens: {
              input: 0,
              output: 0,
              total: 0,
            },
          },
          tools: {
            byTool: [],
            totalCalls: 0,
            totalTimeMs: 0,
          },
        },
      });

      mockStreamResponse({
        content: 'AI response',
        usage: {
          totalInputTokens: 100,
          totalOutputTokens: 50,
          totalTokens: 150,
          cost: 0.002,
        },
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.newState.usage).toBeDefined();
      expect(result.newState.cost).toBeDefined();
    });

    it('should handle no usage data returned', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      mockStreamResponse({ content: 'AI response', usage: undefined });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then - should preserve original usage
      expect(result.newState.usage).toEqual(state.usage);
    });
  });

  describe('Abort Handling', () => {
    it('should return nextContext with phase: human_abort when finishType is abort', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState({ stepCount: 3 });

      mockStreamResponse({ content: 'Partial response', finishType: 'abort' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expectNextContext(result, 'human_abort');
      expect(result.nextContext!.session!.status).toBe('running');
      expect(result.nextContext!.session!.stepCount).toBe(4);
    });

    it('should include correct payload with reason and result when aborted', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      mockStreamResponse({ content: 'Partial response', finishType: 'abort' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const payload = result.nextContext!.payload as GeneralAgentCallLLMResultPayload;
      expect(payload).toMatchObject({
        reason: 'user_cancelled',
        hasToolsCalling: false,
        result: {
          content: 'Partial response',
          tool_calls: undefined,
        },
      });
    });

    it('should include toolsCalling in abort payload when tools were being called', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      const toolCallsRaw: MessageToolCall[] = [
        {
          id: 'tool_1',
          type: 'function',
          function: {
            name: 'lobe-web-browsing____search',
            arguments: JSON.stringify({ query: 'test' }),
          },
        },
      ];

      mockStreamResponse({
        content: '',
        finishType: 'abort',
        tool_calls: toolCallsRaw,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const payload = result.nextContext!.payload as GeneralAgentCallLLMResultPayload;
      expect(payload).toMatchObject({
        reason: 'user_cancelled',
        hasToolsCalling: true,
      });
      expect(payload.toolsCalling.length).toBeGreaterThan(0);
    });

    it('should not throw error on abort', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      mockStreamResponse({ content: 'Partial', finishType: 'abort' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When & Then - should not throw
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      expect(result).toBeDefined();
      expect(result.nextContext!.phase).toBe('human_abort');
    });
  });

  describe('Normal Completion', () => {
    it('should return nextContext with phase: llm_result on normal completion', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      mockStreamResponse({ content: 'AI response' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expectNextContext(result, 'llm_result');
    });

    it('should include hasToolsCalling and result in llm_result payload', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      mockStreamResponse({ content: 'Here is the result' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const payload = result.nextContext!.payload as GeneralAgentCallLLMResultPayload;
      expect(payload).toMatchObject({
        hasToolsCalling: false,
        result: {
          content: 'Here is the result',
          tool_calls: undefined,
        },
      });
    });

    it('should include toolCalling when LLM returns tools', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      const toolCallsRaw: MessageToolCall[] = [
        {
          id: 'tool_1',
          type: 'function',
          function: {
            name: 'lobe-web-browsing____search',
            arguments: JSON.stringify({ query: 'AI news' }),
          },
        },
      ];

      mockStreamResponse({
        content: '',
        finishType: 'tool_calls',
        tool_calls: toolCallsRaw,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const payload = result.nextContext!.payload as GeneralAgentCallLLMResultPayload;
      expect(payload.hasToolsCalling).toBe(true);
      expect(payload.toolsCalling.length).toBeGreaterThan(0);
    });

    it('should increment stepCount', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState({ stepCount: 5 });

      mockStreamResponse({ content: 'AI response' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.nextContext!.session!.stepCount).toBe(6);
    });

    it('should include stepUsage in nextContext', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState({
        usage: {
          humanInteraction: {
            approvalRequests: 0,
            promptRequests: 0,
            selectRequests: 0,
            totalWaitingTimeMs: 0,
          },
          llm: {
            apiCalls: 0,
            processingTimeMs: 0,
            tokens: {
              input: 0,
              output: 0,
              total: 0,
            },
          },
          tools: {
            byTool: [],
            totalCalls: 0,
            totalTimeMs: 0,
          },
        },
      });

      const stepUsage = {
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
      };

      mockStreamResponse({ content: 'AI response', usage: stepUsage });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.nextContext!.stepUsage).toEqual(stepUsage);
    });
  });

  describe('State Management', () => {
    it('should update messages from dbMessagesMap', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState({ messages: [] });

      const updatedMessages = [
        createUserMessage({ content: 'Hello' }),
        createAssistantMessage({ content: 'Hi there' }),
      ];

      mockStreamResponse({ content: 'Hi there' });
      mockStore.dbMessagesMap[context.messageKey] = updatedMessages;

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.newState.messages).toEqual(updatedMessages);
    });

    it('should preserve other state fields', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState({
        operationId: 'test-session',
        stepCount: 10,
        status: 'running',
      });

      mockStreamResponse({ content: 'AI response' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.newState.operationId).toBe(state.operationId);
      expect(result.newState.stepCount).toBe(state.stepCount);
      expect(result.newState.status).toBe(state.status);
    });

    it('should not mutate original state', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState({
        messages: [createUserMessage()],
      });
      const originalState = structuredClone(state);

      mockStreamResponse({ content: 'AI response' });
      mockStore.dbMessagesMap[context.messageKey] = [createUserMessage(), createAssistantMessage()];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(state).toEqual(originalState);
      expect(result.newState).not.toBe(state);
    });
  });

  describe('Edge Cases', () => {
    it('should throw error when message creation fails', async () => {
      // Given
      const mockStore = createMockStore({
        optimisticCreateMessage: vi.fn().mockResolvedValue(null),
      });
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      // When & Then
      await expect(
        executeWithMockContext({
          executor: 'call_llm',
          instruction,
          state,
          mockStore,
          context,
        }),
      ).rejects.toThrow('Failed to create assistant message');
    });

    it('should handle empty messages array', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction({
        messages: [],
      });
      const state = createInitialState();

      mockStreamResponse({ content: 'AI response' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(chatService.createAssistantMessageStream).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            messages: [],
          }),
        }),
      );
      expect(result).toBeDefined();
    });

    it('should handle multiple tools returned', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      const toolCallsRaw: MessageToolCall[] = [
        {
          id: 'tool_1',
          type: 'function',
          function: {
            name: 'lobe-web-browsing____search',
            arguments: JSON.stringify({ query: 'AI' }),
          },
        },
        {
          id: 'tool_2',
          type: 'function',
          function: {
            name: 'lobe-web-browsing____craw',
            arguments: JSON.stringify({ url: 'https://example.com' }),
          },
        },
        {
          id: 'tool_3',
          type: 'function',
          function: {
            name: 'lobe-image-generator____generate',
            arguments: JSON.stringify({ prompt: 'AI art' }),
          },
        },
      ];

      mockStreamResponse({
        content: '',
        finishType: 'tool_calls',
        tool_calls: toolCallsRaw,
      });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      const payload = result.nextContext!.payload as GeneralAgentCallLLMResultPayload;
      expect(payload.toolsCalling).toHaveLength(3);
      expect(payload.hasToolsCalling).toBe(true);
    });

    it('should handle empty dbMessagesMap', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState({ messages: [createUserMessage()] });

      mockStreamResponse({ content: 'AI response' });
      // dbMessagesMap[messageKey] doesn't exist

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then - should default to empty array
      expect(result.newState.messages).toEqual([]);
    });
  });

  describe('Message Filtering', () => {
    it('should exclude assistant message from messages sent to LLM', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();

      const userMsg = createUserMessage({ id: 'msg_user', content: 'Hello' });
      const assistantMsg = createAssistantMessage({ id: 'msg_assistant', content: 'Loading...' });

      const instruction = createCallLLMInstruction({
        messages: [userMsg, assistantMsg],
      });
      const state = createInitialState();

      mockStore.optimisticCreateMessage = vi.fn().mockResolvedValue({
        id: 'msg_assistant',
        role: 'assistant',
        content: LOADING_FLAT,
      });
      mockStreamResponse({ content: 'AI response' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then - should filter out the assistant message with matching ID
      expect(chatService.createAssistantMessageStream).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            messages: expect.not.arrayContaining([
              expect.objectContaining({ id: 'msg_assistant' }),
            ]),
          }),
        }),
      );
    });
  });

  describe('Different Model Configurations', () => {
    it('should handle different model and provider combinations', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction({
        model: 'claude-3-opus',
        provider: 'anthropic',
      });
      const state = createInitialState();

      mockStreamResponse({ content: 'Claude response' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-3-opus',
          provider: 'anthropic',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
      expect(chatService.createAssistantMessageStream).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            model: 'claude-3-opus',
            provider: 'anthropic',
          }),
        }),
      );
    });
  });

  describe('Context Propagation', () => {
    it('should include correct messageCount in nextContext', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      const messages = [
        createUserMessage(),
        createAssistantMessage(),
        createUserMessage(),
        createAssistantMessage(),
      ];

      mockStreamResponse({ content: 'AI response' });
      mockStore.dbMessagesMap[context.messageKey] = messages;

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.nextContext!.session!.messageCount).toBe(4);
    });

    it('should preserve sessionId in nextContext', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState({ operationId: 'custom-session-123' });

      mockStreamResponse({ content: 'AI response' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      const result = await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(result.nextContext!.session!.sessionId).toBe('custom-session-123');
    });
  });

  describe('Thread Support', () => {
    it('should handle threadId when provided in operation context', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({ agentId: 'test-session', topicId: 'test-topic' });
      const threadId = 'thread_123';

      // Setup operation with threadId
      mockStore.operations[context.operationId] = {
        id: context.operationId,
        type: 'execAgentRuntime',
        status: 'running',
        context: {
          agentId: 'test-session',
          topicId: 'test-topic',
          threadId,
        },
        abortController: new AbortController(),
        metadata: { startTime: Date.now() },
        childOperationIds: [],
      };

      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      mockStreamResponse({ content: 'AI response' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId,
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should handle undefined threadId', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      mockStreamResponse({ content: 'AI response' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: undefined,
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });
  });

  describe('Group Orchestration: subAgentId Support', () => {
    it('should use subAgentId for message.agentId when present in operation context', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({
        agentId: 'supervisor-agent', // Main agent (supervisor)
        scope: 'group_agent',
        subAgentId: 'worker-agent', // Actual executing agent
        topicId: 'group-topic',
      });
      const instruction = createCallLLMInstruction({
        model: 'gpt-4',
        provider: 'openai',
        messages: [createUserMessage()],
      });
      const state = createInitialState({ operationId: context.operationId });

      mockStreamResponse({ content: 'AI response from worker agent' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'worker-agent',
          role: 'assistant',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should fall back to agentId when subAgentId is not present', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({
        agentId: 'normal-agent',
        topicId: 'normal-topic',
      });
      const instruction = createCallLLMInstruction({
        model: 'gpt-4',
        provider: 'openai',
        messages: [createUserMessage()],
      });
      const state = createInitialState({ operationId: context.operationId });

      mockStreamResponse({ content: 'AI response' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'normal-agent',
          role: 'assistant',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should pass groupId to message when present in operation context', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({
        agentId: 'supervisor-agent',
        scope: 'group_agent',
        subAgentId: 'worker-agent',
        groupId: 'group-123',
        topicId: 'group-topic',
      });
      const instruction = createCallLLMInstruction({
        model: 'gpt-4',
        provider: 'openai',
        messages: [createUserMessage()],
      });
      const state = createInitialState({ operationId: context.operationId });

      mockStreamResponse({ content: 'AI response' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: 'group-123',
          agentId: 'worker-agent',
          role: 'assistant',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should use subAgentId even without explicit scope when groupId is present (backward compatibility)', async () => {
      // Given - Group scenario without explicit scope (backward compatibility test)
      const mockStore = createMockStore();
      const context = createTestContext({
        agentId: 'supervisor-agent',
        subAgentId: 'worker-agent',
        groupId: 'group-123',
        topicId: 'group-topic',
        // No explicit scope - should infer from groupId
      });
      const instruction = createCallLLMInstruction({
        model: 'gpt-4',
        provider: 'openai',
        messages: [createUserMessage()],
      });
      const state = createInitialState({ operationId: context.operationId });

      mockStreamResponse({ content: 'AI response' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then - should still use subAgentId for backward compatibility
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'worker-agent', // Should use subAgentId even without explicit scope
          groupId: 'group-123',
          role: 'assistant',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should not include groupId when not in group chat context', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({
        agentId: 'normal-agent',
        topicId: 'normal-topic',
      });
      const instruction = createCallLLMInstruction({
        model: 'gpt-4',
        provider: 'openai',
        messages: [createUserMessage()],
      });
      const state = createInitialState({ operationId: context.operationId });

      mockStreamResponse({ content: 'AI response' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'normal-agent',
          role: 'assistant',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
      // Verify groupId is not in the call (undefined)
      const callArgs = vi.mocked(mockStore.optimisticCreateMessage).mock.calls[0][0];
      expect(callArgs.groupId).toBeUndefined();
    });
  });

  describe('Supervisor Metadata', () => {
    it('should add isSupervisor metadata when operation context indicates supervisor', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({
        agentId: 'supervisor-agent',
        topicId: 'group-topic',
      });

      // Setup operation with isSupervisor flag
      mockStore.operations[context.operationId] = {
        id: context.operationId,
        type: 'execAgentRuntime',
        status: 'running',
        context: {
          agentId: 'supervisor-agent',
          topicId: 'group-topic',
          isSupervisor: true,
        },
        abortController: new AbortController(),
        metadata: { startTime: Date.now() },
        childOperationIds: [],
      };

      const instruction = createCallLLMInstruction({
        model: 'gpt-4',
        provider: 'openai',
        messages: [createUserMessage()],
      });
      const state = createInitialState({ operationId: context.operationId });

      mockStreamResponse({ content: 'Supervisor response' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { isSupervisor: true },
          role: 'assistant',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should not add isSupervisor metadata for normal agents', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({
        agentId: 'normal-agent',
        topicId: 'normal-topic',
      });
      const instruction = createCallLLMInstruction({
        model: 'gpt-4',
        provider: 'openai',
        messages: [createUserMessage()],
      });
      const state = createInitialState({ operationId: context.operationId });

      mockStreamResponse({ content: 'Normal response' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: undefined,
          role: 'assistant',
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });
  });

  describe('createAssistantMessage flag', () => {
    it('should create message even when skipCreateFirstMessage is true if createAssistantMessage is explicitly true', async () => {
      // Given - This scenario happens after compression, where a new assistant message is needed
      const mockStore = createMockStore();
      const context = createTestContext({ parentId: 'msg_parent' });
      const instruction = createCallLLMInstruction({
        createAssistantMessage: true,
      });
      const state = createInitialState();

      mockStreamResponse({ content: 'Post-compression response' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
        skipCreateFirstMessage: true,
      });

      // Then - should still create a new assistant message
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'assistant',
          content: LOADING_FLAT,
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );
    });

    it('should skip message creation only on first call when skipCreateFirstMessage is true', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({ parentId: 'msg_parent' });
      const instruction1 = createCallLLMInstruction();
      const instruction2 = createCallLLMInstruction({ createAssistantMessage: undefined });
      const state = createInitialState();

      mockStreamResponse({ content: 'AI response' });
      mockStore.dbMessagesMap[context.messageKey] = [];

      // Ensure operation exists for the context
      mockStore.operations[context.operationId] = {
        id: context.operationId,
        type: 'execAgentRuntime',
        status: 'running',
        context: {
          agentId: context.agentId,
          topicId: context.topicId,
          messageId: context.parentId,
        },
        abortController: new AbortController(),
        metadata: { startTime: Date.now() },
        childOperationIds: [],
      };

      // When - First call should skip, second should create
      const { createAgentExecutors } = await import('@/store/chat/agents/createAgentExecutors');
      const executors = createAgentExecutors({
        agentConfig: {
          agentConfig: { model: 'gpt-4', provider: 'openai' } as any,
          chatConfig: {} as any,
          isBuiltinAgent: false,
          plugins: [],
        },
        get: () => mockStore,
        messageKey: context.messageKey,
        operationId: context.operationId,
        parentId: context.parentId,
        skipCreateFirstMessage: true,
      });

      await executors.call_llm!(instruction1, state);

      // Then - First call should NOT create message
      expect(mockStore.optimisticCreateMessage).not.toHaveBeenCalled();

      // When - Second call
      mockStreamResponse({ content: 'Second response' });
      await executors.call_llm!(instruction2, state);

      // Then - Second call SHOULD create message
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalled();
    });
  });

  describe('Google blocked stream errors', () => {
    it('should keep normal content and update message error state', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      mockStore.dbMessagesMap[context.messageKey] = [];

      vi.mocked(chatService.createAssistantMessageStream).mockImplementation(
        async (params: any) => {
          if (params.onMessageHandle) {
            await params.onMessageHandle({ text: 'Partial output', type: 'text' });
          }

          if (params.onErrorHandle) {
            params.onErrorHandle({
              body: {
                context: {
                  finishReason: 'PROHIBITED_CONTENT',
                },
                provider: 'google',
              },
              message:
                'Your request may contain prohibited content. Please adjust your request to comply with the usage guidelines.',
              type: 'ProviderBizError',
            });
          }

          if (params.onFinish) {
            await params.onFinish('Partial output', { type: 'error' });
          }
        },
      );

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticUpdateMessageError).toHaveBeenCalled();

      const contentCall = vi.mocked(mockStore.optimisticUpdateMessageContent).mock.calls.at(-1);
      const finalContent = contentCall?.[1] as string;

      expect(finalContent).toBe('Partial output');
    });
  });

  describe('Final provider context budget', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    const modelCatalogSnapshot = {
      capturedAt: '2026-09-04T00:00:00.000Z',
      entry: {
        abilitySources: {},
        contextWindowSource: 'catalog',
        contextWindowTokens: 3072,
        inputModalities: {
          audio: 'unknown',
          file: 'unknown',
          image: 'unknown',
          text: 'supported',
          video: 'unknown',
        },
        kind: 'chat',
        kindSource: 'catalog',
        modelId: 'gpt-4',
        providerId: 'openai',
      },
      operationId: 'op_test',
      version: 1,
    } as const;

    it('uses the frozen snapshot and commits hierarchical compression only after finalize', async () => {
      const context = createTestContext();
      const replaceMessages = vi.fn((nextMessages: any[]) => {
        mockStore.dbMessagesMap[context.messageKey] = nextMessages;
      });
      const mockStore = createMockStore({ replaceMessages } as any);
      const oldUser = createUserMessage({ content: 'a'.repeat(30_000), id: 'old-user' });
      const oldAssistant = createAssistantMessage({
        content: 'b'.repeat(30_000),
        id: 'old-assistant',
      });
      const latest = createUserMessage({ content: 'continue', id: 'latest-user' });
      const injection = createUserMessage({ content: 'runtime memory', id: 'memory-injection' });
      mockStore.dbMessagesMap[context.messageKey] = [oldUser, oldAssistant, latest];
      const finalizedMessages = [
        createUserMessage({ content: 'persisted summary', id: 'compression-group' }),
        latest,
      ];
      vi.mocked(messageService.createCompressionGroup).mockResolvedValue({
        messageGroupId: 'compression-group',
        messages: [],
        messagesToSummarize: [oldUser, oldAssistant],
      });
      vi.mocked(messageService.finalizeCompression).mockImplementation(async () => {
        expect(replaceMessages).not.toHaveBeenCalled();
        return { messages: finalizedMessages };
      });
      const summaryRequestTokens: number[] = [];
      vi.mocked(chatService.getChatCompletion).mockImplementation(async (request: any, options) => {
        summaryRequestTokens.push(countContextTokens({ messages: request.messages }).adjustedTotal);
        await options?.onMessageHandle?.({
          text: `summary-${summaryRequestTokens.length}`,
          type: 'text',
        });
        return new Response();
      });
      let compressionResult: any;
      vi.mocked(chatService.createAssistantMessageStream).mockImplementation(
        async (params: any) => {
          expect(params.contextBudget.catalogSnapshot).toBe(modelCatalogSnapshot);
          compressionResult = await params.contextBudget.compress(
            {
              messages: [oldUser, oldAssistant, injection, latest],
              model: 'gpt-4',
              provider: 'openai',
              providerMedia: [],
              tools: [],
            },
            {
              decision: {
                attempt: 1,
                candidateIds: ['old-user', 'old-assistant', 'memory-injection'],
                kind: 'compress',
                preservedIds: ['latest-user'],
                trigger: 'final-preflight',
              },
              estimatedPromptTokens: 20_000,
              partition: {
                candidateIds: ['old-user', 'old-assistant', 'memory-injection'],
                preservedIds: ['latest-user'],
              },
              payloadFingerprint: 'original-fingerprint',
            },
          );
          await params.onFinish?.('ok', { type: 'stop' });
        },
      );

      const result = await executeWithMockContext({
        context,
        executor: 'call_llm',
        instruction: createCallLLMInstruction({
          messages: [oldUser, oldAssistant, latest],
          model: 'gpt-4',
          provider: 'openai',
        }),
        mockStore,
        state: createInitialState({
          metadata: { modelCatalogSnapshot },
          modelRuntimeConfig: {
            compressionModel: { model: 'gpt-4', provider: 'openai' },
            model: 'gpt-4',
            provider: 'openai',
          },
          operationId: context.operationId,
        }),
      });

      expect(messageService.createCompressionGroup).toHaveBeenCalledWith(
        expect.objectContaining({ messageIds: ['old-user', 'old-assistant'] }),
      );
      expect(summaryRequestTokens.length).toBeGreaterThan(1);
      expect(summaryRequestTokens.every((tokens) => tokens <= 2048)).toBe(true);
      expect(messageService.finalizeCompression).toHaveBeenCalledTimes(1);
      expect(messageService.cancelCompression).not.toHaveBeenCalled();
      expect(replaceMessages).toHaveBeenCalledTimes(1);
      expect(replaceMessages).toHaveBeenCalledWith(finalizedMessages, expect.anything());
      expect(compressionResult.outcome.outcome).toBe('compressed');
      expect(compressionResult.payload.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'compression-group' }),
          expect.objectContaining({ id: 'memory-injection' }),
          expect.objectContaining({ id: 'latest-user' }),
        ]),
      );
      expect(result.events).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'compression_complete' })]),
      );
    });

    it('retains the failed group and preserves original messages when a chunk summary fails', async () => {
      const context = createTestContext();
      const replaceMessages = vi.fn();
      const mockStore = createMockStore({ replaceMessages } as any);
      const oldUser = createUserMessage({ content: 'old history', id: 'old-user' });
      const latest = createUserMessage({ content: 'continue', id: 'latest-user' });
      mockStore.dbMessagesMap[context.messageKey] = [oldUser, latest];
      vi.mocked(messageService.createCompressionGroup).mockResolvedValue({
        messageGroupId: 'compression-group',
        messages: [],
        messagesToSummarize: [oldUser],
      });
      vi.mocked(messageService.failCompression).mockResolvedValue({
        messages: [oldUser, latest],
      });
      vi.mocked(chatService.getChatCompletion).mockImplementation(async (_request, options) => {
        options?.onErrorHandle?.({ message: 'summary failed', type: 'ProviderBizError' });
        return new Response();
      });
      let compressionResult: any;
      vi.mocked(chatService.createAssistantMessageStream).mockImplementation(
        async (params: any) => {
          const originalPayload = {
            messages: [oldUser, latest],
            model: 'gpt-4',
            provider: 'openai',
            providerMedia: [],
            tools: [],
          };
          compressionResult = await params.contextBudget.compress(originalPayload, {
            decision: {
              attempt: 1,
              candidateIds: ['old-user'],
              kind: 'compress',
              preservedIds: ['latest-user'],
              trigger: 'provider-error',
            },
            estimatedPromptTokens: 10_000,
            partition: { candidateIds: ['old-user'], preservedIds: ['latest-user'] },
            payloadFingerprint: 'original-fingerprint',
          });
          expect(compressionResult.payload).toBe(originalPayload);
          await params.onFinish?.('', { type: 'error' });
        },
      );

      await executeWithMockContext({
        context,
        executor: 'call_llm',
        instruction: createCallLLMInstruction({ messages: [oldUser, latest] }),
        mockStore,
        state: createInitialState({
          metadata: { modelCatalogSnapshot },
          modelRuntimeConfig: {
            compressionModel: { model: 'gpt-4', provider: 'openai' },
            model: 'gpt-4',
            provider: 'openai',
          },
          operationId: context.operationId,
        }),
      });

      expect(compressionResult.outcome).toEqual(
        expect.objectContaining({ code: 'SUMMARY_FAILED', outcome: 'failed' }),
      );
      expect(messageService.failCompression).toHaveBeenCalledWith(
        expect.objectContaining({ messageGroupId: 'compression-group' }),
      );
      expect(messageService.cancelCompression).not.toHaveBeenCalled();
      expect(messageService.finalizeCompression).not.toHaveBeenCalled();
      expect(replaceMessages).not.toHaveBeenCalled();
      expect(mockStore.dbMessagesMap[context.messageKey]).toEqual([oldUser, latest]);
    });
  });

  describe('Error traceId preservation', () => {
    it('should preserve backend traceId when local traceId is undefined', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      mockStore.dbMessagesMap[context.messageKey] = [];

      const backendTraceId = 'backend-trace-id-123';

      vi.mocked(chatService.createAssistantMessageStream).mockImplementation(
        async (params: any) => {
          if (params.onErrorHandle) {
            params.onErrorHandle({
              body: {
                traceId: backendTraceId,
              },
              message: 'Provider error',
              type: 'ProviderBizError',
            });
          }

          if (params.onFinish) {
            await params.onFinish('', { type: 'error' });
          }
        },
      );

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then
      expect(mockStore.optimisticUpdateMessageError).toHaveBeenCalled();
      const errorCall = vi.mocked(mockStore.optimisticUpdateMessageError).mock.calls[0];
      const errorArg = errorCall[1] as any;
      expect(errorArg.body.traceId).toBe(backendTraceId);
    });

    it('should use local traceId when available', async () => {
      // Given
      const mockStore = createMockStore();
      const localTraceId = 'local-trace-id-456';
      const context = createTestContext();
      const instruction = createCallLLMInstruction();
      const state = createInitialState();

      // Set traceId on operation metadata
      mockStore.operations[context.operationId] = {
        abortController: new AbortController(),
        childOperationIds: [],
        context: {
          agentId: context.agentId,
          messageId: context.parentId,
          topicId: context.topicId,
        },
        id: context.operationId,
        metadata: { startTime: Date.now(), traceId: localTraceId },
        status: 'running',
        type: 'execAgentRuntime',
      };

      mockStore.dbMessagesMap[context.messageKey] = [];

      vi.mocked(chatService.createAssistantMessageStream).mockImplementation(
        async (params: any) => {
          if (params.onErrorHandle) {
            params.onErrorHandle({
              body: {
                traceId: 'backend-trace-id',
              },
              message: 'Provider error',
              type: 'ProviderBizError',
            });
          }

          if (params.onFinish) {
            await params.onFinish('', { type: 'error' });
          }
        },
      );

      // When
      await executeWithMockContext({
        executor: 'call_llm',
        instruction,
        state,
        mockStore,
        context,
      });

      // Then - local traceId should take precedence
      expect(mockStore.optimisticUpdateMessageError).toHaveBeenCalled();
      const errorCall = vi.mocked(mockStore.optimisticUpdateMessageError).mock.calls[0];
      const errorArg = errorCall[1] as any;
      expect(errorArg.body.traceId).toBe(localTraceId);
    });
  });
});
