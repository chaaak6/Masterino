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
  const userId = useUserStore.getState().user?.id;
  const device = await gatewayConnectionService.getDeviceInfo().catch(() => undefined);
  if (useUserStore.getState().user?.id !== userId) return;
  if (!device) return verifiedDevice?.userId === userId ? verifiedDevice?.deviceId : undefined;
  if (!device.deviceId || device.deviceId === 'unknown') {
    verifiedDevice = undefined;
    return;
  }
  verifiedDevice = { deviceId: device.deviceId, userId };
  return device.deviceId;
};
