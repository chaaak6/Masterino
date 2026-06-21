'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';

import { DEFAULT_INBOX_TITLE } from '@/const/meta';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';

import Avatar from './Avatar';

const HeaderInfo = memo(() => {
  const isInbox = useAgentStore(builtinAgentSelectors.isInboxAgent);
  const title = useAgentStore(agentSelectors.currentAgentTitle);

  const displayTitle = isInbox ? DEFAULT_INBOX_TITLE : title;

  return (
    <Flexbox
      horizontal
      align={'center'}
      flex={1}
      gap={8}
      style={{
        overflow: 'hidden',
      }}
    >
      <Avatar />
      <Text ellipsis weight={500}>
        {displayTitle}
      </Text>
    </Flexbox>
  );
});

export default HeaderInfo;
