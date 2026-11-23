import { isDesktop } from '@/const/version';
import { lambdaClient } from '@/libs/trpc/client';
import { type RecentItem } from '@/server/routers/lambda/recent';
import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { getProjectWorkspaceStoreState } from '@/store/projectWorkspace/store';
import { isTopicVisibleOnDevice } from '@/store/projectWorkspace/topicNavigation';

class RecentService {
  getAll = async (limit?: number): Promise<RecentItem[]> => {
    if (!isDesktop) return lambdaClient.recent.getAll.query({ limit });

    const currentDeviceId = (await gatewayConnectionService.getDeviceInfo())?.deviceId;
    const data = await lambdaClient.recent.getAll.query({
      limit,
      localDeviceId: currentDeviceId,
    });
    const { topicStatesById, workspacesById } = getProjectWorkspaceStoreState();
    // Older servers omit the scope marker. Use available ownership evidence for those rows.
    return data.filter(
      ({ id, metadata, type, workspaceDeviceScope }) =>
        type !== 'topic' ||
        (!topicStatesById[id]?.unresolvedProject &&
          ((!!currentDeviceId && workspaceDeviceScope === currentDeviceId) ||
            isTopicVisibleOnDevice(
              { id, metadata },
              {
                currentDeviceId: currentDeviceId ?? null,
                topicStatesById,
                workspacesById,
              },
            ))),
    );
  };
}

export const recentService = new RecentService();
