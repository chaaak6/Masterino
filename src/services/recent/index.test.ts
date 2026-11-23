import { describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import type { RecentItem } from '@/server/routers/lambda/recent';

import { recentService } from './index';

vi.mock('@/const/version', () => ({ isDesktop: true }));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { recent: { getAll: { query: vi.fn() } } },
}));
vi.mock('@/services/electron/gatewayConnection', () => ({
  gatewayConnectionService: { getDeviceInfo: async () => ({ deviceId: 'local-device' }) },
}));
vi.mock('@/store/projectWorkspace/store', () => ({
  getProjectWorkspaceStoreState: () => ({
    topicStatesById: { unresolved: { unresolvedProject: true } },
    workspacesById: {
      'cached-workspace': {
        deviceId: 'local-device',
        id: 'cached-workspace',
        kind: 'device',
        rootPath: '/cached',
      },
    },
  }),
}));

const recentTopic = (id: string, fields: Partial<RecentItem>): RecentItem => ({
  icon: 'topic',
  id,
  routePath: `/chat?topic=${id}`,
  status: null,
  title: id,
  type: 'topic',
  updatedAt: new Date(),
  ...fields,
});

describe('RecentService', () => {
  it('keeps server-scoped topics without requiring duplicated ownership metadata', async () => {
    const scoped = recentTopic('scoped', {
      metadata: { workspaceId: 'uncached-workspace', workspaceKind: 'device' },
      workspaceDeviceScope: 'local-device',
    });
    const cached = recentTopic('cached', {
      metadata: { workspaceId: 'cached-workspace', workspaceKind: 'device' },
    });
    const foreign = recentTopic('foreign', {
      metadata: { boundDeviceId: 'other-device', workingDirectory: '/foreign' },
    });
    const unresolved = recentTopic('unresolved', { workspaceDeviceScope: 'local-device' });
    vi.mocked(lambdaClient.recent.getAll.query).mockResolvedValue([
      scoped,
      cached,
      foreign,
      unresolved,
    ]);

    await expect(recentService.getAll(20)).resolves.toEqual([scoped, cached]);
    expect(lambdaClient.recent.getAll.query).toHaveBeenCalledWith({
      limit: 20,
      localDeviceId: 'local-device',
    });
  });
});
