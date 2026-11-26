'use client';

import { type TaskDetail } from '@lobechat/types';
import { ThreadStatus } from '@lobechat/types';
import { memo, useMemo } from 'react';

import BubblesLoading from '@/components/BubblesLoading';
import { ConversationProvider } from '@/features/Conversation/ConversationProvider';
import InterventionBar from '@/features/Conversation/InterventionBar';
import { getPendingInterventions } from '@/features/Conversation/store/slices/data/pendingInterventions';
import { useChatStore } from '@/store/chat';
import { displayMessageSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

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

    // Fetch thread messages (skip when executing - messages come from real-time updates)
    useFetchMessages(threadContext, { skipFetch: isProcessing || !threadId });

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

    if (taskDetail?.status === ThreadStatus.Failed || taskDetail?.status === ThreadStatus.Cancel) {
      return <ErrorState taskDetail={taskDetail} />;
    }

    if (!threadMessages) return isProcessing ? <BubblesLoading /> : null;

    const assistantGroup = threadMessages.find(({ role }) => role === 'assistantGroup');
    const assistant = assistantGroup ?? threadMessages.find(({ role }) => role === 'assistant');

    if (!assistant) return isProcessing ? <InitializingState /> : null;

    return (
      <ConversationProvider skipFetch context={threadContext} messages={rawThreadMessages}>
        <TaskMessages
          duration={taskDetail?.duration}
          isProcessing={isProcessing}
          messages={threadMessages}
          model={assistant.model ?? undefined}
          provider={assistant.provider ?? undefined}
          startTime={assistant.createdAt}
          totalCost={taskDetail?.totalCost}
        />
        {pendingInterventions.length > 0 && (
          <InterventionBar interventions={pendingInterventions} />
        )}
      </ConversationProvider>
    );
  },
);

ClientTaskDetail.displayName = 'ClientTaskDetail';

export default ClientTaskDetail;
