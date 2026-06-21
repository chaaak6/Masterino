'use client';

import { DEFAULT_INBOX_AVATAR, INBOX_SESSION_ID, SESSION_CHAT_URL } from '@lobechat/const';
import { Avatar, List } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';

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

const MobileInboxItem = memo(() => {
  const { t } = useTranslation('chat');
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const inboxMeta = useAgentStore(agentSelectors.getAgentMetaById(inboxAgentId || ''));

  const localizedTitle = t('inbox.title');
  const rawTitle = inboxMeta.title?.trim();
  const title =
    !rawTitle || rawTitle === 'MasterLion' || rawTitle === 'Lobe AI' ? localizedTitle : rawTitle;
  const avatar = inboxMeta.avatar || DEFAULT_INBOX_AVATAR;
  const href = SESSION_CHAT_URL(inboxAgentId || INBOX_SESSION_ID, true);

  return (
    <WorkspaceLink aria-label={title} to={href}>
      <Item
        avatar={<Avatar emojiScaleWithBackground avatar={avatar} shape={'square'} size={40} />}
        className={styles.item}
        description={inboxMeta.description || undefined}
        key={'inbox'}
        title={<span className={styles.title}>{title}</span>}
      />
    </WorkspaceLink>
  );
});

MobileInboxItem.displayName = 'MobileInboxItem';

export default MobileInboxItem;
