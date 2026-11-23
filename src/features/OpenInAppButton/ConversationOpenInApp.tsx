'use client';

import { resolveAgentWorkingDirectory } from '@/helpers/agentWorkingDirectory';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useElectronStore } from '@/store/electron';
import { buildDraftConversationKey, useProjectWorkspaceStore } from '@/store/projectWorkspace';

import OpenInAppButton from './index';

const ConversationOpenInApp = () => {
  const agentId = useChatStore((s) => s.activeAgentId);
  const topicWorkingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const agentWorkingDirectory = useAgentStore((s) => {
    if (!agentId) return;
    return resolveAgentWorkingDirectory({
      agencyConfig: agentByIdSelectors.getAgencyConfigById(agentId)(s),
      currentDeviceId,
      legacyAgentWorkingDirectory: s.localAgentWorkingDirectoryMap[agentId],
    });
  });
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

    if (!draft.workspaceId) return s.seamAvailable ? undefined : draft.legacyWorkingDirectory;
    const workspace = s.workspacesById[draft.workspaceId];
    return workspace?.deviceId === currentDeviceId ? workspace.rootPath : undefined;
  });
  const effectiveWorkingDirectory = topicWorkingDirectory || agentWorkingDirectory || '';

  if (!isLocalSystemEnabled) return null;

  return (
    <OpenInAppButton
      draftFolderPath={draftFolderPath}
      workingDirectory={effectiveWorkingDirectory}
    />
  );
};

export default ConversationOpenInApp;
