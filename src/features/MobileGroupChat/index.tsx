'use client';

import { memo } from 'react';

import ConversationArea from '@/routes/(main)/group/features/Conversation/ConversationArea';
import TelemetryNotification from '@/routes/(main)/group/features/TelemetryNotification';

import Topic from './Topic';

export { default as MobileGroupChatLayout } from './Layout';

const MobileGroupChatPage = memo(() => (
  <>
    <ConversationArea mobile />
    <Topic />
    <TelemetryNotification mobile />
  </>
));

MobileGroupChatPage.displayName = 'MobileGroupChatPage';

export default MobileGroupChatPage;
