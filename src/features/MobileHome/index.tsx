'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import MobileAgentList from './MobileAgentList';

const MobileHome = memo(() => {
  return (
    <Flexbox gap={1} paddingBlock={8} paddingInline={8}>
      <MobileAgentList />
    </Flexbox>
  );
});

MobileHome.displayName = 'MobileHome';

export default MobileHome;
