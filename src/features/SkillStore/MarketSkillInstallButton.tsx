'use client';

import { Button, Flexbox, Tag } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useMarketSkillInstall } from './useMarketSkillInstall';

const MarketSkillInstallButton = memo<{ identifier: string; name: string }>(
  ({ identifier, name }) => {
    const { t } = useTranslation('discover');
    const { canCreate, handleInstall, installedSkill, installing, isLoading } =
      useMarketSkillInstall(identifier, name);

    return (
      <Flexbox gap={8}>
        {installedSkill && <Tag>{t('plugins.installed')}</Tag>}
        <Button
          block
          disabled={!canCreate || isLoading}
          loading={installing}
          type={installedSkill ? 'default' : 'primary'}
          onClick={handleInstall}
        >
          {t(installedSkill ? 'publishing.updateToCurrentVersion' : 'publishing.installToLibrary')}
        </Button>
      </Flexbox>
    );
  },
);

MarketSkillInstallButton.displayName = 'MarketSkillInstallButton';

export default MarketSkillInstallButton;
