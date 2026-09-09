import type * as Const from '@lobechat/const';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceTopicNavigation } from './useWorkspaceTopicNavigation';

const mocks = vi.hoisted(() => ({
  desktop: true,
  deviceId: 'mac-a' as string | undefined,
  fetchWorkspaces: vi.fn(() => ({})),
  fetchDevice: vi.fn(),
}));
vi.mock('@lobechat/const', async (original) => ({
  ...(await original<typeof Const>()),
  get isDesktop() {
    return mocks.desktop;
  },
}));
vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: any) =>
    selector({
      gatewayDeviceInfo: { deviceId: mocks.deviceId },
      useFetchGatewayDeviceInfo: mocks.fetchDevice,
    }),
}));
vi.mock('@/store/global', () => ({ useGlobalStore: () => 30 }));
vi.mock('@/store/user', () => ({ useUserStore: () => true }));
vi.mock('@/store/chat', () => ({
  useChatStore: () =>
    ['mac-a', 'mac-b'].map((id) => ({
      id,
      title: id,
      createdAt: 1,
      updatedAt: 1,
      metadata: {
        executionSnapshot: {
          version: 1,
          target: 'local',
          targetCapturedAt: '',
          boundDeviceId: id,
          workspaceId: id,
          workspaceKind: 'device',
        },
      },
    })),
}));
vi.mock('@/store/projectWorkspace', async () => ({
  ...(await import('@/store/projectWorkspace/topicNavigation')),
  useProjectWorkspaceStore: (selector: any) =>
    selector({
      useFetchWorkspaces: mocks.fetchWorkspaces,
      seamAvailable: true,
      topicStatesById: {},
      workspacesById: Object.fromEntries(
        ['mac-a', 'mac-b'].map((id) => [
          id,
          { id, deviceId: id, kind: 'device', rootPath: '/same/path' },
        ]),
      ),
    }),
}));

describe('desktop sidebar device scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.desktop = true;
    mocks.deviceId = 'mac-a';
  });

  it('requests one device and filters cached foreign workspaces; reacts to device changes', () => {
    const { result, rerender } = renderHook(() => useWorkspaceTopicNavigation());
    expect(mocks.fetchWorkspaces).toHaveBeenLastCalledWith(true, { deviceId: 'mac-a' });
    expect(result.current.groupIds).toEqual(['mac-a']);
    mocks.deviceId = 'mac-b';
    rerender();
    expect(result.current.groupIds).toEqual(['mac-b']);
  });

  it('never requests all devices or flashes projects before identity loads', () => {
    mocks.deviceId = undefined;
    const { result } = renderHook(() => useWorkspaceTopicNavigation());
    expect(mocks.fetchWorkspaces).toHaveBeenLastCalledWith(false, { deviceId: undefined });
    expect(result.current.groupIds).toEqual([]);
  });

  it('preserves the shared web list without fetching Electron device identity', () => {
    mocks.desktop = false;
    const { result } = renderHook(() => useWorkspaceTopicNavigation());
    expect(mocks.fetchDevice).toHaveBeenLastCalledWith(false);
    expect(mocks.fetchWorkspaces).toHaveBeenLastCalledWith(true, {});
    expect(result.current.groupIds).toEqual(['mac-a', 'mac-b']);
  });
});
