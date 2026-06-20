'use client';

import { Button, Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { MessageSquare } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    width: 100%;
    height: 100%;
    background: ${cssVar.colorBgContainer};
  `,
  description: css`
    max-width: 420px;
    margin: 0;
    color: ${cssVar.colorTextSecondary};
    line-height: 1.6;
    text-align: center;
  `,
  icon: css`
    color: ${cssVar.colorTextTertiary};
  `,
  title: css`
    margin: 0;
    color: ${cssVar.colorText};
    font-size: 20px;
    font-weight: 600;
  `,
}));

const FeatureDisabledPage = memo(() => {
  const { t } = useTranslation('common');
  const navigate = useNavigate();

  return (
    <Flexbox align={'center'} className={styles.container} gap={16} justify={'center'}>
      <Icon className={styles.icon} icon={MessageSquare} size={40} />
      <Flexbox align={'center'} gap={8}>
        <h1 className={styles.title}>{t('productFeatures.disabledTitle')}</h1>
        <p className={styles.description}>{t('productFeatures.disabledDescription')}</p>
      </Flexbox>
      <Button icon={MessageSquare} type={'primary'} onClick={() => navigate('/agent')}>
        {t('productFeatures.backToChat')}
      </Button>
    </Flexbox>
  );
});

FeatureDisabledPage.displayName = 'FeatureDisabledPage';

export default FeatureDisabledPage;
