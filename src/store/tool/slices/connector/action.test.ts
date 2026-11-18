import { describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { mcpService } from '@/services/mcp';

import { ConnectorActionImpl } from './action';

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isDesktop: true,
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    connector: { list: { query: vi.fn() }, syncTools: { mutate: vi.fn() } },
  },
}));

vi.mock('@/services/mcp', () => ({
  mcpService: { getStdioMcpServerManifest: vi.fn() },
}));

describe('syncConnectorTools', () => {
  it('syncs the locally discovered tools for a desktop STDIO connector', async () => {
    const command = '/Applications/OpenCADStudio.app/Contents/MacOS/OpenCADStudio';
    const args = ['--mcp'];
    const getStore = () => ({
      connectors: [
        {
          id: 'cad-connector',
          identifier: 'opencadstudio-local',
          mcpConnectionType: 'stdio',
          mcpStdioConfig: { args, command },
        },
      ],
    });
    const action = new ConnectorActionImpl(vi.fn(), getStore as any);
    const parameters = { type: 'object' };
    vi.mocked(mcpService.getStdioMcpServerManifest).mockResolvedValue({
      api: [{ description: 'Inspect a drawing', name: 'ocs_inspect', parameters }],
    });
    vi.mocked(lambdaClient.connector.syncTools.mutate).mockImplementation(async (input) => {
      if (!('localTools' in input)) throw new Error('Failed to start MCP service process');
      return { toolCount: 1 };
    });

    await action.syncConnectorTools('cad-connector');

    expect(mcpService.getStdioMcpServerManifest).toHaveBeenCalledWith({
      args,
      command,
      name: 'opencadstudio-local',
    });
    expect(lambdaClient.connector.syncTools.mutate).toHaveBeenCalledWith({
      id: 'cad-connector',
      localTools: [
        { description: 'Inspect a drawing', inputSchema: parameters, toolName: 'ocs_inspect' },
      ],
    });
  });
});
