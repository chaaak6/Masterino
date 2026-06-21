'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import TopicListContent from '@/routes/(main)/group/_layout/Sidebar/Topic/TopicListContent';
import TopicSearchBar from '@/routes/(main)/group/_layout/Sidebar/Topic/TopicSearchBar';

import TopicModal from './TopicModal';

const Topic = memo(() => (
  <TopicModal>
    <Flexbox gap={8} height={'100%'} padding={'8px 8px 0'} style={{ overflow: 'hidden' }}>
      <TopicSearchBar />
      <Flexbox
        height={'100%'}
        style={{ marginInline: -8, overflowX: 'hidden', overflowY: 'auto', position: 'relative' }}
        width={'calc(100% + 16px)'}
      >
        <TopicListContent />
      </Flexbox>
    </Flexbox>
  </TopicModal>
));

Topic.displayName = 'MobileGroupChatTopic';

export default Topic;
