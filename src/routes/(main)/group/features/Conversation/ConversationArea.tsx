'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, Suspense } from 'react';

import ChatMiniMap from '@/features/ChatMiniMap';
import { ChatList, ConversationProvider } from '@/features/Conversation';
import { useGatewayReconnect } from '@/hooks/useGatewayReconnect';
import { useOperationState } from '@/hooks/useOperationState';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import WelcomeChatItem from './AgentWelcome';
import ChatHydration from './ChatHydration';
import MainChatInput from './MainChatInput';
import MessageFromUrl from './MainChatInput/MessageFromUrl';
import ThreadHydration from './ThreadHydration';
import { useActionsBarConfig } from './useActionsBarConfig';
import { useGroupContext } from './useGroupContext';

interface ConversationAreaProps {
  mobile?: boolean;
}

/**
 * ConversationArea
 *
 * Main conversation area component using the new ConversationStore architecture.
 * Uses ChatList from @/features/Conversation and MainChatInput for custom features.
 */
const Conversation = memo<ConversationAreaProps>(({ mobile = false }) => {
  const context = useGroupContext();

  // Get raw dbMessages from ChatStore for this context
  // ConversationStore will parse them internally to generate displayMessages
  const chatKey = messageMapKey(context);
  const replaceMessages = useChatStore((s) => s.replaceMessages);
  const messages = useChatStore((s) => s.dbMessagesMap[chatKey]);

  // Get operation state from ChatStore for reactive updates
  const operationState = useOperationState(context);
  const runningOperation = useChatStore((state) =>
    context.topicId
      ? topicSelectors.getTopicById(context.topicId, context.groupId)(state)?.metadata
          ?.runningOperation
      : undefined,
  );
  useGatewayReconnect(context.agentId, context.topicId, runningOperation, context.groupId);

  const actionsBarConfig = useActionsBarConfig();

  return (
    <ConversationProvider
      actionsBar={actionsBarConfig}
      context={context}
      hasInitMessages={!!messages}
      messages={messages}
      operationState={operationState}
      onMessagesChange={(messages, ctx) => {
        replaceMessages(messages, { context: ctx });
      }}
    >
      <Flexbox
        flex={1}
        width={'100%'}
        style={{
          overflowX: 'hidden',
          overflowY: 'auto',
          position: 'relative',
        }}
      >
        <ChatList welcome={<WelcomeChatItem />} />
      </Flexbox>
      <MainChatInput />
      <ChatHydration />
      <ThreadHydration />
      {!mobile && (
        <>
          <ChatMiniMap />
          <Suspense>
            <MessageFromUrl />
          </Suspense>
        </>
      )}
    </ConversationProvider>
  );
});

Conversation.displayName = 'ConversationArea';

export default Conversation;
