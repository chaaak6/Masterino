import type { DeviceLocalMcpDraft, DeviceLocalMcpServer } from '@lobechat/electron-client-ipc';
import { createRawModal } from '@lobehub/ui';

import DeviceLocalMcpModal from './DeviceLocalMcpModal';

interface SetupDialogProps {
  draft?: DeviceLocalMcpDraft;
  onCancelSetup: () => void;
  onFinish?: (server: DeviceLocalMcpServer) => void;
  onHostClose?: () => void;
  onSavingChange?: (saving: boolean) => void;
  open: boolean;
  setupUserId?: string;
}

const SetupDialog = ({
  draft,
  onCancelSetup,
  onFinish,
  onSavingChange,
  open,
  setupUserId,
}: SetupDialogProps) =>
  open ? (
    <DeviceLocalMcpModal
      draft={draft}
      setupUserId={setupUserId}
      onClose={onCancelSetup}
      onSaved={onFinish}
      onSavingChange={onSavingChange}
    />
  ) : null;

let dialogOpen = false;

const showDialog = (props: Omit<SetupDialogProps, 'open'>) => {
  dialogOpen = true;
  try {
    const modal = createRawModal(SetupDialog, props, {
      onCloseKey: 'onHostClose',
      openKey: 'open',
    });
    let destroyed = false;
    return () => {
      if (destroyed) return;
      destroyed = true;
      dialogOpen = false;
      modal.destroy();
    };
  } catch (error) {
    dialogOpen = false;
    throw error;
  }
};

export const openDeviceLocalMcpSettings = () => {
  if (dialogOpen) return;
  const close = showDialog({ onCancelSetup: () => close() });
};

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

    if (dialogOpen) {
      resolve('already-open');
      return;
    }
    let settled = false;
    let saving = false;
    let cancellationRequested = false;
    const finish = (server?: DeviceLocalMcpServer) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      close();
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
    const close = showDialog({
      draft,
      onCancelSetup: abort,
      onFinish: finish,
      onSavingChange,
      setupUserId,
    });
    signal?.addEventListener('abort', abort, { once: true });
  });
