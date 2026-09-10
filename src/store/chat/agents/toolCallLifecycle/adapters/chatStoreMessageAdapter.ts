import type {
  BuiltinToolResult,
  ChatMessagePluginError,
  CreateMessageParams,
  ExecutionApprovalMode,
} from '@lobechat/types';

import { shouldPauseForPathConsent } from '@/helpers/executionContext/credentialPath';
import { getRuntimePathConsentRequest } from '@/helpers/executionContext/pathConsent';
import { truncateToolResult } from '@/server/utils/truncateToolResult';
import { messageService } from '@/services/message';
import { archiveToolResultViaServer } from '@/services/toolResultArchive';
import { type ChatStore } from '@/store/chat/store';

import { type ToolCallCommand, type ToolCallLifecycleDependencies } from '../ToolCallLifecycle';

type MessagePort = ToolCallLifecycleDependencies['messages'];

interface CreateMessageAdapterInput {
  approvalMode?: ExecutionApprovalMode;
  context: ToolCallCommand['context'];
  get: () => ChatStore;
  messageAgentId?: string;
  messageGroupId?: string;
}

const toPluginError = (result: BuiltinToolResult): ChatMessagePluginError | undefined =>
  result.error
    ? {
        body: result.error.body,
        message: result.error.message,
        type: result.error.type as ChatMessagePluginError['type'],
      }
    : undefined;

const toAbortError = (reason?: unknown) =>
  reason instanceof Error
    ? reason
    : Object.assign(new Error('Tool result sync cancelled'), { name: 'AbortError' });

const throwIfAborted = (signal: AbortSignal) => {
  if (signal.aborted) throw toAbortError(signal.reason);
};

const waitForArchive = async (task: Promise<string>, signal: AbortSignal): Promise<string> => {
  throwIfAborted(signal);

  let abortListener: (() => void) | undefined;
  const cancellation = new Promise<never>((_, reject) => {
    abortListener = () => reject(toAbortError(signal.reason));
    signal.addEventListener('abort', abortListener, { once: true });
  });

  try {
    return await Promise.race([task, cancellation]);
  } finally {
    if (abortListener) signal.removeEventListener('abort', abortListener);
  }
};

/**
 * Adapt the lifecycle's narrow message port to optimistic renderer state plus strict server acks.
 * The adapter instance is scoped to one call_tool invocation, so retry attempts reuse one archived
 * payload and project it into Zustand only once.
 */
export const createChatStoreToolCallMessageAdapter = ({
  approvalMode,
  context,
  get,
  messageAgentId,
  messageGroupId,
}: CreateMessageAdapterInput): MessagePort => {
  const preparedLocally = new Set<string>();
  const projectedExecutions = new Set<string>();
  const committedResults = new Map<string, BuiltinToolResult>();

  return {
    ensurePrepared: async ({
      context: messageContext,
      messageId,
      operationId,
      parentMessageId,
      projectLocally,
      signal,
      toolCall,
    }) => {
      throwIfAborted(signal);
      const agentId = messageAgentId ?? messageContext.agentId;
      const groupId = messageGroupId ?? messageContext.groupId;
      if (projectLocally && !preparedLocally.has(messageId)) {
        const optimisticMessage: CreateMessageParams = {
          agentId,
          content: '',
          groupId,
          parentId: parentMessageId,
          plugin: toolCall,
          role: 'tool',
          threadId: messageContext.threadId,
          tool_call_id: toolCall.id,
          topicId: messageContext.topicId ?? undefined,
        };
        get().optimisticCreateTmpMessage(optimisticMessage, {
          operationId,
          tempMessageId: messageId,
        });
        preparedLocally.add(messageId);
      }
      throwIfAborted(signal);

      const acknowledgement = await messageService.ensureToolMessage(
        {
          agentId,
          groupId,
          id: messageId,
          mode: projectLocally ? 'create-or-confirm' : 'confirm-existing',
          parentMessageId,
          threadId: messageContext.threadId,
          toolCall: {
            apiName: toolCall.apiName,
            arguments: toolCall.arguments,
            executor: toolCall.executor,
            identifier: toolCall.identifier,
            intervention: toolCall.intervention,
            // Reconciliation backfills the tool row itself for display. That
            // derived pointer was absent from the original execution intent.
            result_msg_id:
              toolCall.result_msg_id === messageId ? undefined : toolCall.result_msg_id,
            // The builtin registry supplies this on first execution; the DB
            // plugin projection omits it on approval resume. Keep the exact
            // local-system origin stable across both paths.
            source:
              toolCall.source ??
              (toolCall.type === 'builtin' && toolCall.identifier === 'lobe-local-system'
                ? 'builtin'
                : undefined),
            thoughtSignature: toolCall.thoughtSignature,
            toolCallId: toolCall.id,
            type: toolCall.type,
          },
          topicId: messageContext.topicId,
        },
        { signal },
      );
      throwIfAborted(signal);

      return {
        disposition: acknowledgement.disposition,
        messageId: acknowledgement.id,
      };
    },

    commitResult: async ({
      executionAttemptId,
      messageId,
      operationId,
      result,
      signal,
      toolCall,
    }) => {
      throwIfAborted(signal);
      const pendingPath = getRuntimePathConsentRequest({ state: result.state });
      if (
        toolCall.identifier === 'lobe-local-system' &&
        result.success === false &&
        result.content === 'INTERVENTION_REQUIRED' &&
        pendingPath &&
        shouldPauseForPathConsent(approvalMode, pendingPath.requestedPath) &&
        pendingPath.topicId === context.topicId
      ) {
        // The boundary refused before execution. Keep its request resumable;
        // committing a terminal result here would forbid the later approved read.
        await get().optimisticUpdateToolMessage(
          messageId,
          {
            content: '',
            pluginError: null,
            pluginState: result.state,
          },
          { operationId },
        );
        throwIfAborted(signal);
        return;
      }
      let committedResult = committedResults.get(executionAttemptId);
      if (!committedResult) {
        const rawContent = result.content || result.error?.message || '';
        let content: string;
        try {
          content = await waitForArchive(
            archiveToolResultViaServer({
              agentId: context.agentId,
              content: rawContent,
              identifier: toolCall.identifier,
              signal,
              toolCallId: toolCall.id,
              topicId: context.topicId,
            }),
            signal,
          );
        } catch {
          throwIfAborted(signal);
          content = truncateToolResult(rawContent);
        }
        throwIfAborted(signal);
        committedResult = { ...result, content };
        committedResults.set(executionAttemptId, committedResult);
      }

      throwIfAborted(signal);
      if (!projectedExecutions.has(executionAttemptId)) {
        get().internal_dispatchMessage(
          {
            id: messageId,
            type: 'updateMessage',
            value: {
              content: committedResult.content,
              metadata: committedResult.metadata,
              pluginState: committedResult.state,
            },
          },
          { operationId },
        );
        throwIfAborted(signal);
        const pluginError = toPluginError(committedResult);
        if (pluginError) {
          get().internal_dispatchMessage(
            {
              id: messageId,
              type: 'updateMessagePlugin',
              value: { error: pluginError },
            },
            { operationId },
          );
        }
        throwIfAborted(signal);
        projectedExecutions.add(executionAttemptId);
      }

      throwIfAborted(signal);
      const acknowledgement = await messageService.commitToolResult(
        {
          executionAttemptId,
          id: messageId,
          result: committedResult,
        },
        { signal },
      );
      throwIfAborted(signal);
      if (acknowledgement.id !== messageId) {
        throw new Error(`Committed tool message ${acknowledgement.id} did not match ${messageId}`);
      }
    },
  };
};
