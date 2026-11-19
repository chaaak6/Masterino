import { isDesktop } from '@lobechat/const';
import {
  DeviceLocalMcpSetupApi,
  DeviceLocalMcpSetupIdentifier,
} from '@lobechat/electron-client-ipc';
import type { ExecutionContext, ToolManifest } from '@lobechat/types';
import { z } from 'zod';

import { ensureElectronIpc } from '@/utils/electron/ipc';

const presets = ['opencadstudio', 'custom'] as const;
const setupSchema = z.object({ preset: z.enum(presets) }).strict();

const setupManifest: ToolManifest = {
  api: [
    {
      defaultTimeoutMs: 300_000,
      description:
        'Open the device-only setup dialog when the user asks to set up a local MCP server. Select opencadstudio for OpenCADStudio or custom for other local programs. The user reviews the local configuration and selects tools in the dialog. On success, the tools are available on the next message in this conversation.',
      name: DeviceLocalMcpSetupApi,
      parameters: {
        additionalProperties: false,
        properties: { preset: { enum: [...presets], type: 'string' } },
        required: ['preset'],
        type: 'object',
      },
    },
  ],
  identifier: DeviceLocalMcpSetupIdentifier,
  meta: { title: 'Set up local MCP' },
  type: 'mcp',
};

export const getDeviceLocalMcpSetupManifest = (
  executionContext: ExecutionContext | undefined,
  userId: string | undefined,
) => (isDesktop && executionContext?.plan.target === 'local' && userId ? setupManifest : undefined);

export const requestDeviceLocalMcpSetup = async (
  args: string,
  executionContext: ExecutionContext | undefined,
  userId: string | undefined,
  signal?: AbortSignal,
) => {
  if (!userId || !getDeviceLocalMcpSetupManifest(executionContext, userId))
    throw new Error('Local MCP setup is unavailable in this session');

  let parsed: z.infer<typeof setupSchema>;
  try {
    parsed = setupSchema.parse(JSON.parse(args));
  } catch {
    throw new Error('Select a supported local MCP setup preset');
  }

  const draft =
    parsed.preset === 'opencadstudio'
      ? await ensureElectronIpc().mcp.resolveDeviceLocalMcpPreset(parsed.preset)
      : undefined;

  const { openDeviceLocalMcpSetup } =
    await import('@/features/SkillStore/SkillList/openDeviceLocalMcpSetup');
  const server = await openDeviceLocalMcpSetup(draft, signal, userId);

  if (!server) {
    return {
      content: 'The local MCP setup was closed before a connection was saved.',
      state: { status: 'cancelled' },
      success: true,
    };
  }

  const receipt = {
    identifier: server.identifier,
    name: server.name,
    status: 'configured',
    tools: server.enabledTools,
  };
  return {
    content: `Local MCP saved on this device. Only the tools listed in this receipt were enabled. They are available on the next message in this conversation. ${JSON.stringify(receipt)}`,
    state: receipt,
    success: true,
  };
};
