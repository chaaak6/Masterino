'use client';

import { type TaskDetail } from '@lobechat/types';
import { ThreadStatus } from '@lobechat/types';
import { memo, useMemo } from 'react';

import BubblesLoading from '@/components/BubblesLoading';
import { ConversationProvider } from '@/features/Conversation/ConversationProvider';
import InterventionBar from '@/features/Conversation/InterventionBar';
import { getPendingInterventions } from '@/features/Conversation/store/slices/data/pendingInterventions';
import { useChatStore } from '@/store/chat';
import { displayMessageSelectors, operationSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { resolveAssistantGroupFromMessages } from '../../AssistantGroup/utils/resolveAssistantGroupFromMessages';
import { ErrorState, isProcessingStatus, TaskMessages } from '../../Tasks/shared';
import InitializingState from './InitializingState';

interface ClientTaskDetailProps {
  /** Agent ID from the task message (use task's agentId, not activeAgentId) */
  agentId?: string;
  /** Group ID from the task message (use task's groupId, not activeGroupId) */
  groupId?: string;
  taskDetail?: TaskDetail;
  topicId?: string;
}

const ClientTaskDetail = memo<ClientTaskDetailProps>(
  ({ agentId: propAgentId, groupId, taskDetail, topicId }) => {
    const threadId = taskDetail?.threadId;
    const isProcessing = isProcessingStatus(taskDetail?.status);

    // Use task message's agentId to query with the correct SubAgent ID that created the thread
    // Fall back to activeAgentId if task message doesn't have agentId (shouldn't happen normally)
    const [activeAgentId, activeTopicId, useFetchMessages] = useChatStore((s) => [
      s.activeAgentId,
      s.activeTopicId,
      s.useFetchMessages,
    ]);

    const agentId = propAgentId || activeAgentId;

    const threadContext = useMemo(
      () => ({
        agentId,
        groupId,
        scope: 'thread' as const,
        threadId,
        topicId: topicId ?? activeTopicId,
      }),
      [agentId, groupId, activeTopicId, threadId, topicId],
    );

    const threadMessageKey = useMemo(
      () => (threadId ? messageMapKey(threadContext) : null),
      [threadId, threadContext],
    );

    // The owning task remains active while its individual runtime segments
    // pause and resume. Only readers without that owner need a fresh fetch.
    const hasLocalOwner = useChatStore(
      operationSelectors.hasRunningOperationByContext(threadContext),
    );
    const { isLoading } = useFetchMessages(threadContext, {
      skipFetch: !threadId || hasLocalOwner,
    });

    // Get thread messages from store using selector
    const threadMessages = useChatStore((s) =>
      threadMessageKey
        ? displayMessageSelectors.getDisplayMessagesByKey(threadMessageKey)(s)
        : undefined,
    );

    const rawThreadMessages = useChatStore((s) =>
      threadMessageKey ? s.dbMessagesMap[threadMessageKey] : undefined,
    );
    const pendingInterventions = useMemo(
      () => (isProcessing && threadMessages ? getPendingInterventions(threadMessages) : []),
      [isProcessing, threadMessages],
    );

    const errorState =
      taskDetail?.status === ThreadStatus.Failed || taskDetail?.status === ThreadStatus.Cancel ? (
        <ErrorState taskDetail={taskDetail} />
      ) : undefined;

    if (!threadMessages)
      return errorState ?? (isLoading ? <BubblesLoading /> : <InitializingState />);

    const { assistantId } = resolveAssistantGroupFromMessages(threadMessages);
    const assistant = threadMessages.find(({ id }) => id === assistantId);

    if (!assistant && pendingInterventions.length === 0) return errorState ?? <InitializingState />;

    return (
      <ConversationProvider skipFetch context={threadContext} messages={rawThreadMessages}>
        {assistant && (
          <TaskMessages
            duration={taskDetail?.duration}
            isProcessing={isProcessing}
            messages={threadMessages}
            model={assistant.model ?? undefined}
            provider={assistant.provider ?? undefined}
            startTime={assistant.createdAt}
            totalCost={taskDetail?.totalCost}
          />
        )}
        {errorState}
        {pendingInterventions.length > 0 && (
          <InterventionBar interventions={pendingInterventions} />
        )}
      </ConversationProvider>
    );
  },
);

ClientTaskDetail.displayName = 'ClientTaskDetail';

export default ClientTaskDetail;
