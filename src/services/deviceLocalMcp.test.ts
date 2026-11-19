import { beforeEach, describe, expect, it, vi } from 'vitest';

import { callDeviceLocalMcp, getDeviceLocalMcpManifests } from './deviceLocalMcp';

const boundary = vi.hoisted(() => ({
  call: vi.fn(),
  desktop: true,
  list: vi.fn(),
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  get isDesktop() {
    return boundary.desktop;
  },
}));
vi.mock('@/utils/electron/ipc', () => ({
  ensureElectronIpc: () => ({
    mcp: { callDeviceLocalTool: boundary.call, listDeviceLocalServers: boundary.list },
  }),
}));

const local = {
  plan: { kind: 'device-unrouted', reason: 'no-online-device', target: 'local' },
  version: 1,
} as const;
const sandbox = { plan: { kind: 'sandbox', target: 'sandbox' }, version: 1 } as const;
const identifier = 'local-mcp-0123456789abcdef01234567';
const payload = { apiName: 'ocs_inspect', arguments: '{}', identifier };

describe('device-local MCP in desktop Agent runs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boundary.desktop = true;
  });

  it('exposes only enabled tools and sends no process configuration with the manifest', async () => {
    const tools = [
      { description: 'Read the drawing', inputSchema: { type: 'object' }, name: 'ocs_inspect' },
      { inputSchema: { type: 'object' }, name: 'ocs_run' },
    ];
    boundary.list.mockResolvedValue([
      { enabled: true, enabledTools: ['ocs_inspect'], identifier, name: 'CAD', tools },
      { enabled: false, enabledTools: ['ocs_inspect'], identifier: 'inactive', name: 'CAD', tools },
    ]);

    const manifests = await getDeviceLocalMcpManifests(local, 'test-user');
    expect(manifests).toEqual([
      {
        api: [
          {
            description: 'Read the drawing',
            humanIntervention: 'required',
            name: 'ocs_inspect',
            parameters: { type: 'object' },
          },
        ],
        identifier,
        meta: { title: 'CAD' },
        type: 'mcp',
      },
    ]);
    expect(boundary.list).toHaveBeenCalledWith({ userId: 'test-user' });
  });

  it('is unavailable on the web and in sandbox or no-device sessions', async () => {
    await expect(getDeviceLocalMcpManifests(sandbox, 'test-user')).resolves.toEqual([]);
    await expect(getDeviceLocalMcpManifests(undefined, 'test-user')).resolves.toEqual([]);
    boundary.desktop = false;
    await expect(getDeviceLocalMcpManifests(local, 'test-user')).resolves.toEqual([]);
    expect(boundary.list).not.toHaveBeenCalled();
  });

  it('passes only the invocation to desktop IPC', async () => {
    const response = { content: 'factory-r03.dxf', state: {}, success: true };
    boundary.call.mockResolvedValue(response);

    await expect(callDeviceLocalMcp(payload, local, 'test-user')).resolves.toEqual(response);
    expect(boundary.call).toHaveBeenCalledWith({
      args: '{}',
      identifier,
      toolName: 'ocs_inspect',
      userId: 'test-user',
    });
    await expect(callDeviceLocalMcp(payload, sandbox, 'test-user')).rejects.toThrow('unavailable');
    expect(boundary.call).toHaveBeenCalledTimes(1);
  });
});
