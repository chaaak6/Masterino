import { MotionProvider } from '@lobehub/ui';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { m } from 'motion/react';
import { type ComponentType, createElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import * as ipc from '@/utils/electron/ipc';

import { openDeviceLocalMcpSettings, openDeviceLocalMcpSetup } from './openDeviceLocalMcpSetup';

const modal = vi.hoisted(() => ({ create: vi.fn(), destroy: vi.fn() }));
vi.mock('@lobehub/ui', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  createRawModal: modal.create,
}));
vi.mock('@/store/user', () => ({ useUserStore: () => 'local-user' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

beforeEach(() => {
  modal.create.mockReset();
  modal.destroy.mockClear();
});

it('opens just one setup dialog when Skills and two chat calls overlap', async () => {
  let closeSettings = () => {};
  modal.create.mockImplementation((_component, { onCancelSetup }) => {
    closeSettings = onCancelSetup;
    return { destroy: modal.destroy };
  });
  const chat = new AbortController();
  const first = openDeviceLocalMcpSetup(undefined, chat.signal, 'local-user');
  try {
    await expect(openDeviceLocalMcpSetup(undefined, undefined, 'local-user')).resolves.toBe(
      'already-open',
    );
    openDeviceLocalMcpSettings();
    expect(modal.create).toHaveBeenCalledOnce();
  } finally {
    chat.abort();
    await expect(first).resolves.toBeUndefined();
  }

  openDeviceLocalMcpSettings();
  try {
    await expect(openDeviceLocalMcpSetup(undefined, undefined, 'local-user')).resolves.toBe(
      'already-open',
    );
    expect(modal.create).toHaveBeenCalledTimes(2);
  } finally {
    closeSettings();
  }
});

it('reports an accepted save even if chat is stopped before IPC acknowledges it', async () => {
  const saved = {
    enabled: true,
    enabledTools: ['ocs_inspect'],
    identifier: 'local-mcp-0123456789abcdef01234567',
    name: 'OpenCADStudio',
    tools: [{ inputSchema: {}, name: 'ocs_inspect' }],
  };
  const deferred = Promise.withResolvers<typeof saved>();
  const saveDeviceLocalServer = vi.fn(() => deferred.promise);
  vi.spyOn(ipc, 'ensureElectronIpc').mockReturnValue({
    mcp: { saveDeviceLocalServer, testDeviceLocalServer: vi.fn().mockResolvedValue(saved.tools) },
  } as ReturnType<typeof ipc.ensureElectronIpc>);
  let dialog: ReactNode = null;
  modal.create.mockImplementation((Component: ComponentType<any>, props: object) => {
    dialog = createElement(Component, { ...props, open: true });
    return { destroy: modal.destroy };
  });
  const controller = new AbortController();
  const receipt = openDeviceLocalMcpSetup(
    { command: '/local/cad', name: 'OpenCADStudio' },
    controller.signal,
    'local-user',
  );
  render(<MotionProvider motion={m}>{dialog}</MotionProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'deviceLocalMcp.test' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'deviceLocalMcp.save' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'deviceLocalMcp.save' }));
  expect(saveDeviceLocalServer).toHaveBeenCalledOnce();
  await act(async () => {
    controller.abort();
    deferred.resolve(saved);
  });
  await expect(receipt).resolves.toEqual(saved);
});
