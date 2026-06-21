import { LOBE_CHAT_CLOUD, UTM_SOURCE } from '@lobechat/business-const';
import { OFFICIAL_URL } from '@lobechat/const';
import {
  Book,
  CircleUserRound,
  Cloudy,
  Download,
  Feather,
  Settings2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import useBusinessMeCells from '@/business/client/features/User/useBusinessMeCells';
import { type CellProps } from '@/components/Cell';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

export const useCategory = () => {
  const navigate = useNavigate();
  const { t } = useTranslation(['common', 'setting', 'auth']);
  const { showCloudPromotion, hideDocs } = useServerConfigStore(featureFlagsSelectors);
  const [isLoginWithAuth] = useUserStore((s) => [authSelectors.isLoginWithAuth(s)]);
  const businessMeCells = useBusinessMeCells();
  const comingSoon = t('productFeatures.disabled');

  const profile: CellProps[] = [
    {
      icon: CircleUserRound,
      key: 'profile',
      label: t('userPanel.profile'),
      onClick: () => navigate('/me/profile'),
    },
  ];

  const settings: CellProps[] = [
    {
      icon: Settings2,
      key: 'setting',
      label: t('userPanel.setting'),
      onClick: () => navigate('/me/settings'),
    },
    {
      type: 'divider',
    },
  ];

  const getApp: CellProps[] = [
    {
      disabled: true,
      extra: comingSoon,
      icon: Download,
      key: 'get-app',
      label: t('getApp'),
    },
    {
      type: 'divider',
    },
  ];

  const helps: CellProps[] = [
    showCloudPromotion && {
      icon: Cloudy,
      key: 'cloud',
      label: t('userPanel.cloud', { name: LOBE_CHAT_CLOUD }),
      onClick: () => window.open(`${OFFICIAL_URL}?utm_source=${UTM_SOURCE}`, '__blank'),
    },
    {
      disabled: true,
      extra: comingSoon,
      icon: Book,
      key: 'docs',
      label: t('document'),
    },
    {
      disabled: true,
      extra: comingSoon,
      icon: Feather,
      key: 'feedback',
      label: t('feedback'),
    },
  ].filter(Boolean) as CellProps[];

  const mainItems = [
    {
      type: 'divider',
    },
    ...(isLoginWithAuth ? profile : []),
    ...(isLoginWithAuth ? settings : []),
    ...(isLoginWithAuth ? businessMeCells : []),
    ...getApp,
    ...(!hideDocs ? helps : []),
  ].filter(Boolean) as CellProps[];

  return mainItems;
};
