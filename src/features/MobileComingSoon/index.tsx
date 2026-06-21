'use client';

import { Center, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    min-height: 100%;
    padding: 32px 20px calc(88px + env(safe-area-inset-bottom));
    color: ${cssVar.colorText};
  `,
}));

const MobileComingSoon = memo(() => {
  const { t } = useTranslation('common');

  return (
    <Center className={styles.container}>
      <Flexbox align={'center'} gap={16}>
        <ProductLogo size={72} type={'3d'} />
        <Text fontSize={20} weight={600}>
          {t('productFeatures.disabled')}
        </Text>
      </Flexbox>
    </Center>
  );
});

MobileComingSoon.displayName = 'MobileComingSoon';

export default MobileComingSoon;
