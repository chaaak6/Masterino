import { electronAPI } from '@electron-toolkit/preload';
import type { ScreenCaptureSession } from '@lobechat/electron-client-ipc';
import { contextBridge, ipcRenderer, webUtils } from 'electron';

import { loadDesktopRuntimeConfig } from '../common/desktopRuntimeConfig';
import { invoke } from './invoke';
import { onStreamInvoke } from './streamer';

const screenCaptureSessionListeners = new Set<(session: ScreenCaptureSession) => void>();

let latestScreenCaptureSession: ScreenCaptureSession | null = null;

ipcRenderer.on('screenCaptureSession', (_event, session: ScreenCaptureSession) => {
  latestScreenCaptureSession = session;

  for (const listener of screenCaptureSessionListeners) {
    listener(session);
  }
});

export const setupElectronApi = () => {
  // Use `contextBridge` APIs to expose Electron APIs to
  // renderer only if context isolation is enabled, otherwise
  // just add to the DOM global.

  try {
    contextBridge.exposeInMainWorld('electron', electronAPI);
  } catch (error) {
    console.error(error);
  }

  contextBridge.exposeInMainWorld('electronAPI', {
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    invoke,
    onScreenCaptureSession: (listener: (session: ScreenCaptureSession) => void) => {
      screenCaptureSessionListeners.add(listener);

      if (latestScreenCaptureSession) {
        listener(latestScreenCaptureSession);
      }

      return () => {
        screenCaptureSessionListeners.delete(listener);
      };
    },
    onStreamInvoke,
  });

  const os = require('node:os');
  const osInfo = os.release();
  const darwinMajorVersion = Number(osInfo.split('.')[0]);
  const desktopRuntimeConfig = loadDesktopRuntimeConfig();

  contextBridge.exposeInMainWorld('lobeEnv', {
    chromeVersion: process.versions.chrome,
    cloudServer: desktopRuntimeConfig.cloudServer,
    cloudServerAliases: desktopRuntimeConfig.cloudServerAliases,
    darwinMajorVersion,
    electronVersion: process.versions.electron,
    isMacTahoe: process.platform === 'darwin' && darwinMajorVersion >= 25,
    marketBaseUrl: desktopRuntimeConfig.marketBaseUrl,
    nodeVersion: process.versions.node,
    platform: process.platform,
  });
};

export type SetupElectronApiFunction = typeof setupElectronApi;
