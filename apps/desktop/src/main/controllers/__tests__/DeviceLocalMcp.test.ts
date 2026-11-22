import { fileURLToPath } from 'node:url';

import { deviceLocalMcpErrors } from '@lobechat/electron-client-ipc';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';
import { MCPClient } from '@/libs/mcp/client';

import McpCtr from '../McpCtr';

const fixture = fileURLToPath(new URL('./fixtures/device-local-mcp.mjs', import.meta.url));
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
  getController: () => ({
    getAccessToken: async () => 'synthetic-session-token',
    getRemoteServerUrl: async () => 'https://test.example',
  }),
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ result: { data: { json: { userId: scope.userId } } } })),
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await MCPClient.cleanupAll();
  });

  it('discovers, persists, and invokes only authorized tools without returning launch configuration', async () => {
    const controller = new McpCtr(app);
    await expect(
      controller.testDeviceLocalServer({ config: launchConfig, userId: 'another-user' }),
    ).rejects.toThrow(deviceLocalMcpErrors.account);
    const tools = await controller.testDeviceLocalServer({ ...scope, config: launchConfig });
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
    await expect(
      Promise.resolve().then(() => reopened.listDeviceLocalServers({ userId: 'another-user' })),
    ).rejects.toThrow(deviceLocalMcpErrors.account);
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
    ).rejects.toThrow(deviceLocalMcpErrors.account);
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

  it('shares one stdio client across simultaneous first calls', async () => {
    const controller = new McpCtr(app);
    const { identifier } = await controller.saveDeviceLocalServer({
      ...scope,
      config: launchConfig,
      enabledTools: ['inspect'],
      name: 'Synthetic CAD',
    });
    const initialize = vi.spyOn(MCPClient.prototype, 'initialize');
    const call = () =>
      controller.callDeviceLocalTool({ ...scope, identifier, toolName: 'inspect' });
    await expect(Promise.all([call(), call()])).resolves.toMatchObject([
      { state: { structuredContent: { calls: 1 } } },
      { state: { structuredContent: { calls: 2 } } },
    ]);
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it.each(['disable', 'remove'])(
    'lets accepted calls finish when users %s the server',
    async (action) => {
      const controller = new McpCtr(app);
      const { identifier } = await controller.saveDeviceLocalServer({
        ...scope,
        config: launchConfig,
        enabledTools: ['write'],
        name: 'Synthetic CAD',
      });

      let release!: () => void;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const original = MCPClient.prototype.callTool;
      vi.spyOn(MCPClient.prototype, 'callTool').mockImplementationOnce(async function (
        this: MCPClient,
        tool,
        args,
      ) {
        entered();
        await barrier;
        return original.call(this, tool, args);
      });
      const disconnect = vi.spyOn(MCPClient.prototype, 'disconnect');
      const call = () =>
        controller.callDeviceLocalTool({ ...scope, identifier, toolName: 'write' });
      const running = call();
      await started;

      try {
        if (action === 'disable')
          await controller.updateDeviceLocalServer({ ...scope, identifier, enabled: false });
        else await controller.removeDeviceLocalServer({ ...scope, identifier });
        await expect(call()).rejects.toThrow('unavailable');
        expect(disconnect).not.toHaveBeenCalled();
      } finally {
        release();
        await expect(running).resolves.toMatchObject({ success: true });
      }
      expect(disconnect).toHaveBeenCalledTimes(1);
    },
  );

  it('waits for an earlier connection to close after re-enabling', async () => {
    const controller = new McpCtr(app);
    const { identifier } = await controller.saveDeviceLocalServer({
      ...scope,
      config: launchConfig,
      enabledTools: ['write'],
      name: 'Synthetic CAD',
    });
    const holdCall = Promise.withResolvers<void>();
    const firstCallStarted = Promise.withResolvers<void>();
    const originalCall = MCPClient.prototype.callTool;
    vi.spyOn(MCPClient.prototype, 'callTool').mockImplementationOnce(async function (
      this: MCPClient,
      tool,
      args,
    ) {
      firstCallStarted.resolve();
      await holdCall.promise;
      return originalCall.call(this, tool, args);
    });
    const initialize = vi.spyOn(MCPClient.prototype, 'initialize');
    const call = () => controller.callDeviceLocalTool({ ...scope, identifier, toolName: 'write' });
    const running = call();
    await firstCallStarted.promise;
    await controller.updateDeviceLocalServer({ ...scope, identifier, enabled: false });
    await controller.updateDeviceLocalServer({ ...scope, identifier, enabled: true });
    const queued = call();
    let startsBeforeRetirement: number;
    try {
      startsBeforeRetirement = initialize.mock.calls.length;
    } finally {
      holdCall.resolve();
      await Promise.all([running, queued]);
    }
    expect(startsBeforeRetirement).toBe(1);
    expect(initialize).toHaveBeenCalledTimes(2);
  });

  it('returns the stored selection and rejects empty or stale updates', async () => {
    const controller = new McpCtr(app);
    const { identifier } = await controller.saveDeviceLocalServer({
      ...scope,
      config: launchConfig,
      enabledTools: ['inspect'],
      name: 'Synthetic CAD',
    });
    const update = { ...scope, identifier, enabled: true };
    await expect(
      controller.updateDeviceLocalServer({ ...update, enabledTools: [] }),
    ).rejects.toThrow();
    await expect(
      controller.updateDeviceLocalServer({ ...update, userId: 'other-account' }),
    ).rejects.toThrow();
    const saved = await controller.updateDeviceLocalServer({ ...update, enabledTools: ['write'] });
    expect(saved).toMatchObject({ identifier, enabledTools: ['write'] });
    expect(await controller.listDeviceLocalServers(scope)).toEqual([saved]);
  });

  it('blocks a replacement until the previous process is confirmed stopped', async () => {
    const controller = new McpCtr(app);
    const { identifier } = await controller.saveDeviceLocalServer({
      ...scope,
      config: launchConfig,
      enabledTools: ['inspect'],
      name: 'Synthetic CAD',
    });
    const call = () =>
      controller.callDeviceLocalTool({ ...scope, identifier, toolName: 'inspect' });
    await call();
    const disconnect = vi
      .spyOn(MCPClient.prototype, 'disconnect')
      .mockRejectedValueOnce(new Error('process still running'))
      .mockRejectedValueOnce(new Error('process still running'));
    const initialize = vi.spyOn(MCPClient.prototype, 'initialize');
    await expect(
      controller.updateDeviceLocalServer({ ...scope, enabled: false, identifier }),
    ).rejects.toThrow(deviceLocalMcpErrors.stopFailed);
    await controller.updateDeviceLocalServer({ ...scope, enabled: true, identifier });
    await expect(call()).rejects.toThrow(deviceLocalMcpErrors.stopFailed);
    expect(initialize).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(2);
    await expect(call()).resolves.toMatchObject({ success: true });
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it('starts a new session on the next call after the stdio process exits', async () => {
    const controller = new McpCtr(app);
    const { identifier } = await controller.saveDeviceLocalServer({
      ...scope,
      config: launchConfig,
      enabledTools: ['inspect', 'write'],
      name: 'Synthetic CAD',
    });
    const call = (toolName: string, args?: string) =>
      controller.callDeviceLocalTool({ ...scope, args, identifier, toolName });
    await expect(call('write', '{"exitAfterReply":true}')).resolves.toMatchObject({
      success: true,
    });
    const initialize = vi.spyOn(MCPClient.prototype, 'initialize');
    await new Promise((resolve) => setTimeout(resolve, 150));
    await expect(call('inspect')).resolves.toMatchObject({ success: true });
    expect(initialize).toHaveBeenCalledTimes(1);
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
