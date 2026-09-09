import type {
  TopicExecutionIntent,
  TopicExecutionSnapshot,
} from '@lobechat/types/src/projectWorkspace';

import { isDesktop } from '@/const/version';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { normalizeNewTopicIntent } from '@/helpers/workspacePlatform';
import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { buildDraftConversationKey } from './draftKey';
import { getProjectWorkspaceStoreState } from './store';

export interface PendingTopicExecutionIntent {
  /** Present only for a new-topic draft; clear it after the server succeeds. */
  draftKey?: string;
  intent: TopicExecutionIntent;
}

/**
 * Capture the renderer's actual platform and effective topic target at the
 * request boundary. This is deliberately client-authored intent, not
 * authority: the server validates workspaces/devices and persists the
 * immutable topic snapshot.
 */
export const resolvePendingTopicExecutionIntent = async (params: {
  agentId?: string | null;
  groupId?: string | null;
  isNewTopic: boolean;
  topicSnapshot?: TopicExecutionSnapshot;
  topicId?: string | null;
}): Promise<PendingTopicExecutionIntent | undefined> => {
  const { agentId, groupId, isNewTopic, topicId } = params;

  const workspaceState = getProjectWorkspaceStoreState();
  const draftKey = isNewTopic ? buildDraftConversationKey({ agentId, groupId }) : undefined;
  const rawDraft = draftKey ? workspaceState.draftByConversationKey[draftKey] : undefined;
  const draft = rawDraft ? normalizeNewTopicIntent(rawDraft, isDesktop) : undefined;
  const agentConfig = agentId
    ? agentSelectors.getAgentConfigById(agentId)(getAgentStoreState())
    : undefined;
  const agencyConfig = agentConfig?.agencyConfig;
  const platform = isDesktop ? 'desktop' : 'web';
  const topicSnapshot =
    params.topicSnapshot ??
    (topicId ? workspaceState.topicStatesById[topicId]?.snapshot : undefined);
  const newTopicTarget = draft?.target ?? (isNewTopic && isDesktop ? 'local' : undefined);
  const configuredTarget = resolveExecutionTarget(agencyConfig, {
    executionTargetByPlatform: newTopicTarget
      ? { ...agencyConfig?.executionTargetByPlatform, [platform]: newTopicTarget }
      : agencyConfig?.executionTargetByPlatform,
    isDesktop,
    isHetero: !!agencyConfig?.heterogeneousProvider,
    topicSnapshot,
  });
  // Tool mode controls which tools are exposed for this operation; it must not
  // rewrite topic execution identity. In particular, a desktop chat-only
  // first turn still freezes `local`, so enabling tools later cannot make the
  // cwd silently inherit a newer global default.
  const target =
    isNewTopic && !isDesktop && configuredTarget === 'local' ? 'none' : configuredTarget;

  const workspace = draft?.workspaceId
    ? workspaceState.workspacesById[draft.workspaceId]
    : undefined;
  let targetDeviceId =
    topicSnapshot?.boundDeviceId ??
    (draft?.targetDeviceId && (draft.target === 'device' || draft.target === 'local')
      ? draft.targetDeviceId
      : (workspace?.deviceId ?? (target === 'device' ? agencyConfig?.boundDeviceId : undefined)));

  // Old links and project drafts must not bypass desktop project isolation.
  const projectId = topicSnapshot?.workspaceId ?? draft?.workspaceId;
  if (
    isDesktop &&
    projectId &&
    (target === 'local' || target === 'device') &&
    topicSnapshot?.workspaceKind !== 'scratch'
  ) {
    const currentDeviceId = (await gatewayConnectionService.getDeviceInfo())?.deviceId;
    if (!currentDeviceId || targetDeviceId !== currentDeviceId) {
      throw new Error(
        'This project belongs to another device. Open it on its original device or use Web.',
      );
    }
  }

  if (target === 'local' && isDesktop && !targetDeviceId) {
    try {
      targetDeviceId = (await gatewayConnectionService.getDeviceInfo())?.deviceId;
    } catch {
      // Keep the explicit local target. The server will freeze it as unrouted
      // rather than guessing a different device or falling back to sandbox.
    }
  }

  return {
    draftKey,
    intent: {
      platform,
      target,
      ...(targetDeviceId ? { targetDeviceId } : {}),
      ...(isNewTopic && draft?.workspaceId ? { workspaceId: draft.workspaceId } : {}),
    },
  };
};
