import type * as LobechatConstModule from '@lobechat/const';
import { type ConversationContext, RequestTrigger } from '@lobechat/types';
import type { ExecutionContext } from '@lobechat/types/src/executionContext';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { heterogeneousAgentService } from '@/services/electron/heterogeneousAgent';
import { initialState as projectWorkspaceInitialState } from '@/store/projectWorkspace/initialState';
import { useProjectWorkspaceStore } from '@/store/projectWorkspace/store';

import { useChatStore } from '../../../../store';
import { messageMapKey } from '../../../../utils/messageMapKey';
import { createMockMessage, createMockResolvedAgentConfig, TEST_IDS } from './fixtures';
import { resetTestEnvironment } from './helpers';

// Keep zustand mock as it's needed globally
vi.mock('zustand/traditional');

const mockConstEnv = vi.hoisted(() => ({ isDesktop: false }));
vi.mock('@lobechat/const', async (importOriginal) => {
  const actual = await importOriginal<typeof LobechatConstModule>();
  return {
    ...actual,
    get isDesktop() {
      return mockConstEnv.isDesktop;
    },
  };
});

// Mock the tRPC client & agentRuntimeService so the import chain doesn't pull
// server-only code (cloud business packages, redis envs) into the test env.
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    aiAgent: {
      processHumanIntervention: { mutate: vi.fn().mockResolvedValue({ success: true }) },
    },
  },
}));

vi.mock('@/services/agentRuntime', () => ({
  agentRuntimeService: {
    handleHumanIntervention: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock('@/utils/localStorage', () => {
  class AsyncLocalStorage<State> {
    async getFromLocalStorage(): Promise<State> {
      return {} as State;
    }

    async saveToLocalStorage(): Promise<void> {
      return undefined;
    }
  }

  return { AsyncLocalStorage };
});

beforeEach(() => {
  resetTestEnvironment();
  mockConstEnv.isDesktop = false;
  useProjectWorkspaceStore.setState(projectWorkspaceInitialState);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const setupPausedAuthorityResume = (kind: 'scratch' | 'device', mode: 'approve' | 'reject') => {
  mockConstEnv.isDesktop = true;
  const { result } = renderHook(() => useChatStore());
  const prefix = `${mode}-${kind}`;
  const agentId = `${prefix}-agent`;
  const topicId = `${prefix}-topic`;
  const key = messageMapKey({ agentId, topicId });
  const assistantMessage = createMockMessage({ id: `${prefix}-assistant`, role: 'assistant' });
  const toolMessage = createMockMessage({
    id: `${prefix}-tool`,
    parentId: assistantMessage.id,
    plugin: {
      apiName: 'readFile',
      arguments: '{}',
      identifier: 'local-system',
      type: 'default',
    },
    role: 'tool',
    tool_call_id: `${prefix}-call`,
  });
  const pausedExecutionContext: ExecutionContext = {
    accessRoots:
      mode === 'approve'
        ? [
            {
              modes: ['read'],
              rootPath: `/paused/${prefix}/grant`,
              scope: 'topic',
              source: 'user-approval',
            },
          ]
        : [],
    cwd: `/paused/${prefix}`,
    plan: { deviceId: 'paused-device', kind: 'device', target: 'local' },
    version: 1,
    workspace: { id: `paused-${prefix}`, kind, rootPath: `/paused/${prefix}` },
  };
  act(() => {
    useChatStore.setState({
      activeAgentId: agentId,
      activeTopicId: topicId,
      dbMessagesMap: { [key]: [assistantMessage, toolMessage] },
      messagesMap: { [key]: [assistantMessage, toolMessage] },
      pausedExecutionContextByMessage: { [toolMessage.id]: pausedExecutionContext },
    });
    useProjectWorkspaceStore.setState({
      topicStatesById: {
        [topicId]: {
          snapshot: {
            boundDeviceId: 'replacement-device',
            target: 'local',
            targetCapturedAt: '2026-09-09T00:00:00.000Z',
            version: 1,
            workspaceId: 'replacement-workspace',
            workspaceKind: 'device',
          },
          workspace: {
            deviceId: 'replacement-device',
            id: 'replacement-workspace',
            kind: 'device',
            rootPath: '/replacement/workspace',
          },
        },
      },
    });
  });
  vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(false);
  vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
  vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
    state: {} as any,
    context: { phase: 'init' } as any,
    agentConfig: createMockResolvedAgentConfig(),
  });
  const executeClientAgent = vi
    .spyOn(result.current, 'executeClientAgent')
    .mockResolvedValue(undefined);

  return { executeClientAgent, pausedExecutionContext, result, toolMessage };
};

describe('ConversationControl actions', () => {
  describe('stopGenerateMessage', () => {
    it('should cancel running generateAI operations in current context', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          activeAgentId: TEST_IDS.SESSION_ID,
          activeTopicId: TEST_IDS.TOPIC_ID,
        });
      });

      // Create a generateAI operation
      let operationId: string;
      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: {
            agentId: TEST_IDS.SESSION_ID,
            topicId: TEST_IDS.TOPIC_ID,
          },
        });
        operationId = res.operationId;
      });

      expect(result.current.operations[operationId!].status).toBe('running');

      // Stop generation
      act(() => {
        result.current.stopGenerateMessage();
      });

      expect(result.current.operations[operationId!].status).toBe('cancelled');
    });

    it('should not cancel operations from different context', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          activeAgentId: TEST_IDS.SESSION_ID,
          activeTopicId: TEST_IDS.TOPIC_ID,
        });
      });

      // Create a generateAI operation in a different context
      let operationId: string;
      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: {
            agentId: 'different-session',
            topicId: 'different-topic',
          },
        });
        operationId = res.operationId;
      });

      expect(result.current.operations[operationId!].status).toBe('running');

      // Stop generation - should not affect different context
      act(() => {
        result.current.stopGenerateMessage();
      });

      expect(result.current.operations[operationId!].status).toBe('running');
    });

    it('cancels Gateway-mode execServerAgentRuntime ops and invokes their cancel handler', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          activeAgentId: TEST_IDS.SESSION_ID,
          activeTopicId: TEST_IDS.TOPIC_ID,
        });
      });

      let operationId!: string;
      act(() => {
        const res = result.current.startOperation({
          type: 'execServerAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        });
        operationId = res.operationId;
      });

      const cancelHandler = vi.fn();
      act(() => {
        result.current.onOperationCancel(operationId, cancelHandler);
      });

      expect(result.current.operations[operationId].status).toBe('running');

      act(() => {
        result.current.stopGenerateMessage();
      });

      // Operation gets cancelled and the handler (which would fire the WS interrupt
      // in real code) is invoked with the operation context.
      expect(result.current.operations[operationId].status).toBe('cancelled');
      expect(cancelHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          operationId,
          type: 'execServerAgentRuntime',
        }),
      );
      // isAborting flag is also flipped so the UI loading state clears immediately.
      expect(result.current.operations[operationId].metadata.isAborting).toBe(true);
    });
  });

  describe('cancelSendMessageInServer', () => {
    it('should cancel operation and restore editor state', () => {
      const { result } = renderHook(() => useChatStore());
      const mockSetJSONState = vi.fn();
      const editorState = { content: 'saved content' };

      act(() => {
        useChatStore.setState({
          activeAgentId: TEST_IDS.SESSION_ID,
          activeTopicId: TEST_IDS.TOPIC_ID,
          mainInputEditor: { setJSONState: mockSetJSONState } as any,
        });
      });

      // Create operation
      let operationId: string;
      act(() => {
        const res = result.current.startOperation({
          type: 'sendMessage',
          context: {
            agentId: TEST_IDS.SESSION_ID,
            topicId: TEST_IDS.TOPIC_ID,
          },
        });
        operationId = res.operationId;

        result.current.updateOperationMetadata(res.operationId, {
          inputEditorTempState: editorState,
        });
      });

      expect(result.current.operations[operationId!].status).toBe('running');

      // Cancel
      act(() => {
        result.current.cancelSendMessageInServer();
      });

      expect(result.current.operations[operationId!].status).toBe('cancelled');
      expect(mockSetJSONState).toHaveBeenCalledWith(editorState);
    });

    it('should cancel operation for specified topic ID', () => {
      const { result } = renderHook(() => useChatStore());
      const customTopicId = 'custom-topic-id';

      act(() => {
        useChatStore.setState({
          activeAgentId: TEST_IDS.SESSION_ID,
        });
      });

      // Create operation
      let operationId: string;
      act(() => {
        const res = result.current.startOperation({
          type: 'sendMessage',
          context: {
            agentId: TEST_IDS.SESSION_ID,
            topicId: customTopicId,
          },
        });
        operationId = res.operationId;
      });

      expect(result.current.operations[operationId!].status).toBe('running');

      // Cancel
      act(() => {
        result.current.cancelSendMessageInServer(customTopicId);
      });

      expect(result.current.operations[operationId!].status).toBe('cancelled');
    });

    it('should handle gracefully when operation does not exist', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          operations: {},
          operationsByContext: {},
        });
      });

      expect(() => {
        act(() => {
          result.current.cancelSendMessageInServer('non-existing-topic');
        });
      }).not.toThrow();
    });
  });

  describe('clearSendMessageError', () => {
    it('should clear error state for current topic', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          activeAgentId: TEST_IDS.SESSION_ID,
          activeTopicId: TEST_IDS.TOPIC_ID,
        });
      });

      // Create operation with error
      let operationId: string;
      act(() => {
        const res = result.current.startOperation({
          type: 'sendMessage',
          context: {
            agentId: TEST_IDS.SESSION_ID,
            topicId: TEST_IDS.TOPIC_ID,
          },
        });
        operationId = res.operationId;

        result.current.updateOperationMetadata(res.operationId, {
          inputSendErrorMsg: 'Some error',
        });
      });

      expect(result.current.operations[operationId!].metadata.inputSendErrorMsg).toBe('Some error');

      // Clear error
      act(() => {
        result.current.clearSendMessageError();
      });

      expect(result.current.operations[operationId!].metadata.inputSendErrorMsg).toBeUndefined();
    });

    it('should handle gracefully when no error operation exists', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          operations: {},
          operationsByContext: {},
        });
      });

      expect(() => {
        act(() => {
          result.current.clearSendMessageError();
        });
      }).not.toThrow();
    });
  });

  describe('Operation system integration', () => {
    it('should create operation with abort controller', () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string = '';
      let abortController: AbortController | undefined;

      act(() => {
        const res = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'test-session' },
        });
        operationId = res.operationId;
        abortController = res.abortController;
      });

      expect(abortController!).toBeInstanceOf(AbortController);
      expect(result.current.operations[operationId!].abortController).toBe(abortController);
      expect(result.current.operations[operationId!].status).toBe('running');
    });

    it('should update operation metadata', () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string;

      act(() => {
        const res = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'test-session' },
        });
        operationId = res.operationId;

        result.current.updateOperationMetadata(res.operationId, {
          inputSendErrorMsg: 'test error',
          inputEditorTempState: { content: 'test' },
        });
      });

      expect(result.current.operations[operationId!].metadata.inputSendErrorMsg).toBe('test error');
      expect(result.current.operations[operationId!].metadata.inputEditorTempState).toEqual({
        content: 'test',
      });
    });

    it('should support multiple parallel operations', () => {
      const { result } = renderHook(() => useChatStore());

      let opId1: string = '';
      let opId2: string = '';

      act(() => {
        const res1 = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'session-1', topicId: 'topic-1' },
        });
        const res2 = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'session-1', topicId: 'topic-2' },
        });

        opId1 = res1.operationId;
        opId2 = res2.operationId;
      });

      expect(result.current.operations[opId1!].status).toBe('running');
      expect(result.current.operations[opId2!].status).toBe('running');
      expect(opId1).not.toBe(opId2);

      const contextKey1 = messageMapKey({ agentId: 'session-1', topicId: 'topic-1' });
      const contextKey2 = messageMapKey({ agentId: 'session-1', topicId: 'topic-2' });

      expect(result.current.operationsByContext[contextKey1]).toContain(opId1!);
      expect(result.current.operationsByContext[contextKey2]).toContain(opId2!);
    });
  });

  describe('switchMessageBranch', () => {
    it('should switch to a different message branch', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = TEST_IDS.MESSAGE_ID;
      const branchIndex = 1;

      const optimisticUpdateSpy = vi
        .spyOn(result.current, 'optimisticUpdateMessageMetadata')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.switchMessageBranch(messageId, branchIndex);
      });

      expect(optimisticUpdateSpy).toHaveBeenCalledWith(
        messageId,
        { activeBranchIndex: branchIndex },
        undefined,
      );
    });

    it('should handle switching to branch 0', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = TEST_IDS.MESSAGE_ID;
      const branchIndex = 0;

      const optimisticUpdateSpy = vi
        .spyOn(result.current, 'optimisticUpdateMessageMetadata')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.switchMessageBranch(messageId, branchIndex);
      });

      expect(optimisticUpdateSpy).toHaveBeenCalledWith(
        messageId,
        { activeBranchIndex: 0 },
        undefined,
      );
    });

    it('should handle errors gracefully when optimistic update fails', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = TEST_IDS.MESSAGE_ID;
      const branchIndex = 2;

      const optimisticUpdateSpy = vi
        .spyOn(result.current, 'optimisticUpdateMessageMetadata')
        .mockRejectedValue(new Error('Update failed'));

      await expect(
        act(async () => {
          await result.current.switchMessageBranch(messageId, branchIndex);
        }),
      ).rejects.toThrow('Update failed');

      expect(optimisticUpdateSpy).toHaveBeenCalledWith(
        messageId,
        { activeBranchIndex: branchIndex },
        undefined,
      );
    });
  });

  describe('approveToolCalling', () => {
    it.each(['scratch', 'device'] as const)(
      'resumes approved %s tools with the paused authority after workspace state changes',
      async (kind) => {
        const { executeClientAgent, pausedExecutionContext, result, toolMessage } =
          setupPausedAuthorityResume(kind, 'approve');

        await act(async () => {
          await result.current.approveToolCalling(toolMessage.id, 'group-1');
        });

        expect(executeClientAgent).toHaveBeenCalledWith(
          expect.objectContaining({ executionContext: pausedExecutionContext }),
        );
        expect(result.current.pausedExecutionContextByMessage[toolMessage.id]).toBeUndefined();
      },
    );

    it('continues an approved assistant turn with the model persisted on that turn', async () => {
      const { result } = renderHook(() => useChatStore());
      const agentId = 'model-resume-agent';
      const topicId = 'model-resume-topic';
      const key = messageMapKey({ agentId, topicId });
      const assistantMessage = createMockMessage({
        id: 'assistant-original-model',
        model: 'glm-original',
        provider: 'newapi',
        role: 'assistant',
      });
      const toolMessage = createMockMessage({
        id: 'tool-model-resume',
        parentId: assistantMessage.id,
        plugin: {
          apiName: 'readFile',
          arguments: '{}',
          identifier: 'local-system',
          type: 'default',
        },
        role: 'tool',
        tool_call_id: 'call-model-resume',
      });
      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          dbMessagesMap: { [key]: [assistantMessage, toolMessage] },
          messagesMap: { [key]: [assistantMessage, toolMessage] },
        });
      });
      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
        state: {} as any,
        context: { phase: 'init' } as any,
        agentConfig: createMockResolvedAgentConfig(),
      });
      const executeClientAgent = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.approveToolCalling(toolMessage.id, 'group-1');
      });

      expect(executeClientAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          workingModel: { model: 'glm-original', provider: 'newapi' },
        }),
      );
    });

    it('should use provided context instead of global state', async () => {
      const { result } = renderHook(() => useChatStore());

      // Setup: global activeAgentId = 'global-agent'
      const globalAgentId = 'global-agent';
      const builderAgentId = 'builder-agent';
      const builderTopicId = 'builder-topic';

      // Create tool message
      const toolMessage = createMockMessage({
        id: 'tool-msg-1',
        role: 'tool',
        plugin: { identifier: 'test-plugin', type: 'default', arguments: '{}', apiName: 'test' },
        tool_call_id: 'call-tool-msg-1',
      });

      // Setup store with global context and builder context messages
      const globalKey = messageMapKey({ agentId: globalAgentId, topicId: null });
      const builderKey = messageMapKey({
        agentId: builderAgentId,
        topicId: builderTopicId,
        scope: 'agent_builder',
      });

      act(() => {
        useChatStore.setState({
          activeAgentId: globalAgentId,
          activeTopicId: undefined,
          dbMessagesMap: {
            [globalKey]: [createMockMessage({ id: 'global-msg', role: 'user' })],
            [builderKey]: [toolMessage],
          },
          messagesMap: {
            [globalKey]: [createMockMessage({ id: 'global-msg', role: 'user' })],
            [builderKey]: [toolMessage],
          },
        });
      });

      // Mock internal methods
      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      const internal_createAgentStateSpy = vi
        .spyOn(result.current, 'internal_createAgentState')
        .mockReturnValue({
          state: {} as any,
          context: { phase: 'init' } as any,
          agentConfig: createMockResolvedAgentConfig(),
        });
      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      // Call with builder context
      const context: ConversationContext = {
        agentId: builderAgentId,
        topicId: builderTopicId,
        scope: 'agent_builder',
      };

      await act(async () => {
        await result.current.approveToolCalling('tool-msg-1', 'group-1', context);
      });

      // Verify internal_createAgentState was called with builder context
      expect(internal_createAgentStateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: builderAgentId,
          topicId: builderTopicId,
        }),
      );

      // Verify executeClientAgent was called with builder context (now wrapped in context object)
      expect(executeClientAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            agentId: builderAgentId,
            topicId: builderTopicId,
            scope: 'agent_builder',
          }),
          initialContext: expect.objectContaining({
            payload: expect.objectContaining({
              approvedToolCall: expect.objectContaining({
                id: 'call-tool-msg-1',
                intervention: { status: 'approved' },
              }),
            }),
          }),
        }),
      );
    });

    it('should fallback to global state when context not provided', async () => {
      const { result } = renderHook(() => useChatStore());

      const globalAgentId = 'global-agent';
      const globalTopicId = 'global-topic';

      // Create tool message
      const toolMessage = createMockMessage({
        id: 'tool-msg-1',
        role: 'tool',
        plugin: { identifier: 'test-plugin', type: 'default', arguments: '{}', apiName: 'test' },
        tool_call_id: 'call-tool-msg-1',
      });

      const globalKey = messageMapKey({ agentId: globalAgentId, topicId: globalTopicId });

      act(() => {
        useChatStore.setState({
          activeAgentId: globalAgentId,
          activeTopicId: globalTopicId,
          activeThreadId: undefined,
          dbMessagesMap: {
            [globalKey]: [toolMessage],
          },
          messagesMap: {
            [globalKey]: [toolMessage],
          },
        });
      });

      // Mock internal methods
      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      const internal_createAgentStateSpy = vi
        .spyOn(result.current, 'internal_createAgentState')
        .mockReturnValue({
          state: {} as any,
          context: { phase: 'init' } as any,
          agentConfig: createMockResolvedAgentConfig(),
        });
      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      // Call without context (should use global state)
      await act(async () => {
        await result.current.approveToolCalling('tool-msg-1', 'group-1');
      });

      // Verify internal_createAgentState was called with global context
      expect(internal_createAgentStateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: globalAgentId,
          topicId: globalTopicId,
        }),
      );

      // Verify executeClientAgent was called with global context (now wrapped in context object)
      expect(executeClientAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            agentId: globalAgentId,
            topicId: globalTopicId,
          }),
        }),
      );
    });

    it('fails the approval operation when persisting approved state rejects', async () => {
      const { result } = renderHook(() => useChatStore());
      const agentId = 'approval-error-agent';
      const topicId = 'approval-error-topic';
      const key = messageMapKey({ agentId, topicId });
      const toolMessage = createMockMessage({
        id: 'tool-msg-approval-error',
        plugin: { apiName: 'test', arguments: '{}', identifier: 'test-plugin', type: 'default' },
        role: 'tool',
        tool_call_id: 'call-approval-error',
      });
      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          dbMessagesMap: { [key]: [toolMessage] },
          messagesMap: { [key]: [toolMessage] },
        });
      });
      const failure = new Error('approval update failed');
      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockRejectedValue(failure);
      const executeClientAgent = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.approveToolCalling(toolMessage.id, 'group-1');
      });

      const approvalOperation = Object.values(result.current.operations).find(
        ({ type }) => type === 'approveToolCalling',
      );
      expect(approvalOperation).toMatchObject({
        metadata: { error: { message: failure.message, type: 'approveToolCalling' } },
        status: 'failed',
      });
      expect(executeClientAgent).not.toHaveBeenCalled();
    });

    it('fails the approval operation when agent-state reconstruction throws', async () => {
      const { result } = renderHook(() => useChatStore());
      const agentId = 'approval-state-error-agent';
      const topicId = 'approval-state-error-topic';
      const key = messageMapKey({ agentId, topicId });
      const toolMessage = createMockMessage({
        id: 'tool-msg-state-error',
        plugin: { apiName: 'test', arguments: '{}', identifier: 'test-plugin', type: 'default' },
        role: 'tool',
        tool_call_id: 'call-state-error',
      });
      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          dbMessagesMap: { [key]: [toolMessage] },
          messagesMap: { [key]: [toolMessage] },
        });
      });
      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      const failure = new Error('state reconstruction failed');
      vi.spyOn(result.current, 'internal_createAgentState').mockImplementation(() => {
        throw failure;
      });
      const executeClientAgent = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.approveToolCalling(toolMessage.id, 'group-1');
      });

      const approvalOperation = Object.values(result.current.operations).find(
        ({ type }) => type === 'approveToolCalling',
      );
      expect(approvalOperation).toMatchObject({
        metadata: { error: { message: failure.message, type: 'approveToolCalling' } },
        status: 'failed',
      });
      expect(executeClientAgent).not.toHaveBeenCalled();
    });

    it('fails the approval operation when the stored tool call id is missing', async () => {
      const { result } = renderHook(() => useChatStore());
      const agentId = 'approval-missing-id-agent';
      const topicId = 'approval-missing-id-topic';
      const key = messageMapKey({ agentId, topicId });
      const toolMessage = createMockMessage({
        id: 'tool-msg-missing-id',
        plugin: { apiName: 'test', arguments: '{}', identifier: 'test-plugin', type: 'default' },
        role: 'tool',
      });
      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          dbMessagesMap: { [key]: [toolMessage] },
          messagesMap: { [key]: [toolMessage] },
        });
      });
      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      const createAgentState = vi.spyOn(result.current, 'internal_createAgentState');

      await act(async () => {
        await result.current.approveToolCalling(toolMessage.id, 'group-1');
      });

      const approvalOperation = Object.values(result.current.operations).find(
        ({ type }) => type === 'approveToolCalling',
      );
      expect(approvalOperation).toMatchObject({
        metadata: {
          error: {
            message: 'Approved tool message is missing its tool call id',
            type: 'approveToolCalling',
          },
        },
        status: 'failed',
      });
      expect(createAgentState).not.toHaveBeenCalled();
    });

    it('should not execute when tool message not found', async () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          activeAgentId: 'test-agent',
          activeTopicId: undefined,
          dbMessagesMap: {},
          messagesMap: {},
        });
      });

      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.approveToolCalling('non-existent-msg', 'group-1');
      });

      // Should not call executeClientAgent when tool message not found
      expect(executeClientAgentSpy).not.toHaveBeenCalled();
    });

    describe('server-mode branch', () => {
      it('should start a new Gateway op with resumeApproval.decision=approved and NOT run local runtime', async () => {
        const { result } = renderHook(() => useChatStore());

        const agentId = 'server-agent';
        const topicId = 'server-topic';
        const chatKey = messageMapKey({ agentId, topicId });

        const onboardingUserMessage = createMockMessage({
          id: 'onboarding-user-msg',
          metadata: { trigger: RequestTrigger.Onboarding },
          role: 'user',
        });
        const onboardingAssistantMessage = createMockMessage({
          id: 'onboarding-assistant-msg',
          parentId: onboardingUserMessage.id,
          role: 'assistant',
        });
        const toolMessage = createMockMessage({
          id: 'tool-msg-1',
          parentId: onboardingAssistantMessage.id,
          plugin: {
            apiName: 'search',
            arguments: '{"q":"test"}',
            identifier: 'web-search',
            type: 'default',
          },
          role: 'tool',
          // `tool_call_id` is what the server uses to locate the pending tool
          // call; the new Gateway op carries it forward via `resumeApproval`.
          tool_call_id: 'call_xyz',
        } as any);

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: topicId,
            dbMessagesMap: {
              [chatKey]: [onboardingUserMessage, onboardingAssistantMessage, toolMessage],
            },
            messagesMap: {
              [chatKey]: [onboardingUserMessage, onboardingAssistantMessage, toolMessage],
            },
          });

          // Presence of an `execServerAgentRuntime` op (any status) is one
          // half of the Gateway-resume signal; the other is the lab flag.
          result.current.startOperation({
            context: { agentId, topicId, threadId: null },
            metadata: { serverOperationId: 'server-op-xyz' },
            type: 'execServerAgentRuntime',
          });
        });

        vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(true);
        vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
        const executeGatewayAgentSpy = vi
          .spyOn(result.current, 'executeGatewayAgent')
          .mockResolvedValue({} as any);
        const executeClientAgentSpy = vi
          .spyOn(result.current, 'executeClientAgent')
          .mockResolvedValue(undefined);

        act(() => {
          useProjectWorkspaceStore.getState().setOperationPathConsent('tool-msg-1', {
            actualCwd: '/workspace/project',
            deviceId: 'device-1',
            modes: ['read'],
            operationId: 'source-op-1',
            primaryCwd: '/workspace/project',
            requestedPath: '/workspace/shared',
            rootPath: '/workspace/shared',
            scope: 'operation',
            topicId,
          });
        });

        await act(async () => {
          await result.current.approveToolCalling('tool-msg-1', 'group-1');
        });

        expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            message: '',
            parentMessageId: 'tool-msg-1',
            resumeApproval: {
              decision: 'approved',
              pathConsent: {
                deviceId: 'device-1',
                modes: ['read'],
                requestedPath: '/workspace/shared',
                rootPath: '/workspace/shared',
                scope: 'operation',
                sourceOperationId: 'source-op-1',
                topicId,
                version: 1,
              },
              parentMessageId: 'tool-msg-1',
              toolCallId: 'call_xyz',
            },
            metadata: { trigger: RequestTrigger.Onboarding },
          }),
        );
        expect(executeClientAgentSpy).not.toHaveBeenCalled();
        expect(
          useProjectWorkspaceStore.getState().operationConsentByMessage['tool-msg-1'],
        ).toBeUndefined();

        // Fallback guard: the paused `execServerAgentRuntime` op in this
        // context must be completed so the loading state doesn't bleed
        // across ops when the server-side `agent_runtime_end` for
        // `waiting_for_human` hasn't landed yet.
        const pausedServerOps = Object.values(result.current.operations).filter(
          (op: any) => op.type === 'execServerAgentRuntime',
        );
        expect(pausedServerOps).toHaveLength(1);
        expect(pausedServerOps[0]!.status).toBe('completed');

        executeGatewayAgentSpy.mockRestore();
      });

      it('should still take the Gateway branch when the server already ended the paused op (post-coordinator-fix state)', async () => {
        const { result } = renderHook(() => useChatStore());

        const agentId = 'server-agent';
        const topicId = 'server-topic';
        const chatKey = messageMapKey({ agentId, topicId });

        const toolMessage = createMockMessage({
          id: 'tool-msg-1',
          plugin: {
            apiName: 'search',
            arguments: '{"q":"test"}',
            identifier: 'web-search',
            type: 'default',
          },
          role: 'tool',
          tool_call_id: 'call_xyz',
        } as any);

        let serverOpId: string | undefined;
        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: topicId,
            dbMessagesMap: { [chatKey]: [toolMessage] },
            messagesMap: { [chatKey]: [toolMessage] },
          });

          serverOpId = result.current.startOperation({
            context: { agentId, topicId, threadId: null },
            metadata: { serverOperationId: 'server-op-xyz' },
            type: 'execServerAgentRuntime',
          }).operationId;

          // Simulate the coordinator's `waiting_for_human` → `agent_runtime_end`
          // signal arriving before the user clicks approve: the op is already
          // `completed` when the Gateway-branch decision runs.
          result.current.completeOperation(serverOpId!);
        });

        expect(result.current.operations[serverOpId!]!.status).toBe('completed');

        vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(true);
        vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
        const executeGatewayAgentSpy = vi
          .spyOn(result.current, 'executeGatewayAgent')
          .mockResolvedValue({} as any);
        const executeClientAgentSpy = vi
          .spyOn(result.current, 'executeClientAgent')
          .mockResolvedValue(undefined);

        await act(async () => {
          await result.current.approveToolCalling('tool-msg-1', 'group-1');
        });

        // Critical regression guard: with `#hasRunningServerOp` the branch
        // was missed here (no running op → fell through to client-mode).
        // The combined `isGatewayModeEnabled() + any execServerAgentRuntime`
        // check keeps us on the Gateway path.
        expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            resumeApproval: expect.objectContaining({
              decision: 'approved',
              toolCallId: 'call_xyz',
            }),
          }),
        );
        expect(executeClientAgentSpy).not.toHaveBeenCalled();

        executeGatewayAgentSpy.mockRestore();
      });

      it('should leave the paused server op running when the Gateway resume call fails so retries stay on the server-mode path', async () => {
        const { result } = renderHook(() => useChatStore());

        const agentId = 'server-agent';
        const topicId = 'server-topic';
        const chatKey = messageMapKey({ agentId, topicId });

        const toolMessage = createMockMessage({
          id: 'tool-msg-1',
          plugin: {
            apiName: 'search',
            arguments: '{"q":"test"}',
            identifier: 'web-search',
            type: 'default',
          },
          role: 'tool',
          tool_call_id: 'call_xyz',
        } as any);

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: topicId,
            dbMessagesMap: { [chatKey]: [toolMessage] },
            messagesMap: { [chatKey]: [toolMessage] },
          });

          result.current.startOperation({
            context: { agentId, topicId, threadId: null },
            metadata: { serverOperationId: 'server-op-xyz' },
            type: 'execServerAgentRuntime',
          });
        });

        vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(true);
        vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
        const executeGatewayAgentSpy = vi
          .spyOn(result.current, 'executeGatewayAgent')
          .mockRejectedValue(new Error('network error'));

        await act(async () => {
          await result.current.approveToolCalling('tool-msg-1', 'group-1');
        });

        expect(executeGatewayAgentSpy).toHaveBeenCalled();

        // On failure, the paused server op must stay `running` — otherwise a
        // retry would see no running server op and fall through to the
        // non-Gateway path while the backend is still awaiting human input.
        const serverOps = Object.values(result.current.operations).filter(
          (op: any) => op.type === 'execServerAgentRuntime',
        );
        expect(serverOps).toHaveLength(1);
        expect(serverOps[0]!.status).toBe('running');

        executeGatewayAgentSpy.mockRestore();
      });

      it('should fall through to client-mode runtime when no server operation is running', async () => {
        const { result } = renderHook(() => useChatStore());

        const agentId = 'local-agent';
        const topicId = 'local-topic';
        const chatKey = messageMapKey({ agentId, topicId });

        const toolMessage = createMockMessage({
          id: 'tool-msg-1',
          plugin: { identifier: 'x', type: 'default', arguments: '{}', apiName: 'y' },
          role: 'tool',
          tool_call_id: 'call_local',
        } as any);

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: topicId,
            dbMessagesMap: { [chatKey]: [toolMessage] },
            messagesMap: { [chatKey]: [toolMessage] },
          });
        });

        vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
        vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
          state: {} as any,
          context: { phase: 'init' } as any,
          agentConfig: createMockResolvedAgentConfig(),
        });
        const executeGatewayAgentSpy = vi
          .spyOn(result.current, 'executeGatewayAgent')
          .mockResolvedValue({} as any);
        const executeClientAgentSpy = vi
          .spyOn(result.current, 'executeClientAgent')
          .mockResolvedValue(undefined);

        await act(async () => {
          await result.current.approveToolCalling('tool-msg-1', 'group-1');
        });

        expect(executeGatewayAgentSpy).not.toHaveBeenCalled();
        expect(executeClientAgentSpy).toHaveBeenCalled();

        executeGatewayAgentSpy.mockRestore();
      });

      it('resumes an unbound desktop local topic in the client runtime', async () => {
        mockConstEnv.isDesktop = true;
        const { result } = renderHook(() => useChatStore());
        const agentId = 'local-agent';
        const topicId = 'unbound-topic';
        const chatKey = messageMapKey({ agentId, topicId });
        const toolMessage = createMockMessage({
          id: 'tool-msg-unbound',
          plugin: { apiName: 'listFiles', arguments: '{}', identifier: 'x', type: 'default' },
          role: 'tool',
          tool_call_id: 'call_unbound',
        } as any);

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: topicId,
            dbMessagesMap: { [chatKey]: [toolMessage] },
            messagesMap: { [chatKey]: [toolMessage] },
          });
        });
        vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(false);
        vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
        const executeGatewayAgent = vi
          .spyOn(result.current, 'executeGatewayAgent')
          .mockResolvedValue({} as any);
        const executeClientAgent = vi
          .spyOn(result.current, 'executeClientAgent')
          .mockResolvedValue(undefined);
        vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
          agentConfig: createMockResolvedAgentConfig(),
          context: { phase: 'init' } as any,
          state: {} as any,
        });

        await act(async () => {
          await result.current.approveToolCalling('tool-msg-unbound', 'group-1');
        });

        expect(executeClientAgent).toHaveBeenCalledWith(
          expect.objectContaining({
            context: expect.objectContaining({ agentId, topicId }),
            parentMessageId: 'tool-msg-unbound',
            parentMessageType: 'tool',
          }),
        );
        expect(executeGatewayAgent).not.toHaveBeenCalled();
      });

      it('resolves the running server op in a group scope context (scope/groupId forwarded to the lookup)', async () => {
        // Regression: operationsByContext is keyed by the full messageMapKey
        // including scope/groupId. If #hasRunningServerOp were to drop those
        // fields, a group conversation's approve/reject would miss the op and
        // fall back to client mode. Assert the server-mode branch fires with
        // the group context intact.
        const { result } = renderHook(() => useChatStore());

        const agentId = 'server-agent';
        const groupId = 'group-1';
        const topicId = 'server-topic';
        const scope = 'group' as const;
        const chatKey = messageMapKey({ agentId, groupId, scope, topicId });

        const toolMessage = createMockMessage({
          id: 'tool-msg-1',
          plugin: { apiName: 'y', arguments: '{}', identifier: 'x', type: 'default' },
          role: 'tool',
          tool_call_id: 'call_group',
        } as any);

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: topicId,
            dbMessagesMap: { [chatKey]: [toolMessage] },
            messagesMap: { [chatKey]: [toolMessage] },
          });

          // Server op is indexed under the group-scope key. Without scope
          // forwarding the lookup would hit the default 'main' bucket instead.
          result.current.startOperation({
            context: { agentId, groupId, scope, topicId, threadId: null },
            metadata: { serverOperationId: 'server-op-group' },
            type: 'execServerAgentRuntime',
          });
        });

        vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(true);
        vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
        const executeGatewayAgentSpy = vi
          .spyOn(result.current, 'executeGatewayAgent')
          .mockResolvedValue({} as any);
        const executeClientAgentSpy = vi
          .spyOn(result.current, 'executeClientAgent')
          .mockResolvedValue(undefined);

        await act(async () => {
          await result.current.approveToolCalling('tool-msg-1', 'group-1', {
            agentId,
            groupId,
            scope,
            topicId,
            threadId: null,
          });
        });

        expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            resumeApproval: expect.objectContaining({ decision: 'approved' }),
          }),
        );
        expect(executeClientAgentSpy).not.toHaveBeenCalled();

        executeGatewayAgentSpy.mockRestore();
      });
    });
  });

  describe('rejectToolCalling server-mode branch', () => {
    it('starts a new Gateway op with resumeApproval.decision=rejected_continue (unified)', async () => {
      const { result } = renderHook(() => useChatStore());

      const agentId = 'server-agent';
      const topicId = 'server-topic';
      const chatKey = messageMapKey({ agentId, topicId });

      const toolMessage = createMockMessage({
        id: 'tool-msg-1',
        role: 'tool',
        tool_call_id: 'call_xyz',
      } as any);

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          dbMessagesMap: { [chatKey]: [toolMessage] },
          messagesMap: { [chatKey]: [toolMessage] },
        });

        result.current.startOperation({
          context: { agentId, topicId, threadId: null },
          metadata: { serverOperationId: 'server-op-xyz' },
          type: 'execServerAgentRuntime',
        });
      });

      vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(true);
      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      const executeGatewayAgentSpy = vi
        .spyOn(result.current, 'executeGatewayAgent')
        .mockResolvedValue({} as any);

      await act(async () => {
        await result.current.rejectToolCalling('tool-msg-1', 'not appropriate');
      });

      expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '',
          parentMessageId: 'tool-msg-1',
          resumeApproval: {
            decision: 'rejected_continue',
            parentMessageId: 'tool-msg-1',
            rejectionReason: 'not appropriate',
            toolCallId: 'call_xyz',
          },
        }),
      );

      executeGatewayAgentSpy.mockRestore();
    });
  });

  describe('rejectAndContinueToolCalling server-mode branch', () => {
    it('starts a new Gateway op with resumeApproval.decision=rejected_continue and skips both local runtime and client rejectToolCalling', async () => {
      const { result } = renderHook(() => useChatStore());

      const agentId = 'server-agent';
      const topicId = 'server-topic';
      const chatKey = messageMapKey({ agentId, topicId });

      const toolMessage = createMockMessage({
        id: 'tool-msg-1',
        role: 'tool',
        tool_call_id: 'call_xyz',
      } as any);

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          dbMessagesMap: { [chatKey]: [toolMessage] },
          messagesMap: { [chatKey]: [toolMessage] },
        });

        result.current.startOperation({
          context: { agentId, topicId, threadId: null },
          metadata: { serverOperationId: 'server-op-xyz' },
          type: 'execServerAgentRuntime',
        });
      });

      vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(true);
      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      const executeGatewayAgentSpy = vi
        .spyOn(result.current, 'executeGatewayAgent')
        .mockResolvedValue({} as any);
      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);
      // Ensure client rejectToolCalling is NOT invoked in server-mode path —
      // otherwise the server would see a duplicate halting `reject` before
      // this continue signal lands.
      const rejectToolCallingSpy = vi
        .spyOn(result.current, 'rejectToolCalling')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.rejectAndContinueToolCalling('tool-msg-1', 'too risky');
      });

      expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '',
          parentMessageId: 'tool-msg-1',
          resumeApproval: {
            decision: 'rejected_continue',
            parentMessageId: 'tool-msg-1',
            rejectionReason: 'too risky',
            toolCallId: 'call_xyz',
          },
        }),
      );
      expect(executeClientAgentSpy).not.toHaveBeenCalled();
      expect(rejectToolCallingSpy).not.toHaveBeenCalled();

      executeGatewayAgentSpy.mockRestore();
    });
  });

  describe('submitToolInteraction', () => {
    it('continues a submitted interaction with the model persisted on its assistant turn', async () => {
      mockConstEnv.isDesktop = true;
      const { result } = renderHook(() => useChatStore());
      const agentId = 'submit-model-agent';
      const topicId = 'submit-model-topic';
      const chatKey = messageMapKey({ agentId, topicId });
      const assistantMessage = createMockMessage({
        id: 'assistant-submit-model',
        model: 'glm-original',
        provider: 'newapi',
        role: 'assistant',
      });
      const toolMessage = createMockMessage({
        id: 'tool-submit-model',
        parentId: assistantMessage.id,
        role: 'tool',
      });
      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          dbMessagesMap: { [chatKey]: [assistantMessage, toolMessage] },
          messagesMap: { [chatKey]: [assistantMessage, toolMessage] },
        });
      });
      vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(false);
      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
        agentConfig: createMockResolvedAgentConfig(),
        context: { phase: 'init' } as any,
        state: {} as any,
      });
      const executeClientAgent = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.submitToolInteraction(
          toolMessage.id,
          { answer: 'continue' },
          undefined,
          { createUserMessage: false },
        );
      });

      expect(executeClientAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          workingModel: { model: 'glm-original', provider: 'newapi' },
        }),
      );
    });

    it('routes a desktop tool-result-only submit through the client resume contract', async () => {
      mockConstEnv.isDesktop = true;
      const { result } = renderHook(() => useChatStore());
      const agentId = 'desktop-agent';
      const topicId = 'desktop-topic';
      const chatKey = messageMapKey({ agentId, topicId });
      const toolMessage = createMockMessage({
        id: 'tool-msg-result-only',
        plugin: {
          apiName: 'selectAgentTemplate',
          arguments: '{}',
          identifier: 'lobe-agent-marketplace',
          type: 'default',
        },
        role: 'tool',
      });

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          dbMessagesMap: { [chatKey]: [toolMessage] },
          messagesMap: { [chatKey]: [toolMessage] },
        });
      });

      vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(false);
      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      const executeGatewayAgent = vi
        .spyOn(result.current, 'executeGatewayAgent')
        .mockResolvedValue({} as any);
      const executeClientAgent = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);
      vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
        agentConfig: createMockResolvedAgentConfig(),
        context: { phase: 'init' } as any,
        state: {} as any,
      });

      await act(async () => {
        await result.current.submitToolInteraction(
          toolMessage.id,
          { templateId: 'template-1' },
          undefined,
          { createUserMessage: false, toolResultContent: 'Selected template' },
        );
      });

      expect(executeClientAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({ agentId, topicId }),
          initialContext: expect.objectContaining({ phase: 'tool_result' }),
          parentMessageId: toolMessage.id,
          parentMessageType: 'tool',
        }),
      );
      expect(executeGatewayAgent).not.toHaveBeenCalled();
    });

    it('routes a desktop submit with a synthetic user message through the client runtime', async () => {
      mockConstEnv.isDesktop = true;
      const { result } = renderHook(() => useChatStore());
      const agentId = 'desktop-agent';
      const topicId = 'desktop-topic';
      const chatKey = messageMapKey({ agentId, topicId });
      const toolMessage = createMockMessage({ id: 'tool-msg-submit', role: 'tool' });

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          dbMessagesMap: { [chatKey]: [toolMessage] },
          messagesMap: { [chatKey]: [toolMessage] },
        });
      });

      vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(false);
      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticCreateMessage').mockResolvedValue({
        id: 'submitted-user-msg',
        messages: [],
      });
      const executeGatewayAgent = vi
        .spyOn(result.current, 'executeGatewayAgent')
        .mockResolvedValue({} as any);
      const executeClientAgent = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);
      vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
        agentConfig: createMockResolvedAgentConfig(),
        context: { phase: 'init' } as any,
        state: {} as any,
      });

      await act(async () => {
        await result.current.submitToolInteraction(toolMessage.id, { answer: 'yes' });
      });

      expect(executeClientAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentMessageId: 'submitted-user-msg',
          parentMessageType: 'user',
        }),
      );
      expect(executeGatewayAgent).not.toHaveBeenCalled();
    });

    it('should create a user message and resume runtime from that user message', async () => {
      const { result } = renderHook(() => useChatStore());

      const agentId = 'global-agent';
      const topicId = 'global-topic';
      const chatKey = messageMapKey({ agentId, topicId });
      const response = {
        primaryUseCase: 'Writing documents',
        tone: 'Professional',
      };

      const onboardingUserMessage = createMockMessage({
        id: 'onboarding-user-msg',
        metadata: { trigger: RequestTrigger.Onboarding },
        role: 'user',
      });
      const onboardingAssistantMessage = createMockMessage({
        id: 'onboarding-assistant-msg',
        parentId: onboardingUserMessage.id,
        role: 'assistant',
      });
      const toolMessage = createMockMessage({
        groupId: 'group-1',
        id: 'tool-msg-1',
        parentId: onboardingAssistantMessage.id,
        plugin: {
          apiName: 'askUserQuestion',
          arguments: '{}',
          identifier: 'lobe-user-interaction',
          type: 'default',
        },
        role: 'tool',
      });

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          activeThreadId: undefined,
          dbMessagesMap: {
            [chatKey]: [onboardingUserMessage, onboardingAssistantMessage, toolMessage],
          },
          messagesMap: {
            [chatKey]: [onboardingUserMessage, onboardingAssistantMessage, toolMessage],
          },
        });
      });

      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);

      const userMessageId = 'submitted-user-msg';
      const optimisticCreateMessageSpy = vi
        .spyOn(result.current, 'optimisticCreateMessage')
        .mockImplementation(async (message) => {
          const userMessage = createMockMessage({
            content: message.content,
            groupId: message.groupId,
            id: userMessageId,
            role: 'user',
            topicId,
          });

          useChatStore.setState({
            dbMessagesMap: {
              [chatKey]: [
                onboardingUserMessage,
                onboardingAssistantMessage,
                toolMessage,
                userMessage,
              ],
            },
            messagesMap: {
              [chatKey]: [
                onboardingUserMessage,
                onboardingAssistantMessage,
                toolMessage,
                userMessage,
              ],
            },
          });

          return {
            id: userMessageId,
            messages: [onboardingUserMessage, onboardingAssistantMessage, toolMessage, userMessage],
          };
        });

      const initialContext = { phase: 'init' } as any;
      const internal_createAgentStateSpy = vi
        .spyOn(result.current, 'internal_createAgentState')
        .mockReturnValue({
          agentConfig: createMockResolvedAgentConfig(),
          context: initialContext,
          state: {} as any,
        });
      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.submitToolInteraction('tool-msg-1', response);
      });

      expect(optimisticCreateMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Writing documents, Professional',
          groupId: 'group-1',
          metadata: { trigger: RequestTrigger.Onboarding },
          role: 'user',
        }),
        expect.objectContaining({ operationId: expect.any(String) }),
      );

      expect(internal_createAgentStateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ id: 'tool-msg-1', role: 'tool' }),
            expect.objectContaining({ id: userMessageId, role: 'user' }),
          ]),
          parentMessageId: userMessageId,
        }),
      );

      expect(executeClientAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          initialContext,
          metadata: { trigger: RequestTrigger.Onboarding },
          parentMessageId: userMessageId,
          parentMessageType: 'user',
        }),
      );
    });

    it('should preserve request trigger metadata when resuming from tool result only', async () => {
      const { result } = renderHook(() => useChatStore());

      const agentId = 'global-agent';
      const topicId = 'global-topic';
      const chatKey = messageMapKey({ agentId, topicId });
      const response = {
        templateId: 'onboarding-template',
      };

      const onboardingUserMessage = createMockMessage({
        id: 'onboarding-user-msg',
        metadata: { trigger: RequestTrigger.Onboarding },
        role: 'user',
      });
      const onboardingAssistantMessage = createMockMessage({
        id: 'onboarding-assistant-msg',
        parentId: onboardingUserMessage.id,
        role: 'assistant',
      });
      const toolMessage = createMockMessage({
        groupId: 'group-1',
        id: 'tool-msg-1',
        parentId: onboardingAssistantMessage.id,
        plugin: {
          apiName: 'selectAgentTemplate',
          arguments: '{}',
          identifier: 'lobe-agent-marketplace',
          type: 'default',
        },
        role: 'tool',
      });

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          activeThreadId: undefined,
          dbMessagesMap: {
            [chatKey]: [onboardingUserMessage, onboardingAssistantMessage, toolMessage],
          },
          messagesMap: {
            [chatKey]: [onboardingUserMessage, onboardingAssistantMessage, toolMessage],
          },
        });
      });

      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticCreateMessage');

      const initialContext = { phase: 'init' } as any;
      vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
        agentConfig: createMockResolvedAgentConfig(),
        context: initialContext,
        state: {} as any,
      });
      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.submitToolInteraction('tool-msg-1', response, undefined, {
          createUserMessage: false,
          toolResultContent: 'Selected onboarding template',
        });
      });

      expect(result.current.optimisticCreateMessage).not.toHaveBeenCalled();
      expect(executeClientAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          initialContext: expect.objectContaining({
            phase: 'tool_result',
          }),
          metadata: { trigger: RequestTrigger.Onboarding },
          parentMessageId: 'tool-msg-1',
          parentMessageType: 'tool',
        }),
      );
    });

    it('should not reuse onboarding trigger metadata from an older message outside the active tool chain', async () => {
      const { result } = renderHook(() => useChatStore());

      const agentId = 'global-agent';
      const topicId = 'global-topic';
      const chatKey = messageMapKey({ agentId, topicId });

      const oldOnboardingMessage = createMockMessage({
        id: 'old-onboarding-user-msg',
        metadata: { trigger: RequestTrigger.Onboarding },
        role: 'user',
      });
      const normalUserMessage = createMockMessage({
        id: 'normal-user-msg',
        role: 'user',
      });
      const normalAssistantMessage = createMockMessage({
        id: 'normal-assistant-msg',
        parentId: normalUserMessage.id,
        role: 'assistant',
      });
      const normalToolMessage = createMockMessage({
        id: 'normal-tool-msg',
        parentId: normalAssistantMessage.id,
        plugin: {
          apiName: 'selectAgentTemplate',
          arguments: '{}',
          identifier: 'lobe-agent-marketplace',
          type: 'default',
        },
        role: 'tool',
      });

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          activeThreadId: undefined,
          dbMessagesMap: {
            [chatKey]: [
              oldOnboardingMessage,
              normalUserMessage,
              normalAssistantMessage,
              normalToolMessage,
            ],
          },
          messagesMap: {
            [chatKey]: [
              oldOnboardingMessage,
              normalUserMessage,
              normalAssistantMessage,
              normalToolMessage,
            ],
          },
        });
      });

      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
        agentConfig: createMockResolvedAgentConfig(),
        context: { phase: 'init' } as any,
        state: {} as any,
      });
      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.submitToolInteraction(
          normalToolMessage.id,
          { templateId: 'normal-template' },
          undefined,
          {
            createUserMessage: false,
            toolResultContent: 'Selected normal template',
          },
        );
      });

      expect(executeClientAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: undefined,
          parentMessageId: normalToolMessage.id,
          parentMessageType: 'tool',
        }),
      );
    });
  });

  describe('skipToolInteraction', () => {
    it('continues a skipped interaction with the model persisted on its assistant turn', async () => {
      mockConstEnv.isDesktop = true;
      const { result } = renderHook(() => useChatStore());
      const agentId = 'skip-model-agent';
      const topicId = 'skip-model-topic';
      const chatKey = messageMapKey({ agentId, topicId });
      const assistantMessage = createMockMessage({
        id: 'assistant-skip-model',
        model: 'glm-original',
        provider: 'newapi',
        role: 'assistant',
      });
      const toolMessage = createMockMessage({
        id: 'tool-skip-model',
        parentId: assistantMessage.id,
        role: 'tool',
      });
      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          dbMessagesMap: { [chatKey]: [assistantMessage, toolMessage] },
          messagesMap: { [chatKey]: [assistantMessage, toolMessage] },
        });
      });
      vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(false);
      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticCreateMessage').mockResolvedValue({
        id: 'skip-user-message',
        messages: [],
      });
      vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
        agentConfig: createMockResolvedAgentConfig(),
        context: { phase: 'init' } as any,
        state: {} as any,
      });
      const executeClientAgent = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.skipToolInteraction(toolMessage.id, 'not needed');
      });

      expect(executeClientAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          workingModel: { model: 'glm-original', provider: 'newapi' },
        }),
      );
    });

    it('routes a desktop skip through the client runtime', async () => {
      mockConstEnv.isDesktop = true;
      const { result } = renderHook(() => useChatStore());
      const agentId = 'desktop-agent';
      const topicId = 'desktop-topic';
      const chatKey = messageMapKey({ agentId, topicId });
      const toolMessage = createMockMessage({ id: 'tool-msg-skip', role: 'tool' });

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          dbMessagesMap: { [chatKey]: [toolMessage] },
          messagesMap: { [chatKey]: [toolMessage] },
        });
      });

      vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(false);
      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticCreateMessage').mockResolvedValue({
        id: 'skipped-user-msg',
        messages: [],
      });
      const executeGatewayAgent = vi
        .spyOn(result.current, 'executeGatewayAgent')
        .mockResolvedValue({} as any);
      const executeClientAgent = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);
      vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
        agentConfig: createMockResolvedAgentConfig(),
        context: { phase: 'init' } as any,
        state: {} as any,
      });

      await act(async () => {
        await result.current.skipToolInteraction(toolMessage.id, 'later');
      });

      expect(executeClientAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentMessageId: 'skipped-user-msg',
          parentMessageType: 'user',
        }),
      );
      expect(executeGatewayAgent).not.toHaveBeenCalled();
    });

    it('should create a user message and resume runtime from that user message', async () => {
      const { result } = renderHook(() => useChatStore());

      const agentId = 'global-agent';
      const topicId = 'global-topic';
      const chatKey = messageMapKey({ agentId, topicId });
      const reason = 'Need to decide later';

      const onboardingUserMessage = createMockMessage({
        id: 'onboarding-user-msg',
        metadata: { trigger: RequestTrigger.Onboarding },
        role: 'user',
      });
      const onboardingAssistantMessage = createMockMessage({
        id: 'onboarding-assistant-msg',
        parentId: onboardingUserMessage.id,
        role: 'assistant',
      });
      const toolMessage = createMockMessage({
        groupId: 'group-1',
        id: 'tool-msg-1',
        parentId: onboardingAssistantMessage.id,
        plugin: {
          apiName: 'askUserQuestion',
          arguments: '{}',
          identifier: 'lobe-user-interaction',
          type: 'default',
        },
        role: 'tool',
      });

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          activeThreadId: undefined,
          dbMessagesMap: {
            [chatKey]: [onboardingUserMessage, onboardingAssistantMessage, toolMessage],
          },
          messagesMap: {
            [chatKey]: [onboardingUserMessage, onboardingAssistantMessage, toolMessage],
          },
        });
      });

      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);

      const userMessageId = 'skipped-user-msg';
      const optimisticCreateMessageSpy = vi
        .spyOn(result.current, 'optimisticCreateMessage')
        .mockImplementation(async (message) => {
          const userMessage = createMockMessage({
            content: message.content,
            groupId: message.groupId,
            id: userMessageId,
            role: 'user',
            topicId,
          });

          useChatStore.setState({
            dbMessagesMap: {
              [chatKey]: [
                onboardingUserMessage,
                onboardingAssistantMessage,
                toolMessage,
                userMessage,
              ],
            },
            messagesMap: {
              [chatKey]: [
                onboardingUserMessage,
                onboardingAssistantMessage,
                toolMessage,
                userMessage,
              ],
            },
          });

          return {
            id: userMessageId,
            messages: [onboardingUserMessage, onboardingAssistantMessage, toolMessage, userMessage],
          };
        });

      const initialContext = { phase: 'init' } as any;
      const internal_createAgentStateSpy = vi
        .spyOn(result.current, 'internal_createAgentState')
        .mockReturnValue({
          agentConfig: createMockResolvedAgentConfig(),
          context: initialContext,
          state: {} as any,
        });
      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.skipToolInteraction('tool-msg-1', reason);
      });

      expect(optimisticCreateMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          content: `I'll skip this. ${reason}`,
          groupId: 'group-1',
          metadata: { trigger: RequestTrigger.Onboarding },
          role: 'user',
        }),
        expect.objectContaining({ operationId: expect.any(String) }),
      );

      expect(internal_createAgentStateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ id: 'tool-msg-1', role: 'tool' }),
            expect.objectContaining({ id: userMessageId, role: 'user' }),
          ]),
          parentMessageId: userMessageId,
        }),
      );

      expect(executeClientAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          initialContext,
          metadata: { trigger: RequestTrigger.Onboarding },
          parentMessageId: userMessageId,
          parentMessageType: 'user',
        }),
      );
    });

    it('should preserve request trigger from raw messages when display messages are incomplete', async () => {
      const { result } = renderHook(() => useChatStore());

      const agentId = 'global-agent';
      const topicId = 'global-topic';
      const chatKey = messageMapKey({ agentId, topicId });

      const onboardingUserMessage = createMockMessage({
        id: 'onboarding-user-msg',
        metadata: { trigger: RequestTrigger.Onboarding },
        role: 'user',
      });
      const onboardingAssistantMessage = createMockMessage({
        id: 'onboarding-assistant-msg',
        parentId: onboardingUserMessage.id,
        role: 'assistant',
      });
      const toolMessage = createMockMessage({
        groupId: 'group-1',
        id: 'tool-msg-1',
        parentId: onboardingAssistantMessage.id,
        plugin: {
          apiName: 'showAgentMarketplace',
          arguments: '{}',
          identifier: 'lobe-web-onboarding',
          type: 'default',
        },
        role: 'tool',
      });

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          activeThreadId: undefined,
          dbMessagesMap: {
            [chatKey]: [onboardingUserMessage, onboardingAssistantMessage, toolMessage],
          },
          messagesMap: {
            [chatKey]: [toolMessage],
          },
        });
      });

      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);

      const userMessageId = 'skipped-user-msg';
      const optimisticCreateMessageSpy = vi
        .spyOn(result.current, 'optimisticCreateMessage')
        .mockImplementation(async (message) => {
          const userMessage = createMockMessage({
            content: message.content,
            groupId: message.groupId,
            id: userMessageId,
            metadata: message.metadata,
            role: 'user',
            topicId,
          });

          useChatStore.setState({
            dbMessagesMap: {
              [chatKey]: [
                onboardingUserMessage,
                onboardingAssistantMessage,
                toolMessage,
                userMessage,
              ],
            },
            messagesMap: {
              [chatKey]: [toolMessage, userMessage],
            },
          });

          return {
            id: userMessageId,
            messages: [onboardingUserMessage, onboardingAssistantMessage, toolMessage, userMessage],
          };
        });

      vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
        agentConfig: createMockResolvedAgentConfig(),
        context: { phase: 'init' } as any,
        state: {} as any,
      });
      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.skipToolInteraction('tool-msg-1');
      });

      expect(optimisticCreateMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { trigger: RequestTrigger.Onboarding },
        }),
        expect.objectContaining({ operationId: expect.any(String) }),
      );
      expect(executeClientAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { trigger: RequestTrigger.Onboarding },
          parentMessageId: userMessageId,
          parentMessageType: 'user',
        }),
      );
    });
  });

  describe('rejectAndContinueToolCalling', () => {
    it.each(['scratch', 'device'] as const)(
      'resumes rejected %s tools with the paused authority after workspace state changes',
      async (kind) => {
        const { executeClientAgent, pausedExecutionContext, result, toolMessage } =
          setupPausedAuthorityResume(kind, 'reject');
        vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);

        await act(async () => {
          await result.current.rejectAndContinueToolCalling(toolMessage.id, 'not now');
        });

        expect(executeClientAgent).toHaveBeenCalledWith(
          expect.objectContaining({ executionContext: pausedExecutionContext }),
        );
        expect(result.current.pausedExecutionContextByMessage[toolMessage.id]).toBeUndefined();
      },
    );

    it('continues a rejected assistant turn with the model persisted on that turn', async () => {
      const { result } = renderHook(() => useChatStore());
      const agentId = 'reject-model-agent';
      const topicId = 'reject-model-topic';
      const key = messageMapKey({ agentId, topicId });
      const assistantMessage = createMockMessage({
        id: 'assistant-reject-model',
        model: 'glm-original',
        provider: 'newapi',
        role: 'assistant',
      });
      const toolMessage = createMockMessage({
        id: 'tool-reject-model',
        parentId: assistantMessage.id,
        plugin: {
          apiName: 'runCommand',
          arguments: '{}',
          identifier: 'local-system',
          type: 'default',
        },
        role: 'tool',
        tool_call_id: 'call-reject-model',
      });
      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          dbMessagesMap: { [key]: [assistantMessage, toolMessage] },
          messagesMap: { [key]: [assistantMessage, toolMessage] },
        });
      });
      vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(false);
      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
        state: {} as any,
        context: { phase: 'init' } as any,
        agentConfig: createMockResolvedAgentConfig(),
      });
      const executeClientAgent = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.rejectAndContinueToolCalling(toolMessage.id, 'not now');
      });

      expect(executeClientAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          workingModel: { model: 'glm-original', provider: 'newapi' },
        }),
      );
    });

    it('should use provided context instead of global state', async () => {
      const { result } = renderHook(() => useChatStore());

      const globalAgentId = 'global-agent';
      const builderAgentId = 'builder-agent';
      const builderTopicId = 'builder-topic';

      // Create tool message
      const toolMessage = createMockMessage({
        id: 'tool-msg-1',
        role: 'tool',
        plugin: { identifier: 'test-plugin', type: 'default', arguments: '{}', apiName: 'test' },
      });

      const globalKey = messageMapKey({ agentId: globalAgentId, topicId: null });
      const builderKey = messageMapKey({
        agentId: builderAgentId,
        topicId: builderTopicId,
        scope: 'agent_builder',
      });

      act(() => {
        useChatStore.setState({
          activeAgentId: globalAgentId,
          activeTopicId: undefined,
          dbMessagesMap: {
            [globalKey]: [createMockMessage({ id: 'global-msg', role: 'user' })],
            [builderKey]: [toolMessage],
          },
          messagesMap: {
            [globalKey]: [createMockMessage({ id: 'global-msg', role: 'user' })],
            [builderKey]: [toolMessage],
          },
        });
      });

      // Mock internal methods
      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      const internal_createAgentStateSpy = vi
        .spyOn(result.current, 'internal_createAgentState')
        .mockReturnValue({
          state: {} as any,
          context: { phase: 'init' } as any,
          agentConfig: createMockResolvedAgentConfig(),
        });
      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      // Call with builder context
      const context: ConversationContext = {
        agentId: builderAgentId,
        topicId: builderTopicId,
        scope: 'agent_builder',
      };

      await act(async () => {
        await result.current.rejectAndContinueToolCalling('tool-msg-1', 'User rejected', context);
      });

      // Verify internal_createAgentState was called with builder context
      expect(internal_createAgentStateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: builderAgentId,
          topicId: builderTopicId,
        }),
      );

      // Verify executeClientAgent was called with builder context (now wrapped in context object)
      expect(executeClientAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            agentId: builderAgentId,
            topicId: builderTopicId,
            scope: 'agent_builder',
          }),
        }),
      );
    });

    it('should fallback to global state when context not provided', async () => {
      const { result } = renderHook(() => useChatStore());

      const globalAgentId = 'global-agent';
      const globalTopicId = 'global-topic';

      // Create tool message
      const toolMessage = createMockMessage({
        id: 'tool-msg-1',
        role: 'tool',
        plugin: { identifier: 'test-plugin', type: 'default', arguments: '{}', apiName: 'test' },
      });

      const globalKey = messageMapKey({ agentId: globalAgentId, topicId: globalTopicId });

      act(() => {
        useChatStore.setState({
          activeAgentId: globalAgentId,
          activeTopicId: globalTopicId,
          activeThreadId: undefined,
          dbMessagesMap: {
            [globalKey]: [toolMessage],
          },
          messagesMap: {
            [globalKey]: [toolMessage],
          },
        });
      });

      // Mock internal methods
      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      const internal_createAgentStateSpy = vi
        .spyOn(result.current, 'internal_createAgentState')
        .mockReturnValue({
          state: {} as any,
          context: { phase: 'init' } as any,
          agentConfig: createMockResolvedAgentConfig(),
        });
      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      // Call without context
      await act(async () => {
        await result.current.rejectAndContinueToolCalling('tool-msg-1', 'User rejected');
      });

      // Verify internal_createAgentState was called with global context
      expect(internal_createAgentStateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: globalAgentId,
          topicId: globalTopicId,
        }),
      );

      // Verify executeClientAgent was called with global context
      expect(executeClientAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            agentId: globalAgentId,
            topicId: globalTopicId,
          }),
        }),
      );
    });
  });

  // ===========================================================================
  // CHARACTERIZATION TESTS (lifecycle refactor regression net)
  //
  // Lock the CURRENT behavior of these non-sendMessage entry points so an
  // upcoming lifecycle refactor cannot silently change them. They assert what
  // the code does NOW.
  // ===========================================================================
  describe('rejectAndContinueToolCalling client characterization (lifecycle refactor regression net)', () => {
    it('runs rejectToolCalling (one op completes) then starts a NEW op and executes client agent with phase=user_input', async () => {
      const { result } = renderHook(() => useChatStore());

      const agentId = 'client-agent';
      const topicId = 'client-topic';
      const chatKey = messageMapKey({ agentId, topicId });

      const toolMessage = createMockMessage({
        id: 'tool-msg-1',
        plugin: { apiName: 'test', arguments: '{}', identifier: 'test-plugin', type: 'default' },
        role: 'tool',
        tool_call_id: 'call_client',
      } as any);

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          activeThreadId: undefined,
          dbMessagesMap: { [chatKey]: [toolMessage] },
          messagesMap: { [chatKey]: [toolMessage] },
        });
      });

      // Client-mode (no Gateway resume): let the real rejectToolCalling chain
      // run so we can observe the dual-op sequence. Only stub the persistence
      // primitives and the runtime executor.
      vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(false);
      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      const rejectToolCallingSpy = vi.spyOn(result.current, 'rejectToolCalling');
      vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
        agentConfig: createMockResolvedAgentConfig(),
        context: { phase: 'init' } as any,
        state: {} as any,
      });
      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.rejectAndContinueToolCalling('tool-msg-1', 'not safe');
      });

      // 1) The halting reject runs first (it creates + completes its own op).
      expect(rejectToolCallingSpy).toHaveBeenCalledWith('tool-msg-1', 'not safe', undefined);

      // 2) Then a SECOND op is created and the client runtime continues with
      //    phase overridden to 'user_input', resuming from the tool message.
      expect(executeClientAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          initialContext: expect.objectContaining({ phase: 'user_input' }),
          parentMessageId: 'tool-msg-1',
          parentMessageType: 'tool',
        }),
      );

      // Two 'rejectToolCalling' ops exist (the halting reject's own op + the
      // continue op). Both reach 'completed' on the happy path.
      const rejectOps = Object.values(result.current.operations).filter(
        (op: any) => op.type === 'rejectToolCalling',
      );
      expect(rejectOps).toHaveLength(2);
      expect(rejectOps.every((op: any) => op.status === 'completed')).toBe(true);
    });
  });

  describe('submitHeteroIntervention characterization (lifecycle refactor regression net)', () => {
    it('submits via IPC, persists optimistic intervention, and flips topic status to running (submit)', async () => {
      const { result } = renderHook(() => useChatStore());

      const agentId = 'hetero-agent';
      const topicId = 'hetero-topic';
      const chatKey = messageMapKey({ agentId, topicId });

      const assistantMessage = createMockMessage({
        id: 'assistant-msg-1',
        role: 'assistant',
      });
      const toolMessage = createMockMessage({
        id: 'tool-msg-1',
        parentId: assistantMessage.id,
        plugin: {
          apiName: 'askUserQuestion',
          arguments: '{}',
          identifier: 'lobe-claude-code',
          type: 'default',
        },
        role: 'tool',
        tool_call_id: 'cc_call_1',
      } as any);

      let assistantOpId!: string;
      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          activeThreadId: undefined,
          dbMessagesMap: { [chatKey]: [assistantMessage, toolMessage] },
          messagesMap: { [chatKey]: [assistantMessage, toolMessage] },
        });

        // The running CC stream op is associated with the assistant that owns
        // the tool message; submitHeteroIntervention walks up to find it.
        assistantOpId = result.current.startOperation({
          context: { agentId, topicId, threadId: null },
          type: 'execHeterogeneousAgent',
        }).operationId;

        useChatStore.setState((s) => ({
          messageOperationMap: { ...s.messageOperationMap, [assistantMessage.id]: assistantOpId },
        }));
      });

      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      const updateTopicStatusSpy = vi
        .spyOn(result.current, 'updateTopicStatus')
        .mockResolvedValue(undefined as any);
      const submitInterventionSpy = vi
        .spyOn(heterogeneousAgentService, 'submitIntervention')
        .mockResolvedValue(undefined as any);

      const payload = { 'Which color?': 'Blue' };
      await act(async () => {
        await result.current.submitHeteroIntervention('tool-msg-1', 'submit', payload);
      });

      // Optimistic approval runs against the resolved op (operationId carried).
      expect(result.current.optimisticUpdateMessagePlugin).toHaveBeenCalledWith(
        'tool-msg-1',
        { intervention: { status: 'approved' } },
        { operationId: assistantOpId },
      );

      // IPC submit forwards the resolved operationId + toolCallId + result.
      expect(submitInterventionSpy).toHaveBeenCalledWith({
        operationId: assistantOpId,
        result: payload,
        toolCallId: 'cc_call_1',
      });

      // Topic row flips back from waitingForHuman to running.
      expect(updateTopicStatusSpy).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'running', topicId }),
      );
    });

    it("CURRENT BEHAVIOR: falls back to global-state optimistic context (empty op) and still submits when the operation is GC'd", async () => {
      // Characterizes action.ts ~735/~758: when the resolved op has already been
      // garbage-collected (not present in `operations`), the optimistic context
      // is the empty object `{}` (global-state fallback) rather than carrying the
      // stale operationId — but the IPC submit STILL fires with that operationId,
      // and the call does NOT throw. Locked as-is.
      const { result } = renderHook(() => useChatStore());

      const agentId = 'hetero-agent';
      const topicId = 'hetero-topic';
      const chatKey = messageMapKey({ agentId, topicId });

      const assistantMessage = createMockMessage({ id: 'assistant-msg-1', role: 'assistant' });
      const toolMessage = createMockMessage({
        id: 'tool-msg-1',
        parentId: assistantMessage.id,
        plugin: {
          apiName: 'askUserQuestion',
          arguments: '{}',
          identifier: 'lobe-claude-code',
          type: 'default',
        },
        role: 'tool',
        tool_call_id: 'cc_call_1',
      } as any);

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          activeThreadId: undefined,
          dbMessagesMap: { [chatKey]: [assistantMessage, toolMessage] },
          messagesMap: { [chatKey]: [assistantMessage, toolMessage] },
          // Point the assistant at an opId that does NOT exist in `operations`
          // (simulating a garbage-collected / completed-and-pruned op).
          messageOperationMap: { [assistantMessage.id]: 'gc-op-id' },
          operations: {},
        });
      });

      const pluginSpy = vi
        .spyOn(result.current, 'optimisticUpdateMessagePlugin')
        .mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'updateTopicStatus').mockResolvedValue(undefined as any);
      const submitInterventionSpy = vi
        .spyOn(heterogeneousAgentService, 'submitIntervention')
        .mockResolvedValue(undefined as any);

      await act(async () => {
        await expect(
          result.current.submitHeteroIntervention('tool-msg-1', 'cancel'),
        ).resolves.toBeUndefined();
      });

      // Optimistic write uses the empty global-state fallback context.
      expect(pluginSpy).toHaveBeenCalledWith(
        'tool-msg-1',
        expect.objectContaining({ intervention: expect.objectContaining({ status: 'rejected' }) }),
        {},
      );

      // IPC submit still fires with the (stale) resolved operationId + cancel.
      expect(submitInterventionSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cancelled: true,
          operationId: 'gc-op-id',
          toolCallId: 'cc_call_1',
        }),
      );
    });
  });
});
