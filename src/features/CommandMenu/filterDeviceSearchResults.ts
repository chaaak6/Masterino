import type { SearchResult } from '@/database/repositories/search';
import { projectWorkspaceService } from '@/services/projectWorkspace';
import { isTopicVisibleOnDevice } from '@/store/projectWorkspace/topicNavigation';

const getUnscopedTopicId = (result: SearchResult, deviceId: string): string | undefined => {
  if (result.type !== 'topic' && result.type !== 'message') return;
  if (result.workspaceDeviceScope === deviceId) return;
  return (result.type === 'topic' ? result.id : result.topicId) ?? undefined;
};

/** Older APIs return search hits without applying the desktop scope. */
export const filterDeviceSearchResults = async (results: SearchResult[], deviceId: string) => {
  const topicIds = new Set(results.map((result) => getUnscopedTopicId(result, deviceId)));
  topicIds.delete(undefined);
  const visibleIds = new Set<string>();

  await Promise.all(
    Array.from(topicIds, async (id) => {
      if (!id) return;
      try {
        const state = await projectWorkspaceService.getTopicState(id);
        if (
          state &&
          isTopicVisibleOnDevice(
            { id },
            { currentDeviceId: deviceId, topicStatesById: { [id]: state }, workspacesById: {} },
          )
        ) {
          visibleIds.add(id);
        }
      } catch {
        // A topic that cannot be resolved stays hidden on this desktop.
      }
    }),
  );

  return results.filter((result) => {
    const id = getUnscopedTopicId(result, deviceId);
    return !id || visibleIds.has(id);
  });
};
