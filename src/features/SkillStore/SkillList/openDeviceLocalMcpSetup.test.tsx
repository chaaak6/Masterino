import { MotionProvider } from '@lobehub/ui';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { m } from 'motion/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import * as ipc from '@/utils/electron/ipc';

import type { SkillStoreOptions } from '../SkillStoreContent';
import DeviceLocalMcpPanel from './DeviceLocalMcpPanel';
import { openDeviceLocalMcpSetup } from './openDeviceLocalMcpSetup';

const store = vi.hoisted(() => ({ close: vi.fn(), open: vi.fn() }));
vi.mock('..', () => ({ createSkillStoreModal: store.open }));
vi.mock('@/store/user', () => ({ useUserStore: () => 'local-user' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

beforeEach(() => {
  store.open.mockReset();
  store.close.mockClear();
});

it('routes one chat setup to local MCP and settles when the store closes', async () => {
  const chat = new AbortController();
  store.open.mockReturnValue(store.close);
  const first = openDeviceLocalMcpSetup(undefined, chat.signal, 'local-user');
  try {
    await expect(openDeviceLocalMcpSetup(undefined, undefined, 'local-user')).resolves.toBe(
      'already-open',
    );
    expect(store.open).toHaveBeenCalledOnce();
    const options: SkillStoreOptions = store.open.mock.lastCall?.[0];
    expect(options.openLocal).toBe(true);
    expect(options.setup?.setupUserId).toBe('local-user');
    options.setup?.onClose();
    await expect(first).resolves.toBeUndefined();
    expect(store.close).toHaveBeenCalledOnce();
  } finally {
    chat.abort();
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
  store.open.mockImplementation(({ setup }: SkillStoreOptions) => {
    if (setup) dialog = <DeviceLocalMcpPanel addOpen {...setup} />;
    return store.close;
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
