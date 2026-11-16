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

import { ErrorState, TaskMessages } from '../../Tasks/shared';
import InitializingState from './InitializingState';

interface ClientTaskDetailProps {
  /** Agent ID from the task message (use task's agentId, not activeAgentId) */
  agentId?: string;
  content?: string;
  /** Group ID from the task message (use task's groupId, not activeGroupId) */
  groupId?: string;
  messageId: string;
  taskDetail?: TaskDetail;
  topicId?: string;
}

const ClientTaskDetail = memo<ClientTaskDetailProps>(
  ({ agentId: propAgentId, groupId, taskDetail, topicId }) => {
    const threadId = taskDetail?.threadId;
    const isExecuting = taskDetail?.status === ThreadStatus.Processing;
    const isAwaitingApproval = taskDetail?.status === ThreadStatus.InReview;

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
    useFetchMessages(threadContext, { skipFetch: isExecuting || isAwaitingApproval });

    // Get thread messages from store using selector
    const threadMessages = useChatStore((s) =>
      threadMessageKey
        ? displayMessageSelectors.getDisplayMessagesByKey(threadMessageKey)(s)
        : undefined,
    );

    const pendingInterventions = useMemo(
      () => (isAwaitingApproval && threadMessages ? getPendingInterventions(threadMessages) : []),
      [isAwaitingApproval, threadMessages],
    );

    if (taskDetail?.status === ThreadStatus.Failed || taskDetail?.status === ThreadStatus.Cancel) {
      return <ErrorState taskDetail={taskDetail} />;
    }

    if (!threadMessages) return isExecuting ? <BubblesLoading /> : null;

    // Find the assistantGroup message which contains the children blocks
    const assistantGroupMessage = threadMessages.find((item) => item.role === 'assistantGroup');
    const childrenCount = assistantGroupMessage?.children?.length ?? 0;

    // Get model/provider from assistantGroup message
    const model = assistantGroupMessage?.model;
    const provider = assistantGroupMessage?.provider;

    // Initializing state: no status yet (task just created, waiting for client execution)
    if (threadMessages.length === 0 || !assistantGroupMessage?.children || childrenCount === 0) {
      return isExecuting ? <InitializingState /> : null;
    }

    return (
      <ConversationProvider skipFetch context={threadContext} messages={threadMessages}>
        <TaskMessages
          duration={taskDetail?.duration}
          isProcessing={isExecuting || isAwaitingApproval}
          messages={threadMessages}
          model={model ?? undefined}
          provider={provider ?? undefined}
          startTime={assistantGroupMessage.createdAt}
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
