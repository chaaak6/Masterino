import { Center, Flexbox } from '@lobehub/ui';
import { type ReactNode } from 'react';
import React, { memo } from 'react';

import { type StageItem } from '@/components/InitProgress';
import InitProgress from '@/components/InitProgress';

interface FullscreenLoadingProps {
  activeStage: number;
  contentRender?: ReactNode;
  stages: StageItem[];
}

const FullscreenLoading = memo<FullscreenLoadingProps>(({ activeStage, stages, contentRender }) => {
  return (
    <Flexbox height={'100%'} style={{ position: 'relative', userSelect: 'none' }} width={'100%'}>
      <Center flex={1} gap={16} width={'100%'}>
        <img
          alt={'小宗狮 loading'}
          src={'/brand/masterlion/loading-masterlion-zh.svg'}
          style={{ display: 'block', height: 'auto', opacity: 0.76, width: 'min(320px, 72vw)' }}
        />
        {contentRender ? contentRender : <InitProgress activeStage={activeStage} stages={stages} />}
      </Center>
    </Flexbox>
  );
});

export default FullscreenLoading;
