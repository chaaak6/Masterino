// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { topicSelectors } from '@/store/chat/slices/topic/selectors';
import { useElectronStore } from '@/store/electron';
import { useProjectWorkspaceStore } from '@/store/projectWorkspace/store';

import { useDeviceTopics } from './useDeviceTopics';

vi.mock('@lobechat/const', () => ({ isDesktop: true }));
vi.mock('@/store/electron', async () => {
  const { createWithEqualityFn } = await import('zustand/traditional');
  return { useElectronStore: createWithEqualityFn(() => ({ gatewayDeviceInfo: undefined })) };
});
vi.mock('@/store/projectWorkspace/store', async () => {
  const { createWithEqualityFn } = await import('zustand/traditional');
  return {
    useProjectWorkspaceStore: createWithEqualityFn(() => ({
      topicStatesById: {},
      workspacesById: {},
    })),
  };
});
vi.mock('@/store/chat', async () => {
  const { createWithEqualityFn } = await import('zustand/traditional');
  const items = [{ id: 'local', metadata: { workspaceId: 'ws', boundDeviceId: 'mac-a' } }];
  return { useChatStore: createWithEqualityFn(() => ({ topicDataMap: {}, searchTopics: items })) };
});
it('updates a subscribed list when only device/workspace stores change', () => {
  const { result } = renderHook(() => useDeviceTopics(topicSelectors.searchTopics));
  expect(result.current).toEqual([]);
  act(() => useElectronStore.setState({ gatewayDeviceInfo: { deviceId: 'mac-a' } as any }));
  expect(result.current.map((topic) => topic.id)).toEqual(['local']);
  act(() =>
    useProjectWorkspaceStore.setState({ topicStatesById: { local: { unresolvedProject: true } } }),
  );
  expect(result.current).toEqual([]);
});
