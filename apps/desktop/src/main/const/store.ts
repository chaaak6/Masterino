/**
 * Application settings storage related constants
 */
import { DEFAULT_ELECTRON_DESKTOP_SHORTCUTS } from '@lobechat/const/desktopGlobalShortcuts';
import type { NetworkProxySettings } from '@lobechat/electron-client-ipc';

import { appStorageDir } from '@/const/dir';
import { DEFAULT_GATEWAY_URL } from '@/modules/gateway/configs';
import { UPDATE_CHANNEL } from '@/modules/updater/configs';
import type { ElectronMainStore } from '@/types/store';

/**
 * Storage name
 */
export const STORE_NAME = 'lobehub-settings';

export const defaultProxySettings: NetworkProxySettings = {
  enableProxy: false,
  proxyBypass: 'localhost, 127.0.0.1, ::1',
  proxyPort: '',
  proxyRequireAuth: false,
  proxyServer: '',
  proxyType: 'http',
};

/**
 * Storage default values
 */
export const STORE_DEFAULTS: ElectronMainStore = {
  appTrayVisible: true,
  autoDownloadUpdates: false,
  dataSyncConfig: { storageMode: 'cloud' },
  encryptedTokens: {},
  gatewayDeviceDescription: '',
  gatewayDeviceId: '',
  gatewayDeviceName: '',
  gatewayEnabled: true,
  gatewayUrl: DEFAULT_GATEWAY_URL,
  heteroTracingEnabled: false,
  imessageBridgeConfigs: [],
  locale: 'auto',
  localFileWorkspaceRoots: [],
  lastUpdaterDiagnostic: null,
  networkProxy: defaultProxySettings,
  pendingRestoreRoute: '',
  shortcuts: DEFAULT_ELECTRON_DESKTOP_SHORTCUTS,
  storagePath: appStorageDir,
  themeMode: 'system',
  updateChannel: UPDATE_CHANNEL,
};
