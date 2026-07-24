'use client';

import { SiDiscord } from '@icons-pack/react-simple-icons';
import { SOCIAL_URL } from '@lobechat/business-const';
import { Button, Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import AuthCard from '@/features/AuthCard';

import { getPublicAuthErrorCode } from './errorCode';

const AuthErrorPage = memo(() => {
  const { t } = useTranslation('authError');
  const [searchParams] = useSearchParams();
  const code = getPublicAuthErrorCode(searchParams.get('error'));
  const description = t(`codes.${code}`, { defaultValue: t('codes.UNKNOWN') });

  return (
    <AuthCard
      subtitle={description}
      title={t('title')}
      footer={
        <Flexbox gap={12} justify="center" wrap="wrap">
          <Link to="/signin">
            <Button block size={'large'} type="primary">
              {t('actions.retry')}
            </Button>
          </Link>
          <a href={'/'}>
            <Button block size={'large'}>
              {t('actions.home')}
            </Button>
          </a>
          <a href={SOCIAL_URL.discord} rel="noopener noreferrer" target="_blank">
            <Button block icon={<Icon fill={cssVar.colorText} icon={SiDiscord} />} type="text">
              {t('actions.discord')}
            </Button>
          </a>
        </Flexbox>
      }
    />
  );
});

AuthErrorPage.displayName = 'AuthErrorPage';

export default AuthErrorPage;
