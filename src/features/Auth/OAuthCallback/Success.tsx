'use client';

import { FluentEmoji, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Result } from 'antd';
import React, { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { getDesktopAuthorizationScheme } from '@/const/desktopAuthorization';

const SuccessPage = memo(() => {
  const { t } = useTranslation('oauth');
  const [searchParams] = useSearchParams();
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    // Check if this is a LobeHub Skill OAuth callback
    const provider = searchParams.get('provider');

    if (searchParams.get('client') !== 'desktop' && provider && window.opener) {
      // Notify parent window about successful OAuth
      window.opener.postMessage(
        {
          provider,
          type: 'LOBEHUB_SKILL_AUTH_SUCCESS',
        },
        window.location.origin,
      );

      // Start countdown and close window after 3 seconds
      let timeLeft = 3;
      setCountdown(timeLeft);

      const countdownTimer = setInterval(() => {
        timeLeft -= 1;
        setCountdown(timeLeft);

        if (timeLeft <= 0) {
          clearInterval(countdownTimer);
          window.close();
        }
      }, 1000);

      return () => clearInterval(countdownTimer);
    }
  }, [searchParams]);

  const provider = searchParams.get('provider');

  const isDesktop = searchParams.get('client') === 'desktop';
  const desktopScheme = isDesktop && getDesktopAuthorizationScheme(searchParams.get('scheme'));

  return (
    <Result
      icon={<FluentEmoji emoji={'✅'} size={96} type={'anim'} />}
      status="success"
      extra={
        desktopScheme && (
          <Button href={`${desktopScheme}://auth/return`} type="primary">
            {t('success.openDesktop')}
          </Button>
        )
      }
      subTitle={
        <Text fontSize={16} type="secondary">
          {isDesktop
            ? t('success.returnToDesktop')
            : provider
              ? t('success.subTitleWithCountdown', {
                  countdown,
                  defaultValue: `You may close this page. Auto-closing in ${countdown}s...`,
                })
              : t('success.subTitle')}
        </Text>
      }
      title={
        <Text fontSize={32} weight={'bold'}>
          {t('success.title')}
        </Text>
      }
    />
  );
});

SuccessPage.displayName = 'SuccessPage';

export default SuccessPage;
