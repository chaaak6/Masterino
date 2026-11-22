import type { DeviceLocalMcpDraft, DeviceLocalMcpServer } from '@lobechat/electron-client-ipc';
import { createRawModal } from '@lobehub/ui';

import DeviceLocalMcpModal from './DeviceLocalMcpModal';

interface SetupDialogProps {
  draft?: DeviceLocalMcpDraft;
  onCancelSetup: () => void;
  onHostClose?: () => void;
  onSavingChange: (saving: boolean) => void;
  onFinish: (server?: DeviceLocalMcpServer) => void;
  open: boolean;
  setupUserId: string;
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
      onSavingChange={onSavingChange}
      onSaved={onFinish}
    />
  ) : null;

let setupOpen = false;

export const openDeviceLocalMcpSetup = (
  draft: DeviceLocalMcpDraft | undefined,
  signal: AbortSignal | undefined,
  setupUserId: string,
) =>
  new Promise<DeviceLocalMcpServer | undefined>((resolve) => {
    if (signal?.aborted) {
      resolve(undefined);
      return;
    }

    if (setupOpen) throw new Error('A local MCP setup is already open');
    let settled = false;
    let saving = false;
    let cancellationRequested = false;
    const finish = (server?: DeviceLocalMcpServer) => {
      if (settled) return;
      settled = true;
      setupOpen = false;
      signal?.removeEventListener('abort', abort);
      modal.destroy();
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
    const modal = createRawModal(
      SetupDialog,
      { draft, onCancelSetup: abort, onFinish: finish, onSavingChange, setupUserId },
      {
        onCloseKey: 'onHostClose',
        openKey: 'open',
      },
    );
    setupOpen = true;
    signal?.addEventListener('abort', abort, { once: true });
  });
