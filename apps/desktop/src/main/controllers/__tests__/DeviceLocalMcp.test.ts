import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';
import { MCPClient } from '@/libs/mcp/client';

import McpCtr from '../McpCtr';

const fixture = new URL('./fixtures/device-local-mcp.mjs', import.meta.url).pathname;
const scope = { userId: 'local-test-user' };
const launchConfig = {
  args: [fixture, '--synthetic-launch-argument'],
  command: process.execPath,
  env: { TEST_LOCAL_MARKER: 'local-env-only' },
};
const mock = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
}));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  safeStorage: {
    decryptString: (buffer: Buffer) => buffer.toString('utf8'),
    encryptString: (value: string) => Buffer.from(value),
    getSelectedStorageBackend: () => 'gnome_libsecret',
    isEncryptionAvailable: () => true,
  },
}));
vi.mock('@/env', () => ({ getDesktopEnv: () => ({ MCP_TOOL_TIMEOUT: 5000 }) }));
vi.mock('@/const/env', () => ({ OFFICIAL_CLOUD_SERVER: 'https://test.example' }));
vi.mock('@/services/fileSrv', () => ({ default: class FileService {} }));
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));
const app = {
  getService: vi.fn(),
  storeManager: {
    get: (key: string, fallback: unknown) => mock.settings[key] ?? fallback,
    set: (key: string, value: unknown) => {
      mock.settings[key] = structuredClone(value);
    },
  },
} as unknown as App;

describe('device-local MCP desktop API', () => {
  beforeEach(() => {
    mock.settings = {};
  });

  afterEach(() => MCPClient.cleanupAll());

  it('discovers, persists, and invokes only authorized tools without returning launch configuration', async () => {
    const controller = new McpCtr(app);
    const tools = await controller.testDeviceLocalServer(launchConfig);
    expect(tools.map(({ name }) => name)).toEqual(['inspect', 'write']);
    const installed = await controller.saveDeviceLocalServer({
      ...scope,
      config: launchConfig,
      enabledTools: ['inspect'],
      name: 'Synthetic CAD',
    });

    const reopened = new McpCtr(app);
    const records = await reopened.listDeviceLocalServers(scope);
    expect(records).toEqual([installed]);
    expect(JSON.stringify(records)).not.toContain('local-env-only');
    expect(JSON.stringify(records)).not.toContain('--synthetic-launch-argument');
    expect(records[0].tools.map(({ name }) => name)).toEqual(['inspect', 'write']);
    expect(records[0].enabledTools).toEqual(['inspect']);
    expect(await reopened.listDeviceLocalServers({ userId: 'another-user' })).toEqual([]);
    await expect(
      reopened.callDeviceLocalTool({
        ...scope,
        identifier: installed.identifier,
        toolName: 'inspect',
      }),
    ).resolves.toMatchObject({ content: 'factory-r03.dxf', success: true });
    await expect(
      reopened.callDeviceLocalTool({
        ...scope,
        identifier: installed.identifier,
        toolName: 'write',
      }),
    ).rejects.toThrow('unavailable');
    await expect(
      reopened.callDeviceLocalTool({
        userId: 'another-user',
        identifier: installed.identifier,
        toolName: 'inspect',
      }),
    ).rejects.toThrow('unavailable');
  });

  it('keeps a live MCP session across consecutive edit and read calls', async () => {
    const controller = new McpCtr(app);
    const { identifier } = await controller.saveDeviceLocalServer({
      ...scope,
      config: launchConfig,
      enabledTools: ['inspect', 'write'],
      name: 'Synthetic CAD',
    });
    const invoke = (toolName: string) =>
      controller.callDeviceLocalTool({ ...scope, identifier, toolName });

    await expect(invoke('write')).resolves.toMatchObject({
      state: { structuredContent: { calls: 1 } },
    });
    await expect(
      controller.callDeviceLocalTool({ ...scope, args: '{invalid', identifier, toolName: 'write' }),
    ).rejects.toThrow('Invalid arguments');
    await expect(invoke('inspect')).resolves.toMatchObject({
      state: { structuredContent: { calls: 2 } },
    });
    await controller.updateDeviceLocalServer({ ...scope, enabled: false, identifier });
    await controller.updateDeviceLocalServer({ ...scope, enabled: true, identifier });
    await expect(invoke('inspect')).resolves.toMatchObject({
      state: { structuredContent: { calls: 1 } },
    });
  });

  it('supports disabling and removing an installed server', async () => {
    const controller = new McpCtr(app);
    const { identifier } = await controller.saveDeviceLocalServer({
      ...scope,
      config: launchConfig,
      enabledTools: ['inspect'],
      name: 'Synthetic CAD',
    });
    await controller.updateDeviceLocalServer({ ...scope, enabled: false, identifier });
    await expect(
      controller.callDeviceLocalTool({
        ...scope,
        identifier,
        toolName: 'inspect',
      }),
    ).rejects.toThrow('unavailable');
    await controller.removeDeviceLocalServer({ ...scope, identifier });
    expect(await new McpCtr(app).listDeviceLocalServers(scope)).toEqual([]);
  });
});
