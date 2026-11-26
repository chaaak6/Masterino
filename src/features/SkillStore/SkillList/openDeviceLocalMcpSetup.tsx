import type { DeviceLocalMcpDraft, DeviceLocalMcpServer } from '@lobechat/electron-client-ipc';

import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';

import { createSkillStoreModal } from '..';

let setupPending = false;

export const openDeviceLocalMcpSetup = (
  draft: DeviceLocalMcpDraft | undefined,
  signal: AbortSignal | undefined,
  setupUserId: string,
) =>
  new Promise<DeviceLocalMcpServer | 'already-open' | undefined>((resolve) => {
    if (signal?.aborted) {
      resolve(undefined);
      return;
    }

    if (setupPending) {
      resolve('already-open');
      return;
    }
    let settled = false;
    let saving = false;
    let cancellationRequested = false;
    const finish = (server?: DeviceLocalMcpServer) => {
      if (settled) return;
      settled = true;
      setupPending = false;
      signal?.removeEventListener('abort', abort);
      close?.();
      resolve(server);
    };
    const abort = () => {
      cancellationRequested = true;
      if (!saving) finish();
    };
    const onSavingChange = (active: boolean) => {
      saving = active;
      if (!active && cancellationRequested) finish();
    };
    const close = createSkillStoreModal({
      openLocal: true,
      setup: {
        draft,
        onClose: abort,
        onSaved: finish,
        onSavingChange,
        setupServerUrl: electronSyncSelectors.remoteServerUrl(useElectronStore.getState()),
        setupUserId,
      },
    });
    if (!close) {
      resolve('already-open');
      return;
    }
    setupPending = true;
    signal?.addEventListener('abort', abort, { once: true });
  });
