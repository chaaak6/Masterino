import { Brain, Building2, Sparkles, Users } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { WorkspaceSettingsTabs } from '@/types/workspaceSettings';

export enum WorkspaceSettingsGroupKey {
  Admin = 'admin',
  Agent = 'agent',
  General = 'general',
  Subscription = 'subscription',
}

export interface WorkspaceSettingCategoryItem {
  icon: any;
  key: WorkspaceSettingsTabs;
  label: string;
}

export interface WorkspaceSettingCategoryGroup {
  items: WorkspaceSettingCategoryItem[];
  key: WorkspaceSettingsGroupKey;
  title: string;
}

export const useWorkspaceSettingCategory = (): WorkspaceSettingCategoryGroup[] => {
  const { t } = useTranslation('setting');

  return useMemo(
    () => [
      {
        items: [
          {
            icon: Building2,
            key: WorkspaceSettingsTabs.General,
            label: t('workspaceSetting.tab.general'),
          },
          {
            icon: Users,
            key: WorkspaceSettingsTabs.Members,
            label: t('workspaceSetting.tab.members'),
          },
        ],
        key: WorkspaceSettingsGroupKey.General,
        title: t('workspaceSetting.group.general'),
      },
      {
        items: [
          {
            icon: Brain,
            key: WorkspaceSettingsTabs.Provider,
            label: t('tab.provider'),
          },
          {
            icon: Sparkles,
            key: WorkspaceSettingsTabs.ServiceModel,
            label: t('tab.serviceModel'),
          },
        ],
        key: WorkspaceSettingsGroupKey.Agent,
        title: t('workspaceSetting.group.agent'),
      },
    ],
    [t],
  );
};
