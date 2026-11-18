import { isDesktop } from '@lobechat/const';
import type { DeviceLocalMcpServer } from '@lobechat/electron-client-ipc';
import type { ChatToolPayload, ExecutionContext, ToolManifest } from '@lobechat/types';

import { ensureElectronIpc } from '@/utils/electron/ipc';

export const getDeviceLocalMcpManifests = async (
  executionContext: ExecutionContext | undefined,
  userId: string | undefined,
): Promise<ToolManifest[]> => {
  if (!isDesktop || executionContext?.plan.target !== 'local' || !userId) return [];
  const servers: DeviceLocalMcpServer[] = await ensureElectronIpc().mcp.listDeviceLocalServers({
    userId,
  });
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
