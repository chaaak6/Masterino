import { isDesktop } from '@lobechat/const';
import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import { useDeviceTopics } from '@/hooks/useDeviceTopics';
import { topicSelectors } from '@/store/chat/selectors';
import { useElectronStore } from '@/store/electron';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import {
  buildWorkspaceTopicNavigation,
  useProjectWorkspaceStore,
  type WorkspaceTopicNavigation,
} from '@/store/projectWorkspace';
import { useUserStore } from '@/store/user';
import { authSelectors, preferenceSelectors } from '@/store/user/selectors';
import type { TopicSortBy } from '@/types/topic';

export interface WorkspaceTopicNavigationView {
  groupIds: string[];
  loadError?: unknown;
  loading: boolean;
  navigation: WorkspaceTopicNavigation;
  reload: () => Promise<unknown>;
  topicSortBy: TopicSortBy;
}

/**
 * Derives the fixed sidebar navigation from the page-sliced, completed-filtered
 * topic list (`displayTopicsForSidebar`) and server workspace evidence.
 * Group ids are `project_workspaces` ids on a new server. Once the A1 router is
 * proven absent, old topics regain their legacy path groups with opaque UI keys.
 */
export const useWorkspaceTopicNavigation = (): WorkspaceTopicNavigationView => {
  const topicPageSize = useGlobalStore(systemStatusSelectors.topicPageSize);
  const topicSortBy = useUserStore(preferenceSelectors.topicSortBy);
  const isLogin = useUserStore(authSelectors.isLogin);

  useElectronStore((s) => s.useFetchGatewayDeviceInfo)(isDesktop);
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);

  const workspaceRequest = useProjectWorkspaceStore((s) => s.useFetchWorkspaces)(
    isDesktop ? !!currentDeviceId : isLogin,
    isDesktop ? { deviceId: currentDeviceId } : {},
  );

  const topics = useDeviceTopics(
    topicSelectors.displayTopicsForSidebar(topicPageSize, topicSortBy),
    isEqual,
  );
  const topicStatesById = useProjectWorkspaceStore((s) => s.topicStatesById);
  const workspacesById = useProjectWorkspaceStore((s) => s.workspacesById);
  const seamAvailable = useProjectWorkspaceStore((s) => s.seamAvailable);

  const navigation = useMemo(
    () =>
      buildWorkspaceTopicNavigation(topics ?? [], {
        currentDeviceId: isDesktop ? (currentDeviceId ?? null) : undefined,
        allowLegacyPathGroups: !seamAvailable,
        sortBy: topicSortBy,
        topicStatesById,
        workspacesById,
      }),
    [currentDeviceId, seamAvailable, topics, topicSortBy, topicStatesById, workspacesById],
  );

  const groupIds = useMemo(
    () => navigation.workspaceGroups.map((group) => group.workspaceId),
    [navigation],
  );

  return useMemo(
    () => ({
      groupIds,
      loadError: workspaceRequest?.error,
      loading: (isDesktop && !currentDeviceId) || Boolean(workspaceRequest?.isLoading),
      navigation,
      reload: async () => workspaceRequest?.mutate?.(),
      topicSortBy,
    }),
    [currentDeviceId, groupIds, navigation, topicSortBy, workspaceRequest],
  );
};
