import type { DeviceLocalMcpDraft, DeviceLocalMcpServer } from '@lobechat/electron-client-ipc';
import { createRawModal } from '@lobehub/ui';

import DeviceLocalMcpModal from './DeviceLocalMcpModal';

interface SetupDialogProps {
  draft?: DeviceLocalMcpDraft;
  onClose: () => void;
  onFinish: (server?: DeviceLocalMcpServer) => void;
  open: boolean;
  setupUserId: string;
}

const SetupDialog = ({ draft, onFinish, open, setupUserId }: SetupDialogProps) =>
  open ? (
    <DeviceLocalMcpModal
      draft={draft}
      setupUserId={setupUserId}
      onClose={() => onFinish()}
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
    const finish = (server?: DeviceLocalMcpServer) => {
      if (settled) return;
      settled = true;
      setupOpen = false;
      signal?.removeEventListener('abort', abort);
      modal.destroy();
      resolve(server);
    };
    const abort = () => finish();
    const modal = createRawModal(
      SetupDialog,
      { draft, onFinish: finish, setupUserId },
      {
        onCloseKey: 'onClose',
        openKey: 'open',
      },
    );
    setupOpen = true;
    signal?.addEventListener('abort', abort, { once: true });
  });
