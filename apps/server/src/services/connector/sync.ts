import type { ConnectorModel, DecryptedConnector } from '@/database/models/connector';
import type { ConnectorToolModel } from '@/database/models/connectorTool';
import type { ConnectorCredentials } from '@/database/schemas';
import { ConnectorMcpConnectionType, ConnectorStatus } from '@/database/schemas';
import type { AuthConfig } from '@/libs/mcp';
import { inferCrudType } from '@/libs/mcp/utils';
import { mcpService } from '@/server/services/mcp';

import { ensureFreshConnectorToken } from './tokens';

export interface ConnectorToolSyncContext {
  connectorModel: ConnectorModel;
  connectorToolModel: ConnectorToolModel;
}

/** Build the MCP client connection params (with auth) from a connector row. */
export const buildConnectorMcpParams = (
  connector: DecryptedConnector,
): Parameters<typeof mcpService.listRawTools>[0] => {
  if (connector.mcpConnectionType === ConnectorMcpConnectionType.stdio) {
    if (!connector.mcpStdioConfig) throw new Error('Missing stdio config');
    return {
      args: connector.mcpStdioConfig.args ?? [],
      command: connector.mcpStdioConfig.command,
      env: connector.mcpStdioConfig.env,
      name: connector.name,
      type: 'stdio',
    };
  }
  if (!connector.mcpServerUrl) throw new Error('Connector has no MCP server URL configured');
  const { auth, headers } = buildHttpAuthFromCredentials(connector.credentials);
  return {
    auth,
    headers,
    name: connector.name,
    type: 'http',
    url: connector.mcpServerUrl,
  };
};

/**
 * Map stored credentials into the HTTP MCP client's auth config + custom headers.
 *
 * The MCP client only understands `bearer`/`oauth2` auth (both become an
 * `Authorization: Bearer …` header), so:
 * - bearer / apikey → bearer auth
 * - header          → passed through verbatim as request headers
 */
export const buildHttpAuthFromCredentials = (
  credentials: ConnectorCredentials | null,
): { auth?: AuthConfig; headers?: Record<string, string> } => {
  if (!credentials) return {};

  switch (credentials.type) {
    case 'oauth2': {
      return {
        auth: {
          accessToken: credentials.accessToken,
          clientId: undefined,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
          tokenExpiresAt: credentials.expiresAt,
          type: 'oauth2',
        },
      };
    }
    case 'bearer': {
      return { auth: { token: credentials.token, type: 'bearer' } };
    }
    case 'apikey': {
      return { auth: { token: credentials.apiKey, type: 'bearer' } };
    }
    case 'header': {
      return { headers: credentials.headers };
    }
    default: {
      return {};
    }
  }
};

/**
 * Connect to a connector's MCP server, fetch its tool list, and sync it into
 * `user_connector_tools`. Refreshes the OAuth token first when needed, and
 * updates the connector status (`connected` on success, `error` on failure).
 *
 * Shared by the `syncTools` tRPC mutation and the OAuth callback so a connector
 * has its tools immediately after authorization — no client round-trip needed.
 */
export const syncConnectorToolsById = async (
  connectorId: string,
  ctx: ConnectorToolSyncContext,
  localTools?: Array<{
    description?: string;
    inputSchema?: Record<string, unknown>;
    toolName: string;
  }>,
): Promise<{ toolCount: number }> => {
  let connector = await ctx.connectorModel.findById(connectorId);
  if (!connector) throw new Error('Connector not found');

  const isStdio = connector.mcpConnectionType === ConnectorMcpConnectionType.stdio;
  if (isStdio && !localTools)
    throw new Error('Sync STDIO tools from the desktop running the local MCP server');
  if (!isStdio && localTools) throw new Error('Only STDIO connectors accept local tools');
  if (!isStdio && !connector.mcpServerUrl)
    throw new Error('Connector has no MCP server URL configured');

  if (!localTools) {
    connector = await ensureFreshConnectorToken(connector, ctx.connectorModel);
    try {
      const rawTools = await mcpService.listRawTools(buildConnectorMcpParams(connector));
      localTools = rawTools.map(({ description, inputSchema, name }) => ({
        description,
        inputSchema,
        toolName: name,
      }));
    } catch (err) {
      await ctx.connectorModel.updateStatus(connectorId, ConnectorStatus.error);
      throw err;
    }
  }

  const syncInputs = localTools.map((tool) => ({
    ...tool,
    crudType: inferCrudType(tool.toolName),
  }));

  await ctx.connectorToolModel.upsertMany(connectorId, syncInputs);
  await ctx.connectorModel.updateStatus(connectorId, ConnectorStatus.connected);

  return { toolCount: syncInputs.length };
};
