import type * as appConst from '@lobechat/const';
import type { ToolManifest } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { expect, it, vi } from 'vitest';

import { electronKeys } from '@/libs/swr/keys';
import { getDeviceLocalMcpManifests } from '@/services/deviceLocalMcp';

import { useDeviceLocalMcpPicker } from './useDeviceLocalMcpPicker';

const state = vi.hoisted(() => ({
  serverUrl: 'https://test.example',
  target: 'local',
  userId: 'test-user',
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<typeof appConst>()),
  isDesktop: true,
}));
vi.mock('@/hooks/useEffectiveWorkspace', () => ({
  useEffectiveWorkspace: () => ({ context: { plan: { target: state.target } } }),
}));
vi.mock('../store', () => ({ useChatInputStore: () => undefined }));
vi.mock('@/store/user', () => ({
  useUserStore: (select: (value: { isSignedIn: boolean; user: { id: string } }) => unknown) =>
    select({ isSignedIn: true, user: { id: state.userId } }),
}));
vi.mock('@/store/electron', () => ({
  useElectronStore: (select: (value: { dataSyncConfig: { remoteServerUrl: string } }) => unknown) =>
    select({ dataSyncConfig: { remoteServerUrl: state.serverUrl } }),
}));
vi.mock('@/services/deviceLocalMcp', () => ({ getDeviceLocalMcpManifests: vi.fn() }));

it('shares additions and removals between both pickers and hides tools outside local chat', async () => {
  const server: ToolManifest = {
    api: [{ description: 'Inspect a drawing', name: 'inspect', parameters: {} }],
    identifier: 'local-mcp-000000000000000000000001',
    meta: { title: 'Local CAD' },
    type: 'mcp',
  };
  const load = vi.mocked(getDeviceLocalMcpManifests).mockResolvedValue([]);
  const cache = new Map();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SWRConfig value={{ provider: () => cache }}>{children}</SWRConfig>
  );
  const { rerender, result } = renderHook(
    () => ({
      first: useDeviceLocalMcpPicker('agent', false).manifests,
      second: useDeviceLocalMcpPicker('agent', false).manifests,
      swr: useSWRConfig(),
    }),
    { wrapper },
  );
  const key = electronKeys.deviceLocalMcp(state.userId, state.serverUrl);
  await waitFor(() => expect(result.current.first).toEqual([]));
  load.mockResolvedValue([server]);
  await act(async () => {
    await result.current.swr.mutate(key);
  });
  expect(result.current.first).toEqual([server]);
  expect(result.current.second).toEqual([server]);

  state.target = 'sandbox';
  rerender();
  expect(result.current.first).toBeUndefined();
  expect(result.current.second).toBeUndefined();

  state.target = 'local';
  rerender();
  load.mockResolvedValue([]);
  await act(async () => {
    await result.current.swr.mutate(key);
  });
  expect(result.current.first).toEqual([]);
  expect(result.current.second).toEqual([]);
});
