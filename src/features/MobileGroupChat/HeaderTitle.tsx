'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { cssVar } from 'antd-style';
import { ChevronDown } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';

const HeaderTitle = memo(() => {
  const { t } = useTranslation(['chat', 'topic']);
  const toggleTopic = useGlobalStore((s) => s.toggleMobileTopic);
  const groupMeta = useAgentGroupStore(agentGroupSelectors.currentGroupMeta);
  const [topicCount, topic] = useChatStore((s) => [
    topicSelectors.currentTopicCount(s),
    topicSelectors.currentActiveTopic(s),
  ]);

  const displayTitle = groupMeta.title || t('untitledGroup', { ns: 'chat' });

  return (
    <ChatHeader.Title
      desc={
        <Flexbox horizontal align={'center'} gap={4} onClick={() => toggleTopic()}>
          <span
            style={{
              maxWidth: '60vw',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {topic?.title || t('title', { ns: 'topic' })}
          </span>
          <ActionIcon
            active
            icon={ChevronDown}
            size={{ blockSize: 14, borderRadius: '50%', size: 12 }}
            style={{
              background: cssVar.colorFillSecondary,
              color: cssVar.colorTextDescription,
            }}
          />
        </Flexbox>
      }
      title={
        <div
          style={{
            marginRight: '8px',
            maxWidth: '64vw',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          onClick={() => toggleTopic()}
        >
          {displayTitle}
          {topicCount > 0 ? ` (${topicCount})` : ''}
        </div>
      }
    />
  );
});

HeaderTitle.displayName = 'MobileGroupChatHeaderTitle';

export default HeaderTitle;
