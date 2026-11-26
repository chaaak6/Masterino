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
});
