import { afterEach, describe, expect, it, vi } from 'vitest';

import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { useUserStore } from '@/store/user';

import { resolveDesktopDeviceId } from './deviceIdentity';

describe('resolveDesktopDeviceId', () => {
  const initialUser = useUserStore.getState().user;

  afterEach(() => {
    useUserStore.setState({ user: initialUser });
    vi.restoreAllMocks();
  });

  it('rechecks the device if user hydration finishes during the first lookup', async () => {
    useUserStore.setState({ user: undefined });
    const getDeviceInfo = vi
      .spyOn(gatewayConnectionService, 'getDeviceInfo')
      .mockImplementationOnce(async () => {
        useUserStore.setState({ user: { id: 'signed-in-user' } });
        return { deviceId: 'installation-id', identityVerified: false };
      })
      .mockResolvedValueOnce({ deviceId: 'signed-in-device', identityVerified: true });

    await expect(resolveDesktopDeviceId()).resolves.toBe('signed-in-device');
    expect(getDeviceInfo).toHaveBeenCalledTimes(2);
  });

  it('discards the result if the signed-in account changes during lookup', async () => {
    useUserStore.setState({ user: { id: 'first-user' } });
    const getDeviceInfo = vi
      .spyOn(gatewayConnectionService, 'getDeviceInfo')
      .mockImplementationOnce(async () => {
        useUserStore.setState({ user: { id: 'second-user' } });
        return { deviceId: 'first-device', identityVerified: true };
      });

    await expect(resolveDesktopDeviceId()).resolves.toBeUndefined();
    expect(getDeviceInfo).toHaveBeenCalledTimes(1);
  });

  it('does not bind the hydrated account to an earlier response when rechecking fails', async () => {
    useUserStore.setState({ user: undefined });
    vi.spyOn(gatewayConnectionService, 'getDeviceInfo')
      .mockImplementationOnce(async () => {
        useUserStore.setState({ user: { id: 'hydrated-account' } });
        return { deviceId: 'first-device', identityVerified: true };
      })
      .mockRejectedValueOnce(new Error('Device IPC temporarily unavailable'));

    await expect(resolveDesktopDeviceId()).resolves.toBeUndefined();
  });
});
