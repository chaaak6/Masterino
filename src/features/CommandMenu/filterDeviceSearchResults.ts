import type { SearchResult } from '@/database/repositories/search';
import { lambdaClient } from '@/libs/trpc/client';
import {
  ProjectWorkspaceSeamUnavailableError,
  projectWorkspaceService,
} from '@/services/projectWorkspace';
import { isTopicVisibleOnDevice } from '@/store/projectWorkspace/topicNavigation';
import type { ChatTopicMetadata } from '@/types/topic';

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
  let incomplete = false;

  await Promise.all(
    Array.from(topicIds, async (id) => {
      if (!id) return;
      const context = { currentDeviceId: deviceId, topicStatesById: {}, workspacesById: {} };
      try {
        const state = await projectWorkspaceService.getTopicState(id).catch((error) => {
          if (error instanceof ProjectWorkspaceSeamUnavailableError) return undefined;
          throw error;
        });
        const topic = state ? undefined : await lambdaClient.topic.getTopicDetail.query({ id });
        if (!state && !topic) {
          incomplete = true;
          return;
        }
        if (
          isTopicVisibleOnDevice(
            { id, metadata: topic?.metadata as ChatTopicMetadata | undefined },
            { ...context, topicStatesById: { [id]: state } },
          )
        )
          visibleIds.add(id);
      } catch {
        incomplete = true;
      }
    }),
  );

  return {
    incomplete,
    results: results.filter((result) => {
      const id = getUnscopedTopicId(result, deviceId);
      return !id || visibleIds.has(id);
    }),
  };
};
