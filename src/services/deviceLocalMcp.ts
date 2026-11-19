import { isDesktop } from '@lobechat/const';
import type { DeviceLocalMcpServer } from '@lobechat/electron-client-ipc';
import type { ChatToolPayload, ExecutionContext, ToolManifest } from '@lobechat/types';

import { ensureElectronIpc } from '@/utils/electron/ipc';

const listDeviceLocalMcpServers = (
  executionContext: ExecutionContext | undefined,
  userId: string | undefined,
): Promise<DeviceLocalMcpServer[]> => {
  if (!isDesktop || executionContext?.plan.target !== 'local' || !userId)
    return Promise.resolve([]);
  return ensureElectronIpc().mcp.listDeviceLocalServers({ userId });
};

export const isKnownDeviceLocalMcpServer = async (
  identifier: string,
  executionContext: ExecutionContext,
  userId: string | undefined,
) =>
  (await listDeviceLocalMcpServers(executionContext, userId)).some(
    (server) => server.identifier === identifier,
  );

export const getDeviceLocalMcpManifests = async (
  executionContext: ExecutionContext | undefined,
  userId: string | undefined,
): Promise<ToolManifest[]> => {
  const servers = await listDeviceLocalMcpServers(executionContext, userId);
  return servers
    .filter(({ enabled, enabledTools }) => enabled && enabledTools.length > 0)
    .map(({ enabledTools, identifier, name, tools }) => ({
      api: tools
        .filter((tool) => enabledTools.includes(tool.name))
        .map(({ description, inputSchema, name }) => ({
          description: description ?? name,
          humanIntervention: 'required' as const,
          name,
          parameters: inputSchema,
        })),
      identifier,
      meta: { title: name },
      type: 'mcp',
    }));
};

export const callDeviceLocalMcp = async (
  payload: Pick<ChatToolPayload, 'apiName' | 'arguments' | 'identifier'>,
  executionContext: ExecutionContext | undefined,
  userId: string | undefined,
) => {
  if (!isDesktop || executionContext?.plan.target !== 'local' || !userId)
    throw new Error('This device-local MCP tool is unavailable in this session');

  return ensureElectronIpc().mcp.callDeviceLocalTool({
    args: payload.arguments,
    identifier: payload.identifier,
    toolName: payload.apiName,
    userId,
  });
};
