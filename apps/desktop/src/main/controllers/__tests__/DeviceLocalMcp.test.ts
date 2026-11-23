import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { deviceLocalMcpErrors } from '@lobechat/electron-client-ipc';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type RemoteServerConfigCtr from '@/controllers/RemoteServerConfigCtr';
import type { App } from '@/core/App';
import { MCPClient } from '@/libs/mcp/client';
import type { DeviceLocalMcpScope } from '@/libs/mcp/deviceLocalAccount';
import { DeviceLocalMcpAccount } from '@/libs/mcp/deviceLocalAccount';
import { DeviceLocalMcpSessions } from '@/libs/mcp/deviceLocalSessions';
import { runWithIpcContext } from '@/utils/ipc';

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

  it('cancels a legacy STDIO tool over IPC only from its initiating window', async () => {
    const controller = new McpCtr(app);
    const sender = (id: number) => ({
      event: {} as IpcMainInvokeEvent,
      sender: { id } as WebContents,
    });
    const started = Promise.withResolvers<AbortSignal>();
    const original = MCPClient.prototype.callTool;
    vi.spyOn(MCPClient.prototype, 'callTool').mockImplementationOnce(function (
      this: MCPClient,
      toolName,
      args,
      signal,
    ) {
      started.resolve(signal!);
      return original.call(this, toolName, args, signal);
    });
    const disconnect = vi.spyOn(MCPClient.prototype, 'disconnect');
    const input = {
      args: { waitForCancel: true },
      env: launchConfig.env,
      params: { ...launchConfig, name: 'legacy-cad' },
      toolName: 'inspect',
    };
    const call = runWithIpcContext(sender(1), () =>
      controller.callTool({ json: input }, 'tool-request'),
    );
    const rejected = expect(call).rejects.toMatchObject({ name: 'AbortError' });
    const signal = await started.promise;
    await runWithIpcContext(sender(2), () => controller.cancelStdioToolCall('tool-request'));
    expect(signal.aborted).toBe(false);
    await runWithIpcContext(sender(1), () => controller.cancelStdioToolCall('tool-request'));
    await rejected;
    expect(signal.aborted).toBe(true);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('checks that a tool is still enabled after an in-flight account lookup', async () => {
    const sessions = new DeviceLocalMcpSessions();
    const pendingScope = Promise.withResolvers<DeviceLocalMcpScope>();
    const createClient = vi.fn();
    let enabled = true;
    const invocation = sessions.call(
      'cad',
      'inspect',
      {},
      {
        authorize: () => {
          if (!enabled) throw new Error('unavailable');
          return createClient;
        },
        getScope: () => pendingScope.promise,
      },
    );
    const rejected = expect(invocation).rejects.toThrow('unavailable');

    pendingScope.resolve({ id: 'verified-scope', matches: () => true });
    enabled = false;
    await sessions.retire('cad');
    await rejected;
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each(['disable', 'remove', 'deselect'])(
    'never dispatches an initializing tool after users %s it',
    async (action) => {
      const controller = new McpCtr(app);
      const { identifier } = await controller.saveDeviceLocalServer({
        ...scope,
        config: launchConfig,
        enabledTools: ['inspect', 'write'],
        name: 'Synthetic CAD',
      });
      const started = Promise.withResolvers<void>();
      const initializing = Promise.withResolvers<void>();
      vi.spyOn(MCPClient.prototype, 'initialize').mockImplementationOnce(() => {
        started.resolve();
        return initializing.promise;
      });
      const callTool = vi.spyOn(MCPClient.prototype, 'callTool');
      const disconnect = vi.spyOn(MCPClient.prototype, 'disconnect');
      const call = controller.callDeviceLocalTool({ ...scope, identifier, toolName: 'write' });
      const result = expect(call).rejects.toThrow(/unavailable/i);
      await started.promise;

      try {
        if (action === 'remove') await controller.removeDeviceLocalServer({ ...scope, identifier });
        else if (action === 'disable')
          await controller.updateDeviceLocalServer({ ...scope, enabled: false, identifier });
        else
          await controller.updateDeviceLocalServer({
            ...scope,
            enabled: true,
            enabledTools: ['inspect'],
            identifier,
          });
      } finally {
        initializing.resolve();
        await result;
      }
      expect(callTool).not.toHaveBeenCalled();
      expect(disconnect).toHaveBeenCalledTimes(action === 'deselect' ? 0 : 1);
    },
  );

  it('checks the same account again when its access token refreshes during lookup', async () => {
    let token = 'before-refresh';
    const firstResponse = Promise.withResolvers<Response>();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(firstResponse.promise)
      .mockResolvedValueOnce(
        Response.json({ result: { data: { json: { userId: scope.userId } } } }),
      );
    vi.stubGlobal('fetch', fetch);
    const remote = {
      getAccessToken: async () => token,
      getRemoteServerUrl: async () => 'https://test.example',
    } as RemoteServerConfigCtr;

    const lookup = new DeviceLocalMcpAccount().getScope(remote, scope.userId);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    token = 'after-refresh';
    firstResponse.resolve(new Response(null, { status: 401 }));

    await expect(lookup).resolves.toMatchObject({ id: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(fetch).toHaveBeenLastCalledWith(
      'https://test.example/trpc/lambda/user.getUserState',
      expect.objectContaining({ headers: { 'Oidc-Auth': token }, redirect: 'error' }),
    );
  });

  it('keeps saved tools after changing the remote URL trailing slash', async () => {
    const controller = new McpCtr(app);
    const [installed] = await Promise.all(
      ['First CAD', 'Second CAD'].map((name) =>
        controller.saveDeviceLocalServer({
          ...scope,
          config: launchConfig,
          enabledTools: ['inspect'],
          name,
        }),
      ),
    );
    const legacyScope = createHash('sha256')
      .update(JSON.stringify(['https://test.example/', scope.userId]))
      .digest('hex');
    const records = mock.settings.deviceLocalMcpServers as {
      scope: string;
      server: { identifier: string };
    }[];
    const legacyRecord = records.find((item) => item.server.identifier === installed.identifier)!;
    legacyRecord.scope = legacyScope;
    const listed = await controller.listDeviceLocalServers(scope);
    expect(listed).toContainEqual(installed);
    expect(listed).toHaveLength(2);
    await expect(
      controller.callDeviceLocalTool({
        ...scope,
        identifier: installed.identifier,
        toolName: 'inspect',
      }),
    ).resolves.toMatchObject({ success: true });
    await controller.updateDeviceLocalServer({
      ...scope,
      enabled: false,
      identifier: installed.identifier,
    });
    expect(mock.settings.deviceLocalMcpServers).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ scope: legacyScope })]),
    );
  });

  it('reports a legacy STDIO tool error and preserves its details', async () => {
    const controller = new McpCtr(app);

    await expect(
      controller.runStdioMcpTool({
        args: { toolError: true },
        env: launchConfig.env,
        params: { ...launchConfig, name: 'synthetic-cad', type: 'stdio' },
        toolName: 'inspect',
      }),
    ).resolves.toMatchObject({
      content: 'Invalid drawing argument',
      state: { isError: true },
      success: false,
    });
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

  it('keeps the drawing session open when a tool rejects its arguments', async () => {
    const controller = new McpCtr(app);
    const { identifier } = await controller.saveDeviceLocalServer({
      ...scope,
      config: launchConfig,
      enabledTools: ['inspect'],
      name: 'Synthetic CAD',
    });
    const call = (args?: string) =>
      controller.callDeviceLocalTool({ ...scope, args, identifier, toolName: 'inspect' });
    await expect(call()).resolves.toMatchObject({ state: { structuredContent: { calls: 1 } } });
    await expect(call('{"rejectArguments":true}')).rejects.toThrow('Invalid drawing argument');
    await expect(call()).resolves.toMatchObject({ state: { structuredContent: { calls: 2 } } });
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
