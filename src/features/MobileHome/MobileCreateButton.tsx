'use client';

import { ActionIcon, DropdownMenu } from '@lobehub/ui';
import { CreateBotIcon } from '@lobehub/ui/icons';
import { memo, useMemo } from 'react';

import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useCreateMenuItems } from '@/routes/(main)/home/_layout/hooks';

const MobileCreateButton = memo(() => {
  const {
    createAgentMenuItem,
    createGroupChatMenuItem,
    createPlatformAgentMenuItem,
    isLoading,
  } = useCreateMenuItems();

  const items = useMemo(() => {
    const platformItem = createPlatformAgentMenuItem();
    return [
      createAgentMenuItem(),
      createGroupChatMenuItem(),
      ...(platformItem ? [{ type: 'divider' as const }, platformItem] : []),
    ];
  }, [createAgentMenuItem, createGroupChatMenuItem, createPlatformAgentMenuItem]);

  return (
    <DropdownMenu items={items}>
      <ActionIcon icon={CreateBotIcon} loading={isLoading} size={MOBILE_HEADER_ICON_SIZE} />
    </DropdownMenu>
  );
});

MobileCreateButton.displayName = 'MobileCreateButton';

export default MobileCreateButton;
