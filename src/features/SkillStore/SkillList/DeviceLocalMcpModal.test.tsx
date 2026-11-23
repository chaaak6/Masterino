import { deviceLocalMcpErrors, type DeviceLocalMcpServer } from '@lobechat/electron-client-ipc';
import { MotionProvider } from '@lobehub/ui';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { m } from 'motion/react';
import { afterEach, expect, it, vi } from 'vitest';

import * as scopedSWR from '@/libs/swr';
import { electronKeys } from '@/libs/swr/keys';
import * as ipc from '@/utils/electron/ipc';

import DeviceLocalMcpModal from './DeviceLocalMcpModal';

const account = vi.hoisted(() => ({ userId: 'local-user' }));

vi.mock('@/store/user', () => ({
  useUserStore: () => account.userId,
}));

afterEach(() => {
  account.userId = 'local-user';
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

it.each(['disable', 'saveTools'])(
  'refreshes saved connections when %s targets a removed row',
  async (action) => {
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
    if (action === 'saveTools')
      fireEvent.click(await screen.findByRole('button', { name: 'deviceLocalMcp.editTools' }));
    fireEvent.click(await screen.findByRole('button', { name: `deviceLocalMcp.${action}` }));

    expect(await screen.findByText('deviceLocalMcp.error.serverUnavailable')).toBeInTheDocument();
    expect(await screen.findByText('Replacement connection')).toBeInTheDocument();
    expect(screen.queryByText('Removed connection')).not.toBeInTheDocument();
  },
);

it('keeps a late connection refresh from showing another account’s servers', async () => {
  const first: DeviceLocalMcpServer = {
    enabled: true,
    enabledTools: ['inspect'],
    identifier: 'local-mcp-000000000000000000000001',
    name: 'First account CAD',
    tools: [{ inputSchema: {}, name: 'inspect' }],
  };
  const second: DeviceLocalMcpServer = {
    ...first,
    identifier: 'local-mcp-000000000000000000000002',
    name: 'Second account CAD',
  };
  const refresh = Promise.withResolvers<DeviceLocalMcpServer[]>();
  const listDeviceLocalServers = vi
    .fn()
    .mockResolvedValueOnce([first])
    .mockReturnValueOnce(refresh.promise)
    .mockResolvedValueOnce([second]);
  const updateDeviceLocalServer = vi
    .fn()
    .mockRejectedValue(new Error(deviceLocalMcpErrors.serverUnavailable));
  vi.spyOn(ipc, 'ensureElectronIpc').mockReturnValue({
    mcp: { listDeviceLocalServers, updateDeviceLocalServer },
  } as ReturnType<typeof ipc.ensureElectronIpc>);

  const renderModal = () => (
    <MotionProvider motion={m}>
      <DeviceLocalMcpModal onClose={vi.fn()} />
    </MotionProvider>
  );
  const { rerender } = render(renderModal());
  fireEvent.click(await screen.findByRole('button', { name: 'deviceLocalMcp.disable' }));
  await waitFor(() => expect(listDeviceLocalServers).toHaveBeenCalledTimes(2));

  account.userId = 'another-user';
  rerender(renderModal());
  expect(await screen.findByText(second.name)).toBeInTheDocument();
  await act(async () => refresh.resolve([first]));
  expect(screen.queryByText(first.name)).not.toBeInTheDocument();
  expect(screen.getByText(second.name)).toBeInTheDocument();
});

it('shows the data boundary in chat setup and keeps existing selected tools when testing again', async () => {
  const draft = { command: '/local/ocs', name: 'OpenCADStudio' };
  const tools = ['ocs_inspect', 'ocs_save'].map((name) => ({ inputSchema: {}, name }));
  const testDeviceLocalServer = vi.fn().mockResolvedValue(tools);
  vi.spyOn(ipc, 'ensureElectronIpc').mockReturnValue({
    mcp: { testDeviceLocalServer },
  } as ReturnType<typeof ipc.ensureElectronIpc>);
  render(
    <MotionProvider motion={m}>
      <DeviceLocalMcpModal draft={draft} onClose={vi.fn()} onSaved={vi.fn()} />
    </MotionProvider>,
  );
  const testConnection = screen.getByRole('button', { name: 'deviceLocalMcp.test' });
  fireEvent.click(testConnection);
  fireEvent.click(await screen.findByRole('checkbox', { name: 'ocs_save' }));
  fireEvent.click(testConnection);
  expect(await screen.findByRole('checkbox', { name: 'ocs_save' })).toBeChecked();
  expect(screen.getByText('deviceLocalMcp.description')).toBeInTheDocument();
  expect(screen.getByText('deviceLocalMcp.useInChat')).toBeInTheDocument();
});

it('lets the user close chat setup while connection discovery is pending', () => {
  const onClose = vi.fn();
  const discovery = Promise.withResolvers<DeviceLocalMcpServer['tools']>();
  const testDeviceLocalServer = vi.fn(() => discovery.promise);
  vi.spyOn(ipc, 'ensureElectronIpc').mockReturnValue({
    mcp: { testDeviceLocalServer },
  } as ReturnType<typeof ipc.ensureElectronIpc>);

  render(
    <MotionProvider motion={m}>
      <DeviceLocalMcpModal
        draft={{ command: '/local/ocs', name: 'OpenCADStudio' }}
        onClose={onClose}
        onSaved={vi.fn()}
      />
    </MotionProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'deviceLocalMcp.test' }));
  expect(testDeviceLocalServer).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'close' }));
  expect(onClose).toHaveBeenCalledOnce();
});

it('refreshes the conversation tool list after saving through chat setup', async () => {
  const draft = { command: '/local/ocs', name: 'OpenCADStudio' };
  const server: DeviceLocalMcpServer = {
    enabled: true,
    enabledTools: ['ocs_inspect'],
    identifier: 'local-mcp-000000000000000000000001',
    name: draft.name,
    tools: [{ inputSchema: {}, name: 'ocs_inspect' }],
  };
  vi.spyOn(ipc, 'ensureElectronIpc').mockReturnValue({
    mcp: {
      saveDeviceLocalServer: vi.fn().mockResolvedValue(server),
      testDeviceLocalServer: vi.fn().mockResolvedValue(server.tools),
    },
  } as ReturnType<typeof ipc.ensureElectronIpc>);
  const refresh = vi.spyOn(scopedSWR, 'mutate').mockResolvedValue(undefined);
  const onSaved = vi.fn();
  try {
    render(
      <MotionProvider motion={m}>
        <DeviceLocalMcpModal draft={draft} onClose={vi.fn()} onSaved={onSaved} />
      </MotionProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'deviceLocalMcp.test' }));
    expect(await screen.findByRole('checkbox', { name: 'ocs_inspect' })).toBeChecked();
    expect(refresh).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'deviceLocalMcp.save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(server));
    const matcher = refresh.mock.lastCall?.[0];
    if (typeof matcher !== 'function') throw new Error('Expected a cache key matcher');
    expect(matcher(electronKeys.deviceLocalMcp(account.userId, 'https://test.example'))).toBe(true);
    expect(matcher(electronKeys.deviceLocalMcp('another-user', 'https://test.example'))).toBe(
      false,
    );
  } finally {
    refresh.mockRestore();
  }
});

it('keeps unsaved tool changes available for retry when updating a connection fails', async () => {
  const server: DeviceLocalMcpServer = {
    enabled: true,
    enabledTools: ['inspect'],
    identifier: 'local-mcp-000000000000000000000001',
    name: 'CAD connection',
    tools: ['inspect', 'save'].map((name) => ({ inputSchema: {}, name })),
  };
  const listDeviceLocalServers = vi.fn().mockResolvedValue([server]);
  const updateDeviceLocalServer = vi
    .fn()
    .mockRejectedValueOnce(new Error(deviceLocalMcpErrors.serverUnavailable))
    .mockResolvedValue({ ...server, enabledTools: ['inspect', 'save'] });
  vi.spyOn(ipc, 'ensureElectronIpc').mockReturnValue({
    mcp: { listDeviceLocalServers, updateDeviceLocalServer },
  } as ReturnType<typeof ipc.ensureElectronIpc>);

  render(
    <MotionProvider motion={m}>
      <DeviceLocalMcpModal onClose={vi.fn()} />
    </MotionProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'deviceLocalMcp.editTools' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'save' }));
  fireEvent.click(screen.getByRole('button', { name: 'deviceLocalMcp.saveTools' }));

  expect(await screen.findByText('deviceLocalMcp.error.serverUnavailable')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'save' })).toBeChecked();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'deviceLocalMcp.saveTools' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'deviceLocalMcp.saveTools' }));
  expect(updateDeviceLocalServer).toHaveBeenLastCalledWith(
    expect.objectContaining({ enabledTools: ['inspect', 'save'] }),
  );
  expect(updateDeviceLocalServer).toHaveBeenCalledTimes(2);
});
