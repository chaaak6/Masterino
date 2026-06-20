import { HomeIcon, SearchIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import {
  getProductFeature,
  isProductFeatureDisabled,
  isProductFeatureHidden,
} from '@/config/productFeatures';
import { getRouteById } from '@/config/routes';
import { useGlobalStore } from '@/store/global';
import { SidebarTabKey } from '@/store/global/initialState';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

export interface NavItem {
  disabled?: boolean;
  disabledReasonKey?: string;
  hidden?: boolean;
  icon: any;
  isNew?: boolean;
  key: string;
  onClick?: () => void;
  title: string;
  url?: string;
}

export interface NavLayout {
  bottomMenuItems: NavItem[];
  footer: {
    hideGitHub: boolean;
    layout: 'expanded' | 'compact';
    showEvalEntry: boolean;
    showSettingsEntry: boolean;
  };
  topNavItems: NavItem[];
  userPanel: {
    showDataImporter: boolean;
    showMemory: boolean;
  };
}

export const useNavLayout = (): NavLayout => {
  const { t } = useTranslation('common');
  const toggleCommandMenu = useGlobalStore((s) => s.toggleCommandMenu);
  const { showMarket, hideGitHub } = useServerConfigStore(featureFlagsSelectors);
  const activeWorkspaceSlug = useActiveWorkspaceSlug();

  const topNavItems = useMemo(
    () =>
      [
        {
          icon: SearchIcon,
          key: 'search',
          onClick: () => toggleCommandMenu(true),
          title: t('tab.search'),
        },
        {
          icon: HomeIcon,
          key: SidebarTabKey.Home,
          title: t('tab.home'),
          url: '/',
        },
        {
          disabled: isProductFeatureDisabled('tasks'),
          disabledReasonKey: getProductFeature('tasks').disabledReasonKey,
          icon: getRouteById('tasks')!.icon,
          key: SidebarTabKey.Tasks,
          title: t('tab.tasks'),
          url: '/tasks',
        },
        {
          disabled: isProductFeatureDisabled('pages'),
          disabledReasonKey: getProductFeature('pages').disabledReasonKey,
          icon: getRouteById('page')!.icon,
          key: SidebarTabKey.Pages,
          title: t('tab.pages'),
          url: '/page',
        },
      ] as NavItem[],
    [t, toggleCommandMenu],
  );

  const bottomMenuItems = useMemo(
    () =>
      [
        {
          disabled: isProductFeatureDisabled('generation'),
          disabledReasonKey: getProductFeature('generation').disabledReasonKey,
          icon: getRouteById('image')!.icon,
          key: SidebarTabKey.Image,
          title: t('tab.generation'),
          url: '/image',
        },
        {
          disabled: isProductFeatureDisabled('community'),
          disabledReasonKey: getProductFeature('community').disabledReasonKey,
          hidden: !showMarket,
          icon: getRouteById('community')!.icon,
          key: SidebarTabKey.Community,
          title: t('tab.community'),
          url: '/community',
        },
        {
          disabled: isProductFeatureDisabled('resources'),
          disabledReasonKey: getProductFeature('resources').disabledReasonKey,
          icon: getRouteById('resource')!.icon,
          key: SidebarTabKey.Resource,
          title: t('tab.resource'),
          url: '/resource',
        },
        {
          disabled: isProductFeatureDisabled('memory'),
          disabledReasonKey: getProductFeature('memory').disabledReasonKey,
          hidden: !!activeWorkspaceSlug,
          icon: getRouteById('memory')!.icon,
          key: SidebarTabKey.Memory,
          title: t('tab.memory'),
          url: '/memory',
        },
      ] as NavItem[],
    [t, showMarket, activeWorkspaceSlug],
  );

  const footer = useMemo(
    () => ({
      hideGitHub: !!hideGitHub,
      layout: 'compact' as const,
      showEvalEntry: !isProductFeatureHidden('eval'),
      showSettingsEntry: true,
    }),
    [hideGitHub],
  );

  const userPanel = useMemo(
    () => ({
      showDataImporter: false,
      // Memory now appears in the sidebar by default; drop the duplicate entry
      // from the user dropdown to keep that menu focused on account / settings.
      showMemory: false,
    }),
    [],
  );

  return { bottomMenuItems, footer, topNavItems, userPanel };
};
