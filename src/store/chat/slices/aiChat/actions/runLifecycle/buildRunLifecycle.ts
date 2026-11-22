import type { AgentState } from '@lobechat/agent-runtime';
import { isDesktop } from '@lobechat/const';
import type { ConversationContext, UIChatMessage } from '@lobechat/types';
import { t } from 'i18next';

import { OperationWorkspaceScanError } from '@/services/operationWorkspaceScan';
import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import type { AgentRuntimeType } from '@/store/chat/slices/aiChat/actions/agentDispatcher';
import { emitClientAgentSignalSourceEvent } from '@/store/chat/slices/aiChat/actions/agentSignalBridge';
import { type ChatStore, useChatStore } from '@/store/chat/store';
import { resolveNotificationNavigatePath } from '@/store/chat/utils/desktopNotification';
import { markdownToTxt } from '@/utils/markdownToTxt';

import { messageMapKey } from '../../../../utils/messageMapKey';
import { topicMapKey } from '../../../../utils/topicMapKey';
import type { OperationStatus } from '../../../operation/types';
import { mergeQueuedMessages, reconstructUploadFilesFromQueue } from '../../../operation/types';
import type { AgentRunLifecycle, RunCompleteEvent, RunCompleteResult, RunScope } from './types';

/**
 * Normalize the runtime/operation status into the cross-runtime
 * `client.runtime.complete` signal status. Relocated verbatim from
 * `streamingExecutor` — kept identical for behavior preservation.
 *
 * NOTE: `waiting_for_human` is encoded as `cancelled` (a parked state mis-encoded as terminal) and
 * `waiting_for_async_tool` falls through to `undefined`. Both are parked, not
 * terminal — this mis-encoding is locked by characterization tests and fixed
 * when the parked/resumed signal is unified.
 */
const normalizeClientRuntimeCompleteStatus = (
  runtimeStatus: AgentState['status'] | undefined,
  operationStatus?: OperationStatus,
): 'cancelled' | 'completed' | 'failed' | undefined => {
  if (operationStatus === 'cancelled') return 'cancelled';
  if (operationStatus === 'failed') return 'failed';
  if (runtimeStatus === 'waiting_for_human') return 'cancelled';
  if (operationStatus === 'completed') return 'completed';
  if (runtimeStatus === 'done') return 'completed';
  if (runtimeStatus === 'error' || runtimeStatus === 'interrupted') return 'failed';
  return undefined;
};

const findCompletionAssistantMessageId = (
  messages: UIChatMessage[],
  parentMessageId: string,
  parentMessageType: 'user' | 'assistant' | 'tool',
) => {
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  const parentMessage = messagesById.get(parentMessageId);
  const isDescendantOfParent = (message: UIChatMessage) => {
    let currentParentId = message.parentId;
    const visited = new Set<string>();

    while (currentParentId && !visited.has(currentParentId)) {
      if (currentParentId === parentMessageId) return true;
      visited.add(currentParentId);
      currentParentId = messagesById.get(currentParentId)?.parentId;
    }

    return false;
  };

  return (
    messages.findLast((message) => message.role === 'assistant' && isDescendantOfParent(message))
      ?.id ??
    (parentMessageType === 'assistant' && parentMessage?.role === 'assistant'
      ? parentMessage.id
      : undefined)
  );
};

/**
 * Per-run context resolved at the dispatch seam (or, transitionally, inside the
 * executor). Carries everything the lifecycle hooks need beyond the per-call
 * event so they can be assembled ONCE and called at runtime boundaries.
 */
export interface RunAdapterContext {
  context: ConversationContext;
  parentMessageId: string;
  parentMessageType: 'user' | 'assistant' | 'tool';
  runId: string;
  runScope: RunScope;
  runtimeType: AgentRuntimeType;
}

const NOOP = async () => {};

/**
 * Assemble the store/UI run-lifecycle hooks for a single run.
 *
 * Phase 1 (behavior-preserving): the implementations are the CLIENT
 * completion effects relocated verbatim from `streamingExecutor`, so wiring the
 * client executor to these hooks keeps the characterization net green. The
 * gateway/hetero adapters are wired in the follow-up transport unification, where the currently-missing
 * effects (title / notification / queue on gateway) are folded in.
 */
export const buildRunLifecycle = (
  get: () => ChatStore,
  adapter: RunAdapterContext,
): AgentRunLifecycle => {
  const { context, parentMessageId, parentMessageType } = adapter;
  const { agentId, topicId, threadId, groupId } = context;
  const messageKey = messageMapKey(context);
  const contextKey = messageKey;

  const emitComplete = (operationId: string, runtimeStatus: AgentState['status'] | undefined) => {
    const finalMessages = get().messagesMap[messageKey] || [];
    const assistantMessageId =
      findCompletionAssistantMessageId(finalMessages, parentMessageId, parentMessageType) ??
      findCompletionAssistantMessageId(
        get().dbMessagesMap[messageKey] || [],
        parentMessageId,
        parentMessageType,
      );
    const operationStatus = get().operations[operationId]?.status;

    void emitClientAgentSignalSourceEvent({
      payload: {
        agentId,
        ...(assistantMessageId ? { anchorMessageId: assistantMessageId } : {}),
        assistantMessageId,
        operationId,
        status: normalizeClientRuntimeCompleteStatus(runtimeStatus, operationStatus),
        threadId: threadId ?? undefined,
        topicId: topicId ?? undefined,
        ...(parentMessageType === 'user' ? { triggerMessageId: parentMessageId } : {}),
      },
      sourceId: `${operationId}:client:complete`,
      sourceType: 'client.runtime.complete',
    });
  };

  return {
    afterUserMessagePersisted: NOOP,
    afterRunComplete: async ({ operationId }: RunCompleteEvent) => {
      // Desktop notification (only outside tool-calling mode). Relocated verbatim.
      if (!isDesktop) return;
      try {
        const finalMessages = get().messagesMap[messageKey] || [];
        const lastAssistant = finalMessages.findLast((m) => m.role === 'assistant');

        if (lastAssistant?.content && !lastAssistant?.tools) {
          const { desktopNotificationService } =
            await import('@/services/electron/desktopNotification');

          let notificationTitle = t('notification.finishChatGeneration', { ns: 'electron' });
          if (topicId) {
            const key = topicMapKey({ agentId, groupId });
            const topicData = get().topicDataMap[key];
            const topic = topicData?.items?.find((item) => item.id === topicId);
            if (topic?.title) notificationTitle = topic.title;
          } else {
            const agentMeta = agentSelectors.getAgentMetaById(agentId)(getAgentStoreState());
            if (agentMeta?.title) notificationTitle = agentMeta.title;
          }

          const navigatePath = resolveNotificationNavigatePath({ agentId, groupId, topicId });

          await desktopNotificationService.showNotification({
            body: markdownToTxt(lastAssistant.content),
            navigate: navigatePath ? { path: navigatePath } : undefined,
            title: notificationTitle,
          });
        }
      } catch (error) {
        console.error('Desktop notification error:', error);
      }
      void operationId;
    },
    beforeRunComplete: NOOP,
    completeRun: async ({
      operationId,
      runtimeStatus,
    }: RunCompleteEvent): Promise<RunCompleteResult> => {
      const operation = get().operations[operationId];
      const afterCompletionCallbacks = [
        ...(operation?.metadata?.runtimeHooks?.afterCompletionCallbacks ?? []),
      ];

      // 1. Put the root operation into its terminal state before starting any optional
      //    completion work. Tool callbacks are user/plugin code and must never keep the
      //    operation in `running`, even when one returns a promise that never settles.
      switch (runtimeStatus) {
        case 'idle':
        case 'running': {
          get().failOperation(operationId, {
            type: 'runtime_invariant_error',
            message: `Agent runtime reached completion with non-terminal status: ${runtimeStatus}`,
          });
          break;
        }
        case 'done': {
          get().completeOperation(operationId);
          const completedOp = get().operations[operationId];
          if (completedOp?.context.agentId) {
            get().markUnreadCompleted(completedOp.context.agentId, completedOp.context.topicId);
          }
          break;
        }
        case 'error': {
          get().failOperation(operationId, {
            type: 'runtime_error',
            message: 'Agent runtime execution failed',
          });
          break;
        }
        case 'waiting_for_human': {
          // Parked for human intervention: complete this op so the loading UI
          // clears; a new operation runs when the user approves/rejects.
          get().completeOperation(operationId);
          break;
        }
      }

      // 2. afterCompletion callbacks — invoke on ALL terminal states, but never await
      //    them. Attach the rejection handler immediately so a rejection that arrives
      //    after completeRun returns cannot become unhandled.
      for (const callback of afterCompletionCallbacks) {
        try {
          void Promise.resolve(callback()).catch((error) => {
            console.error('[executeClientAgent] afterCompletion callback error:', error);
          });
        } catch (error) {
          // A callback can still throw synchronously before returning a promise.
          console.error('[executeClientAgent] afterCompletion callback error:', error);
        }
      }

      // 3. On success with queued messages: drain and re-trigger a new sendMessage.
      //    Only drain on success — on error the queue is preserved.
      if (runtimeStatus === 'done') {
        const remainingQueued = get().drainQueuedMessages(contextKey);
        if (remainingQueued.length > 0) {
          const merged = mergeQueuedMessages(remainingQueued);

          emitComplete(operationId, runtimeStatus);

          const execContext = { ...context };
          const mergedContent = merged.content;
          const mergedFiles =
            merged.filesPreview.length > 0
              ? reconstructUploadFilesFromQueue(merged.filesPreview)
              : merged.files.length > 0
                ? (merged.files.map((id) => ({ id })) as any)
                : undefined;

          setTimeout(() => {
            useChatStore
              .getState()
              .sendMessage({
                context: execContext,
                editorData: merged.editorData,
                files: mergedFiles,
                ...(merged.forceRuntime ? { forceRuntime: merged.forceRuntime } : {}),
                message: mergedContent,
                metadata: merged.metadata,
              })
              .catch((e: unknown) => {
                console.error('[executeClientAgent] sendMessage for queued content failed:', e);
              });
          }, 100);

          return { requeued: true };
        }
      }

      emitComplete(operationId, runtimeStatus);

      return { requeued: false };
    },
    onRunError: async ({ error, operationId }) => {
      const operation = get().operations[operationId];
      if (!operation || !['pending', 'running', 'paused'].includes(operation.status)) return;

      get().failOperation(operationId, {
        type: error instanceof Error ? error.name || 'runtime_error' : 'runtime_error',
        message: error instanceof Error ? error.message : 'Agent runtime execution failed',
      });
      // Preparation failures happen before the runtime emits an error event.
      // Surface them on this run's assistant, including grouped transcripts,
      // so the normal retry control remains reachable after a failed scan.
      if (adapter.runtimeType === 'client') {
        const assistantId = findCompletionAssistantMessageId(
          get().dbMessagesMap[messageKey] || [],
          parentMessageId,
          parentMessageType,
        );
        if (assistantId) {
          void get()
            .optimisticUpdateMessageError(
              assistantId,
              {
                ...(error instanceof OperationWorkspaceScanError
                  ? {
                      body: {
                        workspaceScanCode: error.code,
                        workspaceScanLocalMacDeviceId: error.localMacDeviceId,
                      },
                    }
                  : {}),
                type: 'AgentRuntimeError',
                message: error instanceof Error ? error.message : 'Agent runtime execution failed',
              },
              { operationId },
            )
            .catch(() => {});
        }
      }
    },
    onRunParked: NOOP,
    onRunResumed: NOOP,
    onRunStarted: NOOP,
    onTerminalPersisted: NOOP,
  };
};
