import { isDesktop } from '@/const/version';
import { lambdaClient } from '@/libs/trpc/client';
import { type RecentItem } from '@/server/routers/lambda/recent';
import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { isTopicVisibleOnDevice } from '@/store/projectWorkspace/topicNavigation';

class RecentService {
  getAll = async (limit?: number): Promise<RecentItem[]> => {
    if (!isDesktop) return lambdaClient.recent.getAll.query({ limit });

    const currentDeviceId = (await gatewayConnectionService.getDeviceInfo())?.deviceId;
    const data = await lambdaClient.recent.getAll.query({
      limit,
      localDeviceId: currentDeviceId,
    });
    // The existing API exposes topic metadata even before server-side scoping is deployed.
    return data.filter(
      ({ id, metadata, type }) =>
        type !== 'topic' ||
        isTopicVisibleOnDevice(
          { id, metadata },
          {
            currentDeviceId: currentDeviceId ?? null,
            topicStatesById: {},
            workspacesById: {},
          },
        ),
    );
  };
}

export const recentService = new RecentService();
