'use client';

import { ActionIcon, DropdownMenu } from '@lobehub/ui';
import { CreateBotIcon } from '@lobehub/ui/icons';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useCreateMenuItems } from '@/routes/(main)/home/_layout/hooks';

import { disableMobileCreateItem, MOBILE_CREATE_COMING_SOON_KEY } from './mobileCreate';

const MobileCreateButton = memo(() => {
  const { t } = useTranslation('chat');
  const {
    createAgentMenuItem,
    createGroupChatMenuItem,
    createPlatformAgentMenuItem,
    isLoading,
  } = useCreateMenuItems();
  const comingSoon = t(MOBILE_CREATE_COMING_SOON_KEY);

  const items = useMemo(() => {
    const platformItem = createPlatformAgentMenuItem();
    const createItems = [
      disableMobileCreateItem(createAgentMenuItem(), comingSoon),
      disableMobileCreateItem(createGroupChatMenuItem(), comingSoon),
    ];

    return [
      ...createItems,
      ...(platformItem ? [{ type: 'divider' as const }, platformItem] : []),
    ];
  }, [comingSoon, createAgentMenuItem, createGroupChatMenuItem, createPlatformAgentMenuItem]);

  return (
    <DropdownMenu items={items}>
      <ActionIcon icon={CreateBotIcon} loading={isLoading} size={MOBILE_HEADER_ICON_SIZE} />
    </DropdownMenu>
  );
});

MobileCreateButton.displayName = 'MobileCreateButton';

export default MobileCreateButton;
