'use client';

import { toast } from '@lobehub/ui/base-ui';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/selectors';

export const useMarketSkillInstall = (identifier: string, name: string) => {
  const { t } = useTranslation(['plugin', 'discover']);
  const { allowed: canCreate } = usePermission('create_content');
  const installedSkill = useToolStore(agentSkillsSelectors.getAgentSkillByIdentifier(identifier));
  const [importFromMarket, useFetchAgentSkills] = useToolStore((s) => [
    s.importAgentSkillFromMarket,
    s.useFetchAgentSkills,
  ]);
  const { isLoading } = useFetchAgentSkills(canCreate);
  const [installing, setInstalling] = useState(false);
  const installPending = useRef(false);

  const handleInstall = useCallback(async () => {
    if (!canCreate || installPending.current) return;
    installPending.current = true;
    setInstalling(true);
    try {
      const result = await importFromMarket(identifier);
      if (!result) throw new Error(t('publishing.installFailed', { ns: 'discover' }));
      toast.success(
        t(
          result.status === 'updated'
            ? 'publishing.updateSucceeded'
            : result.status === 'unchanged'
              ? 'publishing.alreadyCurrent'
              : 'publishing.installSucceeded',
          { ns: 'discover' },
        ),
      );
    } catch (error) {
      const message = (error as Error).message;
      const conflict = message.startsWith('Your original skill differs from this release')
        ? t('publishing.originalConflict', { ns: 'discover' })
        : message.startsWith('This installed skill has local edits')
          ? t('publishing.installedConflict', { ns: 'discover' })
          : message.startsWith('A skill named ') &&
              message.endsWith('already exists. Remove it before installing this skill.')
            ? t('publishing.nameConflict', { name, ns: 'discover' })
            : message;
      toast.error(`${t('error.installError', { name })}: ${conflict}`);
    } finally {
      installPending.current = false;
      setInstalling(false);
    }
  }, [canCreate, identifier, importFromMarket, name, t]);

  return { canCreate, handleInstall, installedSkill, installing, isLoading };
};
