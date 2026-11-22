import { MotionProvider } from '@lobehub/ui';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { m } from 'motion/react';
import { createElement, type ComponentType, type ReactNode } from 'react';
import { expect, it, vi } from 'vitest';

import * as ipc from '@/utils/electron/ipc';

import { openDeviceLocalMcpSetup } from './openDeviceLocalMcpSetup';

const modal = vi.hoisted(() => ({ create: vi.fn(), destroy: vi.fn() }));
vi.mock('@lobehub/ui', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  createRawModal: modal.create,
}));
vi.mock('@/store/user', () => ({ useUserStore: () => 'local-user' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

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
