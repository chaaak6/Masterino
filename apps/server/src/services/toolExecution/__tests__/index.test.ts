// @vitest-environment node
import type { LobeToolManifest } from '@lobechat/context-engine';
import type { ChatToolPayload } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deviceGateway } from '@/server/services/deviceGateway';

import { ToolExecutionService } from '../index';

describe('ToolExecutionService', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('STDIO MCP in gateway deployments', () => {
    const identifier = 'local-cad';
    const payload: ChatToolPayload = {
      apiName: 'ocs_inspect',
      arguments: '{}',
      id: 'tool-call-1',
      identifier,
      type: 'mcp' as ChatToolPayload['type'],
    };
    const toolManifestMap = {
      [identifier]: {
        mcpParams: {
          args: ['--mcp'],
          command: '/path/on/the/workstation',
          name: identifier,
          type: 'stdio',
        },
      } as unknown as LobeToolManifest,
    };

    const setup = () => {
      vi.spyOn(deviceGateway, 'isConfigured', 'get').mockReturnValue(true);
      const executeMcpCall = vi
        .spyOn(deviceGateway, 'executeMcpCall')
        .mockResolvedValue({ content: 'Drawing is open', success: true });
      const callTool = vi.fn().mockResolvedValue('ran on backend');
      const service = new ToolExecutionService({
        builtinToolsExecutor: {} as any,
        mcpService: { callTool } as any,
      });
      return { callTool, executeMcpCall, service };
    };

    it('uses the selected device for STDIO calls', async () => {
      const { callTool, executeMcpCall, service } = setup();

      const result = await service.executeTool(payload, {
        activeDeviceId: 'cad-workstation',
        toolManifestMap,
        userId: 'user',
      });

      expect(result).toMatchObject({ content: 'Drawing is open', success: true });
      expect(executeMcpCall).toHaveBeenCalledWith(
        expect.objectContaining({
          apiName: 'ocs_inspect',
          deviceId: 'cad-workstation',
          userId: 'user',
        }),
        undefined,
      );
      expect(callTool).not.toHaveBeenCalled();
    });

    it('requires a device instead of running a local command on the server', async () => {
      const { callTool, executeMcpCall, service } = setup();

      const result = await service.executeTool(payload, { toolManifestMap, userId: 'user' });

      expect(result).toMatchObject({ error: { code: 'MCP_DEVICE_REQUIRED' }, success: false });
      expect(executeMcpCall).not.toHaveBeenCalled();
      expect(callTool).not.toHaveBeenCalled();
    });
  });

  it('can skip low-level result truncation for AgentRuntime archival', async () => {
    const builtinToolsExecutor = {
      execute: vi.fn().mockResolvedValue({
        content: '0123456789',
        success: true,
      }),
    };
    const service = new ToolExecutionService({
      builtinToolsExecutor: builtinToolsExecutor as any,
      mcpService: {} as any,
    });

    const result = await service.executeTool(
      {
        apiName: 'search',
        arguments: '{}',
        id: 'tool-call-1',
        identifier: 'lobe-web-browsing',
        type: 'builtin',
      },
      {
        skipResultTruncation: true,
        toolManifestMap: {},
        toolResultMaxLength: 5,
      },
    );

    expect(result.content).toBe('0123456789');
  });

  it('keeps existing low-level truncation by default', async () => {
    const builtinToolsExecutor = {
      execute: vi.fn().mockResolvedValue({
        content: '0123456789',
        success: true,
      }),
    };
    const service = new ToolExecutionService({
      builtinToolsExecutor: builtinToolsExecutor as any,
      mcpService: {} as any,
    });

    const result = await service.executeTool(
      {
        apiName: 'search',
        arguments: '{}',
        id: 'tool-call-1',
        identifier: 'lobe-web-browsing',
        type: 'builtin',
      },
      {
        toolManifestMap: {},
        toolResultMaxLength: 5,
      },
    );

    expect(result.content).toContain('01234');
    expect(result.content).toContain('Content truncated');
  });
});
