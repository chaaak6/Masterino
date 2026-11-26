import useSWR from 'swr';

import { gatewayKeys } from '@/libs/swr/keys';
import { useChatStore } from '@/store/chat';

interface RunningOperation {
  assistantMessageId: string;
  operationId: string;
  scope?: string;
  threadId?: string | null;
}

/**
 * Auto-reconnect to a running Gateway operation on the given topic.
 *
 * The caller sources `runningOperation` itself — the chat-store topic map
 * (main agent) and the task-detail activity (task drawer) live in different
 * stores, so this hook stays source-agnostic.
 *
 * Reconnect follows the persisted running operation. External Gateway deployments
 * use WebSocket; standalone deployments use the authenticated same-origin stream.
 *
 * SWR key is the operationId, so the same operation deduplicates and only
 * one reconnect attempt fires per op.
 */
export const useGatewayReconnect = (
  agentId: string,
  topicId: string | null | undefined,
  runningOperation: RunningOperation | null | undefined,
  groupId?: string | null,
) => {
  useSWR(
    runningOperation && topicId && agentId
      ? gatewayKeys.reconnect(runningOperation.operationId)
      : null,
    async () => {
      if (!runningOperation || !topicId) return;

      await useChatStore.getState().reconnectToGatewayOperation({
        agentId,
        assistantMessageId: runningOperation.assistantMessageId,
        groupId: groupId ?? undefined,
        operationId: runningOperation.operationId,
        scope: runningOperation.scope,
        threadId: runningOperation.threadId,
        topicId,
      });
    },
    {
      revalidateIfStale: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
};
