import type { ExecutionContext } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDeviceLocalMcpSetupManifest, requestDeviceLocalMcpSetup } from './deviceLocalMcpSetup';

const mocks = vi.hoisted(() => ({
  desktop: true,
  open: vi.fn(),
  resolvePreset: vi.fn(),
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  get isDesktop() {
    return mocks.desktop;
  },
}));
vi.mock('@/utils/electron/ipc', () => ({
  ensureElectronIpc: () => ({ mcp: { resolveDeviceLocalMcpPreset: mocks.resolvePreset } }),
}));
vi.mock('@/features/SkillStore/SkillList/openDeviceLocalMcpSetup', () => ({
  openDeviceLocalMcpSetup: mocks.open,
}));

const local: ExecutionContext = {
  plan: { kind: 'device-unrouted', reason: 'no-online-device', target: 'local' },
  version: 1,
};
const sandbox: ExecutionContext = { plan: { kind: 'sandbox', target: 'sandbox' }, version: 1 };

describe('setting up device-local MCP in chat', () => {
  beforeEach(() => {
    mocks.desktop = true;
    vi.resetAllMocks();
  });

  it('offers only preset selection to the model, and only for signed-in local desktop runs', () => {
    expect(getDeviceLocalMcpSetupManifest(undefined, 'user')).toBeUndefined();
    expect(getDeviceLocalMcpSetupManifest(sandbox, 'user')).toBeUndefined();
    expect(getDeviceLocalMcpSetupManifest(local, undefined)).toBeUndefined();
    const manifest = getDeviceLocalMcpSetupManifest(local, 'user');
    expect(manifest?.api[0].parameters).toEqual({
      additionalProperties: false,
      properties: { preset: { enum: ['opencadstudio', 'custom'], type: 'string' } },
      required: ['preset'],
      type: 'object',
    });
    mocks.desktop = false;
    expect(getDeviceLocalMcpSetupManifest(local, 'user')).toBeUndefined();
  });

  it('returns a safe receipt after the user saves the local configuration', async () => {
    const launch = {
      args: ['--mcp'],
      command: '/Synthetic/OpenCADStudio',
      env: { MARKER: 'local-only-marker' },
      name: 'OpenCADStudio',
    };
    mocks.resolvePreset.mockResolvedValue(launch);
    mocks.open.mockResolvedValue({
      enabledTools: ['ocs_inspect'],
      identifier: 'local-mcp-0123456789abcdef01234567',
      name: 'OpenCADStudio',
    });
    const receipt = await requestDeviceLocalMcpSetup('{"preset":"opencadstudio"}', local, 'user');

    expect(mocks.resolvePreset).toHaveBeenCalledWith('opencadstudio');
    expect(mocks.open).toHaveBeenCalledWith(launch, undefined, 'user');
    expect(receipt.state).toEqual({
      enabledToolCount: 1,
      identifier: 'local-mcp-0123456789abcdef01234567',
      name: 'OpenCADStudio',
      status: 'configured',
      tools: ['ocs_inspect'],
    });
    expect(receipt.content).toContain('The enabled tool count is 1');
    expect(receipt.content).toContain('ocs_inspect');
    expect(JSON.stringify(receipt)).not.toMatch(/Synthetic|--mcp|local-only-marker/);
  });

  it('rejects extra starting configuration and reports cancellation without setup', async () => {
    await expect(
      requestDeviceLocalMcpSetup('{"preset":"custom","command":"/synthetic/test"}', local, 'user'),
    ).rejects.toThrow('Select a supported local MCP setup preset');
    await expect(
      requestDeviceLocalMcpSetup('{"preset":"custom"}', sandbox, 'user'),
    ).rejects.toThrow('unavailable');
    expect(mocks.open).not.toHaveBeenCalled();

    mocks.open.mockResolvedValue(undefined);
    await expect(
      requestDeviceLocalMcpSetup('{"preset":"custom"}', local, 'user'),
    ).resolves.toMatchObject({
      state: { status: 'cancelled' },
    });
    expect(mocks.resolvePreset).not.toHaveBeenCalled();
  });

  it('propagates a chat stop when the dialog closes without saving', async () => {
    const controller = new AbortController();
    mocks.open.mockImplementation(() => {
      controller.abort();
      return Promise.resolve(undefined);
    });
    await expect(
      requestDeviceLocalMcpSetup('{"preset":"custom"}', local, 'user', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('reports an existing setup dialog without marking the second call as a failure', async () => {
    mocks.open.mockResolvedValue('already-open');
    await expect(
      requestDeviceLocalMcpSetup('{"preset":"custom"}', local, 'user'),
    ).resolves.toMatchObject({ state: { status: 'already-open' }, success: true });
  });
});
