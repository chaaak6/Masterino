import type { DataSyncConfig } from '@lobechat/electron-client-ipc';
import useSWR from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ElectronRemoteServerActionImpl } from './sync';

const remoteServerMocks = vi.hoisted(() => ({
  cancelAuthorization: vi.fn(),
  clearRemoteServerConfig: vi.fn(),
  getRemoteServerConfig: vi.fn(),
  requestAuthorization: vi.fn(),
  setRemoteServerConfig: vi.fn(),
}));

vi.mock('swr', () => ({ default: vi.fn() }));

vi.mock('@/services/electron/remoteServer', () => ({
  remoteServerService: remoteServerMocks,
}));

vi.mock('@/store/utils/userDataStores', () => ({
  stores: { reset: vi.fn() },
}));

describe('ElectronRemoteServerActionImpl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    remoteServerMocks.cancelAuthorization.mockResolvedValue({ success: true });
    remoteServerMocks.clearRemoteServerConfig.mockResolvedValue(true);
    remoteServerMocks.requestAuthorization.mockResolvedValue({ success: true });
    remoteServerMocks.setRemoteServerConfig.mockResolvedValue(true);
  });

  it('clears the previous origin tokens before staging a different server', async () => {
    const previousConfig: DataSyncConfig = {
      active: true,
      remoteServerUrl: 'https://server-a.example.com',
      storageMode: 'selfHost',
    };
    const nextConfig: DataSyncConfig = {
      remoteServerUrl: 'https://server-b.example.com',
      storageMode: 'selfHost',
    };
    remoteServerMocks.getRemoteServerConfig.mockResolvedValue(previousConfig);

    const clearRemoteServerSyncError = vi.fn();
    const refreshServerConfig = vi.fn().mockResolvedValue(undefined);
    const action = new ElectronRemoteServerActionImpl(
      vi.fn() as any,
      () => ({ clearRemoteServerSyncError, refreshServerConfig }) as any,
    );

    await action.connectRemoteServer(nextConfig);

    expect(remoteServerMocks.cancelAuthorization).toHaveBeenCalledOnce();
    expect(remoteServerMocks.clearRemoteServerConfig).toHaveBeenCalledOnce();
    expect(remoteServerMocks.setRemoteServerConfig).toHaveBeenCalledWith({
      ...nextConfig,
      active: false,
    });
    expect(remoteServerMocks.requestAuthorization).toHaveBeenCalledWith(nextConfig);
    expect(remoteServerMocks.cancelAuthorization.mock.invocationCallOrder[0]).toBeLessThan(
      remoteServerMocks.clearRemoteServerConfig.mock.invocationCallOrder[0]!,
    );
    expect(remoteServerMocks.clearRemoteServerConfig.mock.invocationCallOrder[0]).toBeLessThan(
      remoteServerMocks.setRemoteServerConfig.mock.invocationCallOrder[0]!,
    );
    expect(remoteServerMocks.setRemoteServerConfig.mock.invocationCallOrder[0]).toBeLessThan(
      remoteServerMocks.requestAuthorization.mock.invocationCallOrder[0]!,
    );
  });

  it('cancels an in-flight authorization before disconnecting', async () => {
    const clearRemoteServerSyncError = vi.fn();
    const refreshServerConfig = vi.fn().mockResolvedValue(undefined);
    const action = new ElectronRemoteServerActionImpl(
      vi.fn() as any,
      () => ({ clearRemoteServerSyncError, refreshServerConfig }) as any,
    );

    await action.disconnectRemoteServer();

    expect(remoteServerMocks.cancelAuthorization).toHaveBeenCalledOnce();
    expect(remoteServerMocks.clearRemoteServerConfig).toHaveBeenCalledOnce();
    expect(remoteServerMocks.cancelAuthorization.mock.invocationCallOrder[0]).toBeLessThan(
      remoteServerMocks.clearRemoteServerConfig.mock.invocationCallOrder[0]!,
    );
    expect(refreshServerConfig).toHaveBeenCalledOnce();
  });
});

describe('remote config hydration after sign-out', () => {
  it.each([false, true])('refreshes user data only for active=%s', (active) => {
    const refreshUserData = vi.fn().mockResolvedValue(undefined);
    const action = new ElectronRemoteServerActionImpl(
      vi.fn() as any,
      () =>
        ({
          dataSyncConfig: { active: !active, storageMode: 'cloud' },
          isInitRemoteServerConfig: true,
          refreshUserData,
        }) as any,
    );
    action.useDataSyncConfig();
    const options = vi.mocked(useSWR).mock.calls.at(-1)?.[2] as any;
    options.onSuccess({ active, storageMode: 'cloud' });
    expect(refreshUserData).toHaveBeenCalledTimes(active ? 1 : 0);
  });
});
