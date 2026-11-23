import { CURRENT_VERSION, isDesktop } from '@lobechat/const';
import {
  DeviceLocalMcpSetupApi,
  DeviceLocalMcpSetupIdentifier,
  isDeviceLocalMcpIdentifier,
  isDeviceLocalMcpToolIdentifier,
} from '@lobechat/electron-client-ipc';
import {
  type ChatToolPayload,
  type CheckMcpInstallResult,
  type CustomPluginMetadata,
  type ExecutionContext,
} from '@lobechat/types';
import { isLocalOrPrivateUrl, safeParseJSON } from '@lobechat/utils';
import { type PluginManifest } from '@lobehub/market-sdk';
import { type CallReportRequest } from '@lobehub/market-types';
import superjson from 'superjson';

import { type MCPToolCallResult } from '@/libs/mcp';
import { toolsClient } from '@/libs/trpc/client';
import { ensureElectronIpc } from '@/utils/electron/ipc';

import { callDeviceLocalMcp, isKnownDeviceLocalMcpServer } from './deviceLocalMcp';
import { requestDeviceLocalMcpSetup } from './deviceLocalMcpSetup';
import { discoverService } from './discover';

/**
 * Calculate byte size of object
 * @param obj Object to calculate size of
 * @returns Byte size
 */
function calculateObjectSizeBytes(obj: any): number {
  try {
    const jsonString = JSON.stringify(obj);
    return new TextEncoder().encode(jsonString).length;
  } catch (error) {
    console.warn('Failed to calculate object size:', error);
    return 0;
  }
}

const getDeviceLocalMcpUserId = async () => {
  const { getUserStoreState } = await import('@/store/user/store');
  const { isSignedIn, user } = getUserStoreState();
  return isSignedIn ? user?.id : undefined;
};

class MCPService {
  private async configureDeviceLocalMcp(
    payload: ChatToolPayload,
    executionContext: ExecutionContext | undefined,
    signal?: AbortSignal,
  ) {
    if (payload.apiName !== DeviceLocalMcpSetupApi)
      throw new Error('Unknown local MCP setup action');
    const userId = await getDeviceLocalMcpUserId();
    return requestDeviceLocalMcpSetup(payload.arguments, executionContext, userId, signal);
  }

  async invokeMcpToolCall(
    payload: ChatToolPayload,
    {
      executionContext,
      signal,
      topicId,
    }: { executionContext?: ExecutionContext; signal?: AbortSignal; topicId?: string },
  ) {
    if (payload.source === 'client' && isDeviceLocalMcpToolIdentifier(payload.identifier)) {
      if (payload.identifier === DeviceLocalMcpSetupIdentifier)
        return this.configureDeviceLocalMcp(payload, executionContext, signal);
      const userId = await getDeviceLocalMcpUserId();
      return callDeviceLocalMcp(payload, executionContext, userId);
    }

    await discoverService.safeInjectMPToken();

    const { pluginSelectors } = await import('@/store/tool/selectors');
    const { getToolStoreState } = await import('@/store/tool/store');

    const s = getToolStoreState();
    const { identifier, arguments: args, apiName } = payload;

    const { connectorSelectors } = await import('@/store/tool/slices/connector');
    const connector = connectorSelectors.connectorByIdentifier(identifier)(s);

    const isStdioConnector = connector?.mcpConnectionType === 'stdio';
    if (isStdioConnector) {
      const tool = connector.tools?.find((item) => item.toolName === apiName);
      const hasActiveManifest = connector.isEnabled && Boolean(connector.tools?.length);
      if (tool?.permission === 'disabled' || (hasActiveManifest && !tool))
        throw new Error(`MCP tool "${apiName}" is unavailable for this connector`);

      if (hasActiveManifest) {
        signal?.throwIfAborted();
        const config = connector.mcpStdioConfig;
        if (!isDesktop || !config?.command || executionContext?.plan.target !== 'local')
          throw new Error('Start a run on this desktop with the local MCP server installed');

        return this.callStdioTool(
          {
            args: safeParseJSON(args) ?? {},
            env: config.env,
            params: { args: config.args, command: config.command, name: identifier, type: 'stdio' },
            toolName: apiName,
          },
          signal,
        );
      }
    }

    // HTTP connectors execute server-side with their stored credentials.
    if (!isStdioConnector && connector?.isEnabled && connector.mcpServerUrl) {
      const { lambdaClient } = await import('@/libs/trpc/client');
      return (await lambdaClient.connector.callTool.mutate(
        { args, identifier, toolName: apiName },
        { signal },
      )) as MCPToolCallResult;
    }

    const installPlugin = pluginSelectors.getInstalledPluginById(identifier)(s);
    const customPlugin = pluginSelectors.getCustomPluginById(identifier)(s);

    const plugin = installPlugin || customPlugin;

    if (!plugin) {
      if (isStdioConnector)
        throw new Error(`MCP tool "${apiName}" is unavailable for this connector`);

      // Older tool messages can arrive without the runtime source. Check the device registry only
      // after ruling out a regular connector or plugin using this identifier.
      if (isDesktop && executionContext?.plan.target === 'local') {
        if (!payload.source && identifier === DeviceLocalMcpSetupIdentifier)
          return this.configureDeviceLocalMcp(payload, executionContext, signal);
        if (isDeviceLocalMcpIdentifier(identifier)) {
          const userId = await getDeviceLocalMcpUserId();
          if (await isKnownDeviceLocalMcpServer(identifier, executionContext, userId))
            return callDeviceLocalMcp(payload, executionContext, userId);
        }
      }
      return;
    }

    const connection = plugin.customParams?.mcp;
    if (
      isStdioConnector &&
      connection?.type === 'stdio' &&
      (!isDesktop || executionContext?.plan.target !== 'local')
    )
      throw new Error('Start a run on this desktop with the local MCP server installed');
    const settingsEntries = plugin.settings
      ? Object.entries(plugin.settings as Record<string, any>).filter(
          ([, value]) => value !== undefined && value !== null,
        )
      : [];
    const pluginSettings =
      settingsEntries.length > 0
        ? settingsEntries.reduce<Record<string, unknown>>((acc, [key, value]) => {
            acc[key] = value;

            return acc;
          }, {})
        : undefined;

    const params = {
      ...connection,
      name: identifier,
    } as any;

    if (connection?.type === 'http') {
      params.headers = {
        ...connection.headers,
        ...pluginSettings,
      };
    }

    if (connection?.type === 'stdio') {
      params.env = {
        ...connection?.env,
        ...pluginSettings,
      };
    }

    const isStdio = plugin?.customParams?.mcp?.type === 'stdio';
    const isCloud = plugin?.customParams?.mcp?.type === 'cloud';
    const isCustomPlugin = !!customPlugin;

    // Build meta for server-side reporting
    const meta = {
      customPluginInfo: isCustomPlugin
        ? {
            avatar: plugin.manifest?.meta.avatar,
            description: plugin.manifest?.meta.description,
            name: plugin.manifest?.meta.title,
          }
        : undefined,
      isCustomPlugin,
      sessionId: topicId,
      version: plugin.manifest?.version || 'unknown',
    };

    const data = {
      // For desktop IPC, always pass a record/object for tool "arguments"
      // (IPC layer will superjson serialize the whole payload).
      args: isDesktop && isStdio ? (safeParseJSON(args) ?? {}) : args,
      env: connection?.type === 'stdio' ? params.env : (pluginSettings ?? connection?.env),
      meta,
      params,
      toolName: apiName,
    };

    // Record call start time
    const callStartTime = Date.now();
    let success = false;
    let errorCode: string | undefined;
    let errorMessage: string | undefined;
    let result: MCPToolCallResult | undefined;

    try {
      // For cloud type, call via cloud gateway
      if (isCloud) {
        // Parse args
        const apiParams = safeParseJSON(args) || {};

        // Call cloud gateway via tools market endpoint
        // Server will automatically get user access token from database
        // and format the result to MCPToolCallResult
        // Server-side also handles telemetry reporting
        result = await toolsClient.market.callCloudMcpEndpoint.mutate({
          apiParams,
          identifier,
          meta,
          toolName: apiName,
        });
      } else if (isDesktop && isStdio) {
        result = await this.callStdioTool(data, signal);
      } else {
        // For other types, use the toolsClient
        result = await toolsClient.mcp.callTool.mutate(data, { signal });
      }

      success = result.success;
      return result;
    } catch (error) {
      const err = error as Error;
      errorCode = 'CALL_FAILED';
      errorMessage = err.message;

      // Rethrow error, maintain original error handling logic
      throw error;
    } finally {
      // HTTP/SSE/streamable types: reporting is handled by server-side via mcp.callTool
      // Cloud type: reporting is handled by server-side via market.callCloudMcpEndpoint
      // Only report from frontend for stdio types (desktop only)
      if (isStdio) {
        const callEndTime = Date.now();
        const callDurationMs = callEndTime - callStartTime;

        // Calculate request size
        const inputParams = safeParseJSON(args) || args;
        const requestSizeBytes = calculateObjectSizeBytes(inputParams);
        // Calculate response size
        const responseSizeBytes = success && result ? calculateObjectSizeBytes(result.state) : 0;

        // Construct report data
        const reportData: CallReportRequest = {
          callDurationMs,
          customPluginInfo: meta.customPluginInfo,
          errorCode,
          errorMessage,
          identifier,
          isCustomPlugin,
          metadata: {
            appVersion: CURRENT_VERSION,
            command: plugin.customParams?.mcp?.command,
            mcpType: plugin.customParams?.mcp?.type,
          },
          methodName: apiName,
          methodType: 'tool' as const,
          requestSizeBytes,
          responseSizeBytes,
          sessionId: topicId,
          success,
          version: meta.version,
        };

        // Asynchronously report without affecting main flow
        discoverService.reportPluginCall(reportData).catch((reportError) => {
          console.warn('Failed to report MCP tool call:', reportError);
        });
      }
    }
  }

  async getStreamableMcpServerManifest(
    params: {
      auth?: {
        accessToken?: string;
        token?: string;
        type: 'none' | 'bearer' | 'oauth2';
      };
      headers?: Record<string, string>;
      identifier: string;
      metadata?: CustomPluginMetadata;
      url: string;
    },
    signal?: AbortSignal,
  ) {
    // If in Desktop mode and URL is local address, use IPC (main process)
    // This avoids accessing user local services through remote server in production
    if (isDesktop && isLocalOrPrivateUrl(params.url)) {
      // Note: IPC doesn't support AbortSignal yet
      const serialized = superjson.serialize(params);
      const serializedResult = await ensureElectronIpc().mcp.getStreamableMcpServerManifest(
        serialized as any,
      );
      return superjson.deserialize(serializedResult as any) as any;
    }

    // Otherwise use toolsClient (via server relay)
    return toolsClient.mcp.getStreamableMcpServerManifest.query(params, { signal });
  }

  private async callStdioTool(data: object, signal?: AbortSignal): Promise<MCPToolCallResult> {
    const serialized = superjson.serialize(data);
    const mcp = ensureElectronIpc().mcp;
    if (!signal) return superjson.deserialize((await mcp.callTool(serialized as any)) as any);

    signal.throwIfAborted();
    const requestId = crypto.randomUUID();
    const stopped = Promise.withResolvers<never>();
    const onAbort = () => {
      stopped.reject(signal.reason);
      // Older desktop builds accept the call but do not have the cancellation handler.
      void mcp.cancelStdioToolCall?.(requestId).catch(() => {});
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const result = await Promise.race([
        mcp.callTool(serialized as any, requestId),
        stopped.promise,
      ]);
      return superjson.deserialize(result as any);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  async getStdioMcpServerManifest(
    stdioParams: {
      args?: string[];
      command: string;
      env?: Record<string, string>;
      name: string;
    },
    metadata?: CustomPluginMetadata,
    _signal?: AbortSignal,
  ) {
    void _signal;
    // Note: IPC doesn't support AbortSignal yet
    const serialized = superjson.serialize({ ...stdioParams, metadata });
    const serializedResult = await ensureElectronIpc().mcp.getStdioMcpServerManifest(
      serialized as any,
    );
    return superjson.deserialize(serializedResult as any) as any;
  }

  /**
   * Check MCP plugin installation status
   * @param manifest MCP plugin manifest
   * @param signal AbortSignal for canceling request
   * @returns Installation check result
   */
  async checkInstallation(
    manifest: PluginManifest,
    _signal?: AbortSignal,
  ): Promise<CheckMcpInstallResult> {
    void _signal;
    // Pass all deployment options to main process for checking
    // Note: IPC doesn't support AbortSignal yet
    const serialized = superjson.serialize({
      deploymentOptions: manifest.deploymentOptions as any,
    });
    const serializedResult = await ensureElectronIpc().mcp.validMcpServerInstallable(
      serialized as any,
    );
    return superjson.deserialize(serializedResult as any) as any;
  }
}

export const mcpService = new MCPService();
