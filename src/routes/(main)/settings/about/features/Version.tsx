import { BRANDING_NAME } from '@lobechat/business-const';
import { Block, Flexbox, Tag } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import { ProductLogo } from '@/components/Branding';
import { OFFICIAL_SITE } from '@/const/url';

import { APP_VERSION } from './appVersion';

const styles = createStaticStyles(({ css, cssVar }) => ({
  logo: css`
    border-radius: calc(${cssVar.borderRadiusLG} * 2);
  `,
}));

const Version = memo<{ mobile?: boolean }>(({ mobile }) => {
  return (
    <Flexbox
      align={mobile ? 'stretch' : 'center'}
      gap={16}
      horizontal={!mobile}
      justify={'space-between'}
      width={'100%'}
    >
      <Flexbox horizontal align={'center'} flex={'none'} gap={16}>
        <a href={OFFICIAL_SITE} rel="noreferrer" target="_blank">
          <Block
            clickable
            align={'center'}
            className={styles.logo}
            height={64}
            justify={'center'}
            width={64}
          >
            <ProductLogo size={52} />
          </Block>
        </a>
        <Flexbox align={'flex-start'} gap={6}>
          <div style={{ fontSize: 18, fontWeight: 'bolder' }}>{BRANDING_NAME}</div>
          <Flexbox gap={6} horizontal={!mobile}>
            <Tag>v{APP_VERSION}</Tag>
          </Flexbox>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

export default Version;
