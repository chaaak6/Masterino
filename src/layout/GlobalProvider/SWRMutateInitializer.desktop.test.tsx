import { act, render } from '@testing-library/react';
import type * as SWR from 'swr';
import { beforeEach, expect, it, vi } from 'vitest';

import { electronKeys } from '@/libs/swr/keys';

import SWRMutateInitializer from './SWRMutateInitializer.desktop';

const mocks = vi.hoisted(() => ({
  initializeAppState: vi.fn(),
  mutate: vi.fn().mockResolvedValue(undefined),
  getRemoteServerConfig: vi.fn(),
  broadcast: undefined as undefined | (() => Promise<void>),
}));
vi.mock('swr', async (importOriginal) => ({
  ...(await importOriginal<typeof SWR>()),
  useSWRConfig: () => ({ mutate: mocks.mutate }),
}));
vi.mock('@/services/electron/remoteServer', () => ({ remoteServerService: mocks }));
beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock('@lobechat/electron-client-ipc', () => ({
  useWatchBroadcast: (_event: string, callback: () => Promise<void>) => {
    mocks.broadcast = callback;
  },
}));
vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (state: unknown) => unknown) =>
    selector({ useInitElectronAppState: mocks.initializeAppState }),
}));

it('initializes desktop app state before exposing the agent environment', () => {
  render(<SWRMutateInitializer>Desktop</SWRMutateInitializer>);
  expect(mocks.initializeAppState).toHaveBeenCalled();
});

it('does not revalidate business requests after remote credentials are cleared', async () => {
  mocks.getRemoteServerConfig.mockResolvedValue({ active: false, storageMode: 'cloud' });
  render(<SWRMutateInitializer>Desktop login</SWRMutateInitializer>);
  await act(async () => {
    await mocks.broadcast?.();
  });
  expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith(electronKeys.remoteServerConfig());
});

it('keeps refreshing mounted caches after an active server update', async () => {
  mocks.getRemoteServerConfig.mockResolvedValue({ active: true, storageMode: 'cloud' });
  render(<SWRMutateInitializer>Desktop</SWRMutateInitializer>);
  await act(async () => {
    await mocks.broadcast?.();
  });
  expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith(expect.any(Function), undefined, {
    revalidate: true,
  });
});
