'use client';

import { GROUP_CHAT_URL, SESSION_CHAT_URL } from '@lobechat/const';
import { type SidebarAgentItem } from '@lobechat/types';
import { Avatar, List } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useMemo } from 'react';

import { DEFAULT_AVATAR } from '@/const/meta';
import AgentGroupAvatar from '@/features/AgentGroupAvatar';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

const { Item } = List;

const styles = createStaticStyles(({ css, cssVar }) => ({
  item: css`
    min-height: 64px;
    padding-inline: 12px 16px;
    border-radius: 0;

    &:active {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  title: css`
    line-height: 1.2;
  `,
}));

interface MobileAgentListItemProps {
  item: SidebarAgentItem;
}

const MobileAgentListItem = memo<MobileAgentListItemProps>(({ item }) => {
  const title = item.title || '';
  const href = item.type === 'group' ? GROUP_CHAT_URL(item.id) : SESSION_CHAT_URL(item.id, true);

  const avatar = useMemo(() => {
    if (item.type === 'group') {
      const customAvatar = typeof item.avatar === 'string' ? item.avatar : undefined;
      const memberAvatars = Array.isArray(item.avatar) ? item.avatar : [];

      return (
        <AgentGroupAvatar
          avatar={customAvatar}
          backgroundColor={item.backgroundColor || undefined}
          memberAvatars={memberAvatars}
          size={40}
        />
      );
    }

    return (
      <Avatar
        animation
        avatar={typeof item.avatar === 'string' ? item.avatar : DEFAULT_AVATAR}
        background={item.backgroundColor || undefined}
        size={40}
      />
    );
  }, [item.avatar, item.backgroundColor, item.type]);

  return (
    <WorkspaceLink aria-label={title || item.id} to={href}>
      <Item
        avatar={avatar}
        className={styles.item}
        description={item.description || undefined}
        title={<span className={styles.title}>{title}</span>}
      />
    </WorkspaceLink>
  );
});

MobileAgentListItem.displayName = 'MobileAgentListItem';

export default MobileAgentListItem;
