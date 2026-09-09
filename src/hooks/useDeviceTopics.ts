import { isDesktop } from '@lobechat/const';

import { useChatStore } from '@/store/chat';
import type { ChatStore } from '@/store/chat/store';
import { useElectronStore } from '@/store/electron';
import { useProjectWorkspaceStore } from '@/store/projectWorkspace/store';
import {
  isTopicVisibleOnDevice,
  type TopicNavigationContext,
} from '@/store/projectWorkspace/topicNavigation';

/** A read-only view for navigation; the underlying cache and direct history lookup stay intact. */
export const scopeDeviceTopics = <S extends Pick<ChatStore, 'topicDataMap' | 'searchTopics'>>(
  state: S,
  scope: TopicNavigationContext,
): S => {
  if (scope.currentDeviceId === undefined) return state;
  const visible = (topic: Parameters<typeof isTopicVisibleOnDevice>[0]) =>
    isTopicVisibleOnDevice(topic, scope);
  return {
    ...state,
    topicDataMap: Object.fromEntries(
      Object.entries(state.topicDataMap).map(([key, data]) => [
        key,
        data ? { ...data, items: data.items.filter(visible) } : data,
      ]),
    ),
    searchTopics: state.searchTopics?.filter(visible),
  };
};

/** Explicitly subscribe to every input used by device visibility, before sorting/pagination. */
export const useDeviceTopics = <T>(
  selector: (state: ChatStore) => T,
  equalityFn?: (a: T, b: T) => boolean,
): T => {
  const deviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const topicStatesById = useProjectWorkspaceStore((s) => s.topicStatesById);
  const workspacesById = useProjectWorkspaceStore((s) => s.workspacesById);
  return useChatStore(
    (state) =>
      selector(
        scopeDeviceTopics(state, {
          currentDeviceId: isDesktop ? (deviceId ?? null) : undefined,
          topicStatesById,
          workspacesById,
        }),
      ),
    equalityFn,
  );
};
