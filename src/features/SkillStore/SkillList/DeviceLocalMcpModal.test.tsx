import { deviceLocalMcpErrors, type DeviceLocalMcpServer } from '@lobechat/electron-client-ipc';
import { MotionProvider } from '@lobehub/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import { m } from 'motion/react';
import { expect, it, vi } from 'vitest';

import * as ipc from '@/utils/electron/ipc';

import DeviceLocalMcpModal from './DeviceLocalMcpModal';

vi.mock('@/store/user', () => ({
  useUserStore: () => 'local-user',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

it('refreshes saved connections when an enabled row disappears in another window', async () => {
  const stale: DeviceLocalMcpServer = {
    enabled: true,
    enabledTools: ['inspect'],
    identifier: 'local-mcp-000000000000000000000001',
    name: 'Removed connection',
    tools: [{ inputSchema: {}, name: 'inspect' }],
  };
  const replacement: DeviceLocalMcpServer = {
    ...stale,
    identifier: 'local-mcp-000000000000000000000002',
    name: 'Replacement connection',
  };
  const listDeviceLocalServers = vi
    .fn()
    .mockResolvedValueOnce([stale])
    .mockResolvedValue([replacement]);
  const updateDeviceLocalServer = vi
    .fn()
    .mockRejectedValue(new Error(deviceLocalMcpErrors.serverUnavailable));
  vi.spyOn(ipc, 'ensureElectronIpc').mockReturnValue({
    mcp: { listDeviceLocalServers, updateDeviceLocalServer },
  } as ReturnType<typeof ipc.ensureElectronIpc>);

  render(
    <MotionProvider motion={m}>
      <DeviceLocalMcpModal onClose={vi.fn()} />
    </MotionProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'deviceLocalMcp.disable' }));

  expect(await screen.findByText('deviceLocalMcp.error.serverUnavailable')).toBeInTheDocument();
  expect(await screen.findByText('Replacement connection')).toBeInTheDocument();
  expect(screen.queryByText('Removed connection')).not.toBeInTheDocument();
});
