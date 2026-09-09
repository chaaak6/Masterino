import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TopicService } from './index';

const mocks = vi.hoisted(() => ({
  desktop: true,
  device: 'mac-a' as string | undefined,
  query: vi.fn(),
}));
vi.mock('@/const/version', () => ({
  get isDesktop() {
    return mocks.desktop;
  },
}));
vi.mock('@/services/electron/gatewayConnection', () => ({
  gatewayConnectionService: { getDeviceInfo: async () => ({ deviceId: mocks.device }) },
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    topic: {
      getTopics: { query: mocks.query },
      searchTopics: { query: mocks.query },
      queryTopics: { query: mocks.query },
    },
  },
}));

describe('desktop topic query scope', () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.desktop = true;
    mocks.device = 'mac-a';
  });
  it('sends the same device filter for first page, subsequent pages and search', async () => {
    const service = new TopicService();
    await service.getTopics({ agentId: 'agent', pageSize: 30, current: 0 });
    expect(mocks.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ localDeviceId: 'mac-a', current: 0 }),
    );
    await service.getTopics({ agentId: 'agent', pageSize: 30, current: 1 });
    expect(mocks.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ localDeviceId: 'mac-a', current: 1 }),
    );
    await service.searchTopics('report', 'agent');
    expect(mocks.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ localDeviceId: 'mac-a', keywords: 'report' }),
    );
  });
  it('does not issue an unscoped query while desktop identity is unavailable', async () => {
    mocks.device = undefined;
    await expect(new TopicService().getTopics({})).rejects.toThrow('identity');
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('leaves web queries unscoped', async () => {
    mocks.desktop = false;
    await new TopicService().searchTopics('report', 'agent');
    expect(mocks.query).toHaveBeenCalledWith({
      agentId: 'agent',
      groupId: undefined,
      keywords: 'report',
    });
  });
});
