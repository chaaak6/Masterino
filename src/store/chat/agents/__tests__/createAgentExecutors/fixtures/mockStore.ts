import { nanoid } from '@lobechat/utils';
import { vi } from 'vitest';

import { type ChatStore } from '@/store/chat/store';

/**
 * Create a mock ChatStore for testing executors
 * All methods are mocked with vi.fn() and can be customized
 */
export const createMockStore = (overrides: Partial<ChatStore> = {}): ChatStore => {
  const operations: Record<string, any> = {};
  const messageOperationMap: Record<string, string> = {};
  const operationsByMessage: Record<string, string[]> = {};
  const dbMessagesMap: Record<string, any[]> = {};
  const optimisticCreateMessage =
    overrides.optimisticCreateMessage ??
    vi.fn().mockImplementation(async (params, createContext) => {
      const id = createContext?.tempMessageId || nanoid();
      return { id, ...params, createdAt: Date.now(), updatedAt: Date.now() };
    });
  const internalInvokeDifferentTypePlugin =
    overrides.internal_invokeDifferentTypePlugin ??
    vi.fn().mockResolvedValue({ error: null, success: true });
  const store = {} as ChatStore;
  const internalExecuteDifferentTypePlugin =
    overrides.internal_executeDifferentTypePlugin ??
    vi.fn(async (...args: Parameters<ChatStore['internal_executeDifferentTypePlugin']>) => {
      const result = await store.internal_invokeDifferentTypePlugin(args[0], args[1], args[2]);
      return { ...result, success: result?.success ?? !result?.error };
    });

  Object.assign(store, {
    // Other store properties (add as needed)
    activeAgentId: 'test-session',

    activeTopicId: 'test-topic',

    associateMessageWithOperation: vi.fn().mockImplementation((messageId, operationId) => {
      messageOperationMap[messageId] = operationId;

      if (!operationsByMessage[messageId]) {
        operationsByMessage[messageId] = [];
      }
      if (!operationsByMessage[messageId].includes(operationId)) {
        operationsByMessage[messageId].push(operationId);
      }
    }),

    cancelOperation: vi.fn().mockImplementation((operationId) => {
      if (operations[operationId]) {
        operations[operationId].abortController.abort();
        operations[operationId].status = 'cancelled';
        for (const childId of operations[operationId].childOperationIds || []) {
          store.cancelOperation(childId, 'Parent operation cancelled');
        }
      }
    }),

    completeOperation: vi.fn().mockImplementation((operationId) => {
      if (operations[operationId]) {
        operations[operationId].status = 'completed';
        operations[operationId].metadata.endTime = Date.now();
      }
    }),

    // Message state
    dbMessagesMap,

    failOperation: vi.fn().mockImplementation((operationId, error) => {
      if (operations[operationId]) {
        operations[operationId].status = 'failed';
        operations[operationId].metadata.error = error;
        operations[operationId].metadata.endTime = Date.now();
      }
    }),

    // AI chat methods
    internal_dispatchMessage: vi.fn(),

    internal_executeDifferentTypePlugin: internalExecuteDifferentTypePlugin,

    internal_invokeDifferentTypePlugin: internalInvokeDifferentTypePlugin,

    internal_toggleToolCallingStreaming: vi.fn(),

    internal_transformToolCalls: vi.fn().mockImplementation((toolCalls: any[]) =>
      toolCalls.map((tc: any) => ({
        apiName: tc.function?.name?.split('____')[1] || tc.function?.name || 'unknown',
        arguments: tc.function?.arguments || '{}',
        id: tc.id,
        identifier: tc.function?.name?.split('____')[0] || 'unknown',
        type: 'default',
      })),
    ),

    messageOperationMap,

    onOperationCancel: vi.fn(),

    pausedExecutionContextByMessage: {},

    preservePausedExecutionContext: vi.fn().mockImplementation((messageId, executionContext) => {
      store.pausedExecutionContextByMessage[messageId] = executionContext;
    }),

    clearPausedExecutionContext: vi.fn().mockImplementation((messageId) => {
      delete store.pausedExecutionContextByMessage[messageId];
    }),

    // Operation state
    operations,

    operationsByContext: {},

    operationsByMessage,

    operationsByType: {} as any,

    optimisticAddToolToAssistantMessage: vi.fn().mockResolvedValue(undefined),

    // Message management methods
    optimisticCreateMessage,

    optimisticCreateTmpMessage: vi.fn().mockImplementation((params, createContext) => {
      void optimisticCreateMessage(params, createContext);
      return createContext?.tempMessageId || nanoid();
    }),

    optimisticUpdateMessageContent: vi.fn().mockResolvedValue(undefined),

    optimisticUpdateMessageError: vi.fn().mockResolvedValue(undefined),

    optimisticUpdateMessagePlugin: vi.fn().mockResolvedValue(undefined),

    optimisticUpdateMessagePluginError: vi.fn().mockResolvedValue(undefined),

    optimisticUpdatePluginArguments: vi.fn().mockResolvedValue(undefined),

    optimisticUpdatePluginState: vi.fn().mockResolvedValue(undefined),

    // Operation management methods
    startOperation: vi.fn().mockImplementation((config) => {
      const operationId = `op_${nanoid()}`;
      const abortController = new AbortController();

      const operation = {
        abortController,
        childOperationIds: [],
        context: config.context || {},
        id: operationId,
        metadata: { startTime: Date.now(), ...config.metadata },
        parentOperationId: config.parentOperationId,
        status: 'running',
        type: config.type,
      };

      operations[operationId] = operation;

      if (config.parentOperationId && operations[config.parentOperationId]) {
        operations[config.parentOperationId].childOperationIds.push(operationId);
      }

      // Auto-associate message with operation if messageId exists
      if (config.context?.messageId) {
        messageOperationMap[config.context.messageId] = operationId;

        if (!operationsByMessage[config.context.messageId]) {
          operationsByMessage[config.context.messageId] = [];
        }
        operationsByMessage[config.context.messageId].push(operationId);
      }

      return { abortController, operationId };
    }),
    updateOperationMetadata: vi.fn().mockImplementation((operationId, metadata) => {
      if (operations[operationId]) {
        operations[operationId].metadata = {
          ...operations[operationId].metadata,
          ...metadata,
        };
      }
    }),

    ...overrides,
  });

  return store;
};
