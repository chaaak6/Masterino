'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

import NavHeader from '@/features/NavHeader';
import OpenInAppButton from '@/features/OpenInAppButton';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useElectronStore } from '@/store/electron';
import { buildDraftConversationKey, useProjectWorkspaceStore } from '@/store/projectWorkspace';

import HeaderActions from './HeaderActions';
import ShareButton from './ShareButton';
import Tags from './Tags';
import WorkingPanelToggle from './WorkingPanelToggle';

const headerStyles = createStaticStyles(({ css }) => ({
  container: css`
    position: relative;
    container-name: agent-conv-header;
    container-type: inline-size;
  `,
  leftContent: css`
    overflow: hidden;
    flex: 1 1 auto;
    min-width: 0;
  `,
  slotLeft: css`
    overflow: hidden;
    flex: 1 1 auto;
    min-width: 0;
  `,
  slotRight: css`
    flex: 0 0 auto;
    min-width: 0;
  `,
}));

const Header = memo(() => {
  const agentId = useChatStore((s) => s.activeAgentId);
  const topicWorkingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const agentWorkingDirectory = useAgentStore((s) =>
    agentId
      ? agentByIdSelectors.getAgentWorkingDirectoryById(agentId, currentDeviceId)(s)
      : undefined,
  );
  const isLocalSystemEnabled = useAgentStore((s) =>
    agentId ? chatConfigByIdSelectors.isLocalSystemEnabledById(agentId)(s) : false,
  );
  const draftKey = useChatStore((s) =>
    s.activeTopicId ? undefined : buildDraftConversationKey({ agentId, groupId: s.activeGroupId }),
  );
  // Read the existing draft cache without running workspace queries or binding a topic.
  const draftFolderPath = useProjectWorkspaceStore((s) => {
    if (!draftKey || !currentDeviceId) return;
    const draft = s.draftByConversationKey[draftKey];
    if (
      !draft ||
      draft.targetDeviceId !== currentDeviceId ||
      (draft.target !== 'local' && draft.target !== 'device')
    ) {
      return;
    }

    if (!draft.workspaceId) return draft.legacyWorkingDirectory;
    const workspace = s.workspacesById[draft.workspaceId];
    return workspace?.deviceId === currentDeviceId ? workspace.rootPath : undefined;
  });
  const effectiveWorkingDirectory = topicWorkingDirectory || agentWorkingDirectory || '';

  return (
    <div className={headerStyles.container}>
      <NavHeader
        left={
          <Flexbox
            allowShrink
            horizontal
            align={'center'}
            className={headerStyles.leftContent}
            gap={4}
            style={{ backgroundColor: cssVar.colorBgContainer }}
          >
            <Tags />
            <HeaderActions />
          </Flexbox>
        }
        right={
          <Flexbox
            horizontal
            align={'center'}
            gap={4}
            style={{ backgroundColor: cssVar.colorBgContainer }}
          >
            {isLocalSystemEnabled && (
              <OpenInAppButton
                draftFolderPath={draftFolderPath}
                workingDirectory={effectiveWorkingDirectory}
              />
            )}
            <ShareButton />
            <WorkingPanelToggle />
          </Flexbox>
        }
        slotClassNames={{
          left: headerStyles.slotLeft,
          right: headerStyles.slotRight,
        }}
      />
    </div>
  );
});

export default Header;
