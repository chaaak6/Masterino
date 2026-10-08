'use client';

import { SiRss } from '@icons-pack/react-simple-icons';
import { BRANDING_EMAIL, BRANDING_NAME } from '@lobechat/business-const';
import { isDesktop } from '@lobechat/const';
import type { UpdaterState } from '@lobechat/electron-client-ipc';
import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { Flexbox, Form } from '@lobehub/ui';
import { Divider } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BLOG, mailTo, OFFICIAL_SITE } from '@/const/url';
import { UpdateDiagnostics } from '@/features/Electron/updater/UpdateDiagnostics';
import { autoUpdateService } from '@/services/electron/autoUpdate';

import AboutList from './AboutList';
import ItemCard from './ItemCard';
import ItemLink from './ItemLink';
import Version from './Version';

const styles = createStaticStyles(({ css, cssVar }) => ({
  title: css`
    font-size: 14px;
    font-weight: bold;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const About = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { t } = useTranslation('common');
  const { t: electronT } = useTranslation('electron');
  const [updaterState, setUpdaterState] = useState<UpdaterState>({
    autoDownloadEnabled: true,
    stage: 'idle',
  });

  useEffect(() => {
    if (!isDesktop) return;
    void autoUpdateService
      .getUpdaterState()
      .then(setUpdaterState)
      .catch(() => undefined);
  }, []);

  useWatchBroadcast('updaterStateChanged', setUpdaterState);

  return (
    <Form.Group
      collapsible={false}
      gap={16}
      style={{ maxWidth: '1024px', width: '100%' }}
      title={`${t('about')} ${BRANDING_NAME}`}
      variant={'filled'}
    >
      <Flexbox gap={20} paddingBlock={20} width={'100%'}>
        <div className={styles.title}>{t('version')}</div>
        <Version mobile={mobile} version={updaterState.runtime?.currentVersion} />
        {isDesktop && (
          <>
            <Divider style={{ marginBlock: 0 }} />
            <div className={styles.title}>{electronT('updater.diagnostic.title')}</div>
            <UpdateDiagnostics showCheckAction state={updaterState} />
          </>
        )}
        <Divider style={{ marginBlock: 0 }} />
        <div className={styles.title}>{t('contact')}</div>
        <AboutList
          ItemRender={ItemLink}
          items={[
            {
              href: OFFICIAL_SITE,
              label: t('officialSite'),
              value: 'officialSite',
            },
            {
              href: mailTo(BRANDING_EMAIL.support),
              label: t('mail.support'),
              value: 'support',
            },
          ]}
        />
        <Divider style={{ marginBlock: 0 }} />
        <div className={styles.title}>{t('information')}</div>
        <AboutList
          grid
          ItemRender={ItemCard}
          items={[
            {
              href: BLOG,
              icon: SiRss,
              label: t('blog'),
              value: 'blog',
            },
          ]}
        />
      </Flexbox>
    </Form.Group>
  );
});

export default About;
