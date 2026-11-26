import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DecryptedConnector } from '@/database/models/connector';
import { type ConnectorCredentials, ConnectorStatus } from '@/database/schemas';
import { mcpService } from '@/server/services/mcp';

import {
  buildConnectorMcpParams,
  buildHttpAuthFromCredentials,
  type ConnectorToolSyncContext,
  syncConnectorToolsById,
} from './sync';

const httpConnector = (credentials: ConnectorCredentials | null): DecryptedConnector =>
  ({
    credentials,
    id: 'c1',
    identifier: 'my-conn',
    isEnabled: true,
    mcpConnectionType: 'http',
    mcpServerUrl: 'https://mcp.example.com',
    mcpStdioConfig: null,
    name: 'My Connector',
    oidcConfig: null,
  }) as any;

describe('syncConnectorToolsById', () => {
  afterEach(() => vi.restoreAllMocks());

  const setup = (connector: DecryptedConnector) => {
    const findById = vi.fn().mockResolvedValue(connector);
    const updateStatus = vi.fn().mockResolvedValue(undefined);
    const upsertMany = vi.fn().mockResolvedValue(undefined);
    const context = {
      connectorModel: { findById, updateStatus },
      connectorToolModel: { upsertMany },
    };
    const listRawTools = vi.spyOn(mcpService, 'listRawTools').mockResolvedValue([]);
    return {
      context: context as unknown as ConnectorToolSyncContext,
      listRawTools,
      updateStatus,
      upsertMany,
    };
  };

  const localConnector: DecryptedConnector = {
    ...httpConnector(null),
    mcpConnectionType: 'stdio',
    mcpServerUrl: null,
    mcpStdioConfig: { args: ['--mcp'], command: '/path/on/the/workstation' },
  };
  const localTools = [{ inputSchema: { type: 'object' }, toolName: 'get_drawing' }];

  it.each([{ tools: [] }, { tools: [{ toolName: 'get_drawing' }] }])(
    'keeps saved permissions when local discovery has no usable schemas (%j)',
    async ({ tools }) => {
      const { context, listRawTools, updateStatus, upsertMany } = setup(localConnector);
      await expect(syncConnectorToolsById(localConnector.id, context, tools)).rejects.toThrow(
        'did not provide usable tool schemas',
      );
      expect(listRawTools).not.toHaveBeenCalled();
      expect(upsertMany).not.toHaveBeenCalled();
      expect(updateStatus).toHaveBeenCalledWith(localConnector.id, ConnectorStatus.error);
    },
  );

  it('stores desktop-discovered tools without spawning the workstation command on the server', async () => {
    const { context, listRawTools, updateStatus, upsertMany } = setup(localConnector);

    await expect(syncConnectorToolsById('c1', context, localTools)).resolves.toEqual({
      toolCount: 1,
    });
    expect(upsertMany).toHaveBeenCalledWith('c1', [{ ...localTools[0], crudType: 'read' }]);
    expect(updateStatus).toHaveBeenCalledWith('c1', 'connected');
    expect(listRawTools).not.toHaveBeenCalled();
  });

  it('rejects server-side discovery for STDIO when no local manifest was supplied', async () => {
    const { context, listRawTools, upsertMany } = setup(localConnector);

    await expect(syncConnectorToolsById('c1', context)).rejects.toThrow(
      'Sync STDIO tools from the desktop',
    );
    expect(listRawTools).not.toHaveBeenCalled();
    expect(upsertMany).not.toHaveBeenCalled();
  });

  it('only allows HTTP tool schemas obtained from the remote MCP endpoint', async () => {
    const { context, listRawTools, upsertMany } = setup(httpConnector(null));

    await expect(syncConnectorToolsById('c1', context, localTools)).rejects.toThrow('Only STDIO');
    expect(upsertMany).not.toHaveBeenCalled();
    await syncConnectorToolsById('c1', context);
    expect(listRawTools).toHaveBeenCalledWith(expect.objectContaining({ type: 'http' }));
  });
});

describe('buildHttpAuthFromCredentials', () => {
  it('returns nothing for no credentials (no-auth)', () => {
    expect(buildHttpAuthFromCredentials(null)).toEqual({});
  });

  it('maps oauth2 to bearer auth with refresh metadata', () => {
    const result = buildHttpAuthFromCredentials({
      accessToken: 'access',
      clientSecret: 'secret',
      expiresAt: 123,
      refreshToken: 'refresh',
      type: 'oauth2',
    });

    expect(result).toEqual({
      auth: {
        accessToken: 'access',
        clientId: undefined,
        clientSecret: 'secret',
        refreshToken: 'refresh',
        tokenExpiresAt: 123,
        type: 'oauth2',
      },
    });
    expect(result.headers).toBeUndefined();
  });

  it('maps a bearer token to bearer auth', () => {
    expect(buildHttpAuthFromCredentials({ token: 'tok', type: 'bearer' })).toEqual({
      auth: { token: 'tok', type: 'bearer' },
    });
  });

  it('maps an api key to bearer auth (Authorization header)', () => {
    expect(buildHttpAuthFromCredentials({ apiKey: 'key-123', type: 'apikey' })).toEqual({
      auth: { token: 'key-123', type: 'bearer' },
    });
  });

  it('passes custom headers through verbatim with no auth', () => {
    const result = buildHttpAuthFromCredentials({
      headers: { 'X-Api-Key': 'abc', 'X-Tenant': 't1' },
      type: 'header',
    });

    expect(result).toEqual({ headers: { 'X-Api-Key': 'abc', 'X-Tenant': 't1' } });
    expect(result.auth).toBeUndefined();
  });
});

describe('buildConnectorMcpParams', () => {
  it('builds http params with bearer auth', () => {
    expect(buildConnectorMcpParams(httpConnector({ token: 'tok', type: 'bearer' }))).toEqual({
      auth: { token: 'tok', type: 'bearer' },
      headers: undefined,
      name: 'My Connector',
      type: 'http',
      url: 'https://mcp.example.com',
    });
  });

  it('builds http params with custom headers and no auth', () => {
    expect(
      buildConnectorMcpParams(
        httpConnector({ headers: { Authorization: 'Token x' }, type: 'header' }),
      ),
    ).toEqual({
      auth: undefined,
      headers: { Authorization: 'Token x' },
      name: 'My Connector',
      type: 'http',
      url: 'https://mcp.example.com',
    });
  });

  it('builds http params with no auth when credentials are absent', () => {
    expect(buildConnectorMcpParams(httpConnector(null))).toEqual({
      auth: undefined,
      headers: undefined,
      name: 'My Connector',
      type: 'http',
      url: 'https://mcp.example.com',
    });
  });

  it('builds stdio params from stdio config', () => {
    const connector = {
      credentials: null,
      identifier: 'local-conn',
      mcpConnectionType: 'stdio',
      mcpServerUrl: null,
      mcpStdioConfig: { args: ['serve'], command: 'my-mcp', env: { FOO: 'bar' } },
      name: 'Local Connector',
    } as any;

    expect(buildConnectorMcpParams(connector)).toEqual({
      args: ['serve'],
      command: 'my-mcp',
      env: { FOO: 'bar' },
      name: 'Local Connector',
      type: 'stdio',
    });
  });
});
