import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { useUserStore } from '@/store/user';

export class DesktopDeviceIdentityUnavailableError extends Error {
  override name = 'DesktopDeviceIdentityUnavailableError';

  constructor() {
    super('Unable to verify this desktop’s device identity');
  }
}

let verifiedDevice: { deviceId: string; userId?: string } | undefined;

export const resolveDesktopDeviceId = async () => {
  let userId = useUserStore.getState().user?.id;
  let device = await gatewayConnectionService.getDeviceInfo().catch(() => undefined);
  const currentUserId = useUserStore.getState().user?.id;
  // The first response was requested before account hydration and cannot be
  // attributed to that account. Read again once the account is known.
  if (!userId && currentUserId) {
    userId = currentUserId;
    device = await gatewayConnectionService.getDeviceInfo().catch(() => undefined);
  }
  if (useUserStore.getState().user?.id !== userId) return;
  // A failed IPC call can use the cache. An explicit unverified response revokes it.
  if (!device) return verifiedDevice?.userId === userId ? verifiedDevice?.deviceId : undefined;
  if (!device.deviceId || device.deviceId === 'unknown' || device.identityVerified === false) {
    verifiedDevice = undefined;
    return;
  }
  verifiedDevice = { deviceId: device.deviceId, userId };
  return device.deviceId;
};
