import type { UpdateChannel } from '@lobechat/electron-client-ipc';

import { isDev } from '@/const/env';
import { getDesktopEnv } from '@/env';

// Build-time default channel, can be overridden at runtime via store
const rawChannel = getDesktopEnv().UPDATE_CHANNEL || 'stable';
export const coerceStoredUpdateChannel = (channel?: string | null): UpdateChannel =>
  channel === 'canary' ? 'canary' : 'stable';

/** Raw build channel for display (stable, canary, beta, or legacy nightly). */
export const BUILD_CHANNEL: string = rawChannel;
export const UPDATE_CHANNEL: UpdateChannel =
  rawChannel === 'canary' || rawChannel === 'beta' ? 'canary' : 'stable';

export const resolveInitialUpdateChannel = (
  storedChannel?: string | null,
  buildChannel: UpdateChannel = UPDATE_CHANNEL,
): UpdateChannel => {
  // An unsigned canary package must keep following canary even when an older
  // stable build persisted its default channel before the first canary install.
  if (buildChannel === 'canary') return 'canary';

  return coerceStoredUpdateChannel(storedChannel ?? buildChannel);
};

// S3 base URL for all channels
// e.g., https://aihub.bielcrystal.com/releases
// Each channel resolves to {base}/{channel}/
export const UPDATE_SERVER_URL = getDesktopEnv().UPDATE_SERVER_URL;

export const updaterConfig = {
  app: {
    autoCheckUpdate: true,
    autoDownloadUpdate: false,
    checkUpdateInterval: 60 * 60 * 1000, // 1 hour
  },
  enableAppUpdate: !isDev && !getDesktopEnv().DISABLE_APP_UPDATE,
};
