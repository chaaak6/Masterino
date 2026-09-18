import { randomUUID } from 'node:crypto';
import os from 'node:os';

import type {
  AgentRunRequestMessage,
  GatewayMcpStdioParams,
  MessageApiRequestMessage,
  RpcRequestMessage,
  SystemInfoRequestMessage,
  ToolCallRequestMessage,
  ToolCallResponseMessage,
} from '@lobechat/device-gateway-client';
import { GatewayClient } from '@lobechat/device-gateway-client';
import type { IdentitySource } from '@lobechat/device-identity';
import { deriveDeviceId } from '@lobechat/device-identity';
import type {
  GatewayConnectionError,
  GatewayConnectionErrorCode,
  GatewayConnectionState,
  GatewayConnectionStatus,
} from '@lobechat/electron-client-ipc';
import { app, powerSaveBlocker } from 'electron';

import { isDev } from '@/const/env';
import { getDesktopEnv } from '@/env';
import { resolveGatewayUrl } from '@/modules/gateway/configs';
import { createLogger } from '@/utils/logger';

import { ServiceModule } from './index';

const logger = createLogger('services:GatewayConnectionSrv');

// This is an implementation claim from the packaged Electron main process,
// not a copy of the server manifest. Bump an entry only when the matching
// controller path and local-file-shell implementation ship in this app.
const LOCAL_SYSTEM_API_VERSIONS = {
  createPresentation: 1,
  inspectPresentation: 1,
  renderPresentationPreview: 1,
  revisePresentation: 1,
  validatePresentation: 1,
} as const;

/**
 * Result envelope a tool-call handler must return. Mirrors
 * `BuiltinServerRuntimeOutput` so the renderer-side and remote-device paths
 * stay symmetric: `content` is the LLM-facing prompt text; `state` carries the
 * structured payload that downstream persists into `pluginState`.
 */
interface ToolCallResult {
  content: string;
  error?: unknown;
  state?: unknown;
  success: boolean;
}

interface MessageApiHandler {
  (platform: string, apiName: string, payload: Record<string, unknown>): Promise<unknown>;
}

interface ToolCallHandler {
  (
    apiName: string,
    args: unknown,
    request: Pick<
      ToolCallRequestMessage,
      'deviceId' | 'executionContext' | 'operationId' | 'requestId' | 'toolCallId' | 'topicId'
    >,
  ): Promise<ToolCallResult>;
}

/**
 * Handler for tunneled stdio MCP calls. Unlike {@link ToolCallHandler} (which
 * keys on `apiName` for builtin local-system tools), this carries the MCP
 * server identity + connection params so the device can spawn the local stdio
 * server and invoke the tool on it.
 */
interface McpCallHandler {
  (mcpCall: {
    apiName: string;
    arguments: string;
    identifier: string;
    params: GatewayMcpStdioParams;
  }): Promise<ToolCallResult>;
}

/**
 * Coerce a runtime error (which may be an Error, string, or `{ message }`
 * object) into the string shape the wire protocol expects. Returns undefined
 * when there's no error to transmit.
 */
const serializeWireError = (err: unknown): string | undefined => {
  if (err === undefined || err === null) return undefined;
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    return err.message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
};

interface AgentRunHandler {
  (request: AgentRunRequestMessage): Promise<{ reason?: string; status: 'accepted' | 'rejected' }>;
}

/**
 * Handler for generic server-internal device RPCs (e.g. workspace-init scans).
 * Dispatches by `method` name and returns the JSON-serializable result. Distinct
 * from {@link ToolCallHandler} — RPCs are never exposed to the agent.
 */
interface RpcHandler {
  (method: string, params: unknown): Promise<unknown>;
}

interface DeviceRegistrar {
  (info: {
    deviceId: string;
    hostname: string;
    identitySource: IdentitySource;
    platform: string;
  }): Promise<void>;
}

/**
 * GatewayConnectionService
 *
 * Core business logic for managing WebSocket connection to the cloud device-gateway.
 * Extracted from GatewayConnectionCtr so other controllers can reuse connect/disconnect.
 */
export default class GatewayConnectionService extends ServiceModule {
  private client: GatewayClient | null = null;
  private status: GatewayConnectionStatus = 'disconnected';
  private deviceId: string | null = null;
  private powerSaveBlockerId: number | null = null;
  private connectionError: GatewayConnectionError | undefined;
  private retryAt: number | undefined;
  private authRefreshAttempted = false;
  private authRecoveryPromise: Promise<void> | null = null;

  private identitySource: IdentitySource | null = null;

  private tokenProvider: (() => Promise<string | null>) | null = null;
  private serverUrlProvider: (() => Promise<string | null | undefined>) | null = null;
  private tokenRefresher: (() => Promise<{ error?: string; success: boolean }>) | null = null;
  private toolCallHandler: ToolCallHandler | null = null;
  private mcpCallHandler: McpCallHandler | null = null;
  private messageApiHandler: MessageApiHandler | null = null;
  private agentRunHandler: AgentRunHandler | null = null;
  private rpcHandler: RpcHandler | null = null;
  private deviceRegistrar: DeviceRegistrar | null = null;

  // ─── Configuration ───

  /**
   * Set token provider function (to decouple from RemoteServerConfigCtr)
   */
  setTokenProvider(provider: () => Promise<string | null>) {
    this.tokenProvider = provider;
  }

  /**
   * Set the application server URL provider. The central device gateway uses
   * this value to validate the token against the server the desktop is logged
   * into (for example masterino.bielcrystal.com).
   */
  setServerUrlProvider(provider: () => Promise<string | null | undefined>) {
    this.serverUrlProvider = provider;
  }

  /**
   * Set token refresher function (for auth_expired handling)
   */
  setTokenRefresher(refresher: () => Promise<{ error?: string; success: boolean }>) {
    this.tokenRefresher = refresher;
  }

  /**
   * Set tool call handler (to route tool calls to LocalFileCtr/ShellCommandCtr)
   */
  setToolCallHandler(handler: ToolCallHandler) {
    this.toolCallHandler = handler;
  }

  /**
   * Set the MCP call handler (routes tunneled stdio MCP calls to McpCtr, which
   * spawns the local stdio server). Distinct from the builtin tool-call handler.
   */
  setMcpCallHandler(handler: McpCallHandler) {
    this.mcpCallHandler = handler;
  }

  setMessageApiHandler(handler: MessageApiHandler) {
    this.messageApiHandler = handler;
  }

  /**
   * Set the generic device-RPC handler (routes server-internal method calls such
   * as workspace-init to the relevant controller). Distinct from the tool-call
   * handler — these are never surfaced to the agent.
   */
  setRpcHandler(handler: RpcHandler) {
    this.rpcHandler = handler;
  }

  setAgentRunHandler(handler: AgentRunHandler) {
    this.agentRunHandler = handler;
  }

  /**
   * Persist this device to the server's device registry. Called on every
   * connect once the userId is known (deviceId is user-scoped). Injected by the
   * controller, which owns the authed server URL + token.
   */
  setDeviceRegistrar(registrar: DeviceRegistrar) {
    this.deviceRegistrar = registrar;
  }

  // ─── Device ID ───

  /**
   * Ensure a stored fallback id exists. Pre-login this doubles as the device id
   * shown by `getDeviceInfo`; once a userId is available `resolveDeviceIdentity`
   * replaces it with a stable machine-derived id.
   */
  loadOrCreateDeviceId() {
    const stored = this.app.storeManager.get('gatewayDeviceId') as string | undefined;
    if (stored) {
      this.deviceId = stored;
    } else {
      this.deviceId = randomUUID();
      this.app.storeManager.set('gatewayDeviceId', this.deviceId);
    }
    logger.debug(`Device ID: ${this.deviceId}`);
  }

  /**
   * Derive the stable, user-scoped device id. Survives Masterino reinstalls
   * because it hashes the OS machine id; falls back to the stored random UUID
   * when the machine id is unavailable. Caches the result for this session.
   */
  resolveDeviceIdentity(userId: string): { deviceId: string; identitySource: IdentitySource } {
    const fallbackId = this.app.storeManager.get('gatewayDeviceId') as string | undefined;
    const identity = deriveDeviceId(userId, { fallbackId });
    this.deviceId = identity.deviceId;
    this.identitySource = identity.identitySource;
    return identity;
  }

  getDeviceId(): string {
    return this.deviceId || 'unknown';
  }

  /**
   * Connection routing key — the gateway's stale-socket dedupe key, decoupled
   * from the stable `deviceId`. Reuses the persisted random UUID (historically
   * `gatewayDeviceId`, now used purely as the connectionId) so a reconnect of
   * this install replaces only its own previous socket, while a co-running
   * `lh connect` on the same machine (same deviceId, different connectionId)
   * stays connected.
   */
  getConnectionId(): string {
    let id = this.app.storeManager.get('gatewayDeviceId') as string | undefined;
    if (!id) {
      id = randomUUID();
      this.app.storeManager.set('gatewayDeviceId', id);
    }
    return id;
  }

  // ─── Connection Status ───

  getStatus(): GatewayConnectionStatus {
    return this.status;
  }

  getState(): GatewayConnectionState {
    return {
      enabled: Boolean(this.app.storeManager.get('gatewayEnabled')),
      error: this.connectionError,
      retryAt: this.retryAt,
      status: this.status,
    };
  }

  getDeviceInfo() {
    return {
      description: this.getDeviceDescription(),
      deviceId: this.getDeviceId(),
      hostname: os.hostname(),
      name: this.getDeviceName(),
      platform: process.platform,
    };
  }

  // ─── Device Name & Description ───

  getDeviceName(): string {
    return (this.app.storeManager.get('gatewayDeviceName') as string) || os.hostname();
  }

  setDeviceName(name: string) {
    this.app.storeManager.set('gatewayDeviceName', name);
  }

  getDeviceDescription(): string {
    return (this.app.storeManager.get('gatewayDeviceDescription') as string) || '';
  }

  setDeviceDescription(description: string) {
    this.app.storeManager.set('gatewayDeviceDescription', description);
  }

  // ─── Connection Logic ───

  async connect(): Promise<{ error?: string; success: boolean }> {
    if (this.status === 'connected' || this.status === 'connecting') {
      return { success: true };
    }
    this.authRefreshAttempted = false;
    this.setConnectionError(undefined);
    return this.doConnect();
  }

  async disconnect(): Promise<{ success: boolean }> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
    this.retryAt = undefined;
    this.setConnectionError(undefined);
    this.setStatus('disconnected');
    return { success: true };
  }

  private async doConnect(
    verifiedUserId?: string,
    identityRetry = false,
  ): Promise<{ error?: string; success: boolean }> {
    // Clean up any existing client
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }

    if (!this.tokenProvider) {
      logger.warn('Cannot connect: no token provider configured');
      this.failConnection('CONFIG_MISSING', 'No token provider configured', false);
      return { error: 'No token provider configured', success: false };
    }

    if (!this.serverUrlProvider) {
      logger.warn('Cannot connect: no server URL provider configured');
      this.failConnection('CONFIG_MISSING', 'No server URL provider configured', false);
      return { error: 'No server URL provider configured', success: false };
    }

    const [token, serverUrl] = await Promise.all([this.tokenProvider(), this.serverUrlProvider()]);
    if (!token) {
      logger.warn('Cannot connect: no access token');
      this.failConnection('AUTH_REQUIRED', 'No access token available', false);
      return { error: 'No access token available', success: false };
    }
    if (!serverUrl) {
      logger.warn('Cannot connect: no remote server URL');
      this.failConnection('CONFIG_MISSING', 'No remote server URL available', false);
      return { error: 'No remote server URL available', success: false };
    }

    const gatewayUrl = this.getGatewayUrl();
    const userId = verifiedUserId || this.extractUserIdFromToken(token);
    logger.info(
      `Connecting to device gateway: ${gatewayUrl}, identityAvailable: ${Boolean(userId)}`,
    );

    // Resolve the stable user-scoped id before opening the socket when the JWT
    // subject is available. The gateway still verifies the subject and owns routing.
    if (userId) {
      this.resolveDeviceIdentity(userId);
    }

    const client = new GatewayClient({
      capabilities: {
        executionContextValidation: true,
        localSystemApiVersions: LOCAL_SYSTEM_API_VERSIONS,
      },
      channel: isDev ? 'desktop-dev' : 'desktop',
      connectionId: this.getConnectionId(),
      deviceId: this.getDeviceId(),
      gatewayUrl,
      logger,
      serverUrl,
      token,
      userId: userId || undefined,
    });

    this.setupClientEvents(client);
    this.client = client;

    let initialConnectPending = true;
    let expectedAuthenticatedUserId = userId || undefined;
    client.on('connected', (reauthenticatedUserId) => {
      if (initialConnectPending) return;
      void this.handleReauthenticatedClient(
        client,
        reauthenticatedUserId,
        expectedAuthenticatedUserId,
        identityRetry,
      );
    });

    const result = await client.connect();
    initialConnectPending = false;
    if ('code' in result) {
      this.setConnectionError({
        code: result.code,
        message: result.error,
        retriable: result.code !== 'AUTH_FAILED',
      });
      return { error: result.error, success: false };
    }

    const authenticatedUserId = result.userId || userId;
    expectedAuthenticatedUserId = authenticatedUserId || undefined;
    if (result.userId && userId && result.userId !== userId) {
      await client.disconnect();
      this.failConnection('AUTH_FAILED', 'Authenticated user does not match token subject', false);
      return { error: 'Authenticated user does not match token subject', success: false };
    }

    // A legacy token may not be locally decodable even though the gateway can
    // verify it. Reconnect once with the verified identity so deviceId remains
    // stable and the live socket matches the registered device row.
    if (!userId && authenticatedUserId && !identityRetry) {
      await client.disconnect();
      if (this.client === client) this.client = null;
      return this.doConnect(authenticatedUserId, true);
    }

    if (authenticatedUserId) {
      const identity = this.resolveDeviceIdentity(authenticatedUserId);
      await this.deviceRegistrar?.({
        deviceId: identity.deviceId,
        hostname: os.hostname(),
        identitySource: identity.identitySource,
        platform: process.platform,
      }).catch((err) => {
        logger.warn(`Device registration failed (non-fatal): ${(err as Error).message}`);
      });
    }

    this.authRefreshAttempted = false;
    this.retryAt = undefined;
    this.setConnectionError(undefined);
    return { success: true };
  }

  private async handleReauthenticatedClient(
    client: GatewayClient,
    authenticatedUserId: string | undefined,
    expectedUserId: string | undefined,
    identityRetry: boolean,
  ) {
    if (client !== this.client) return;
    if (!authenticatedUserId) {
      logger.warn('Gateway auth_success did not include a verified user id');
      return;
    }
    if (expectedUserId && authenticatedUserId !== expectedUserId) {
      await client.disconnect();
      this.failConnection('AUTH_FAILED', 'Authenticated user does not match token subject', false);
      return;
    }

    const identity = this.resolveDeviceIdentity(authenticatedUserId);
    if (identity.deviceId !== client.currentDeviceId) {
      await client.disconnect();
      if (this.client === client) this.client = null;
      if (identityRetry) {
        this.failConnection('AUTH_FAILED', 'Authenticated device identity changed', false);
        return;
      }
      await this.doConnect(authenticatedUserId, true);
      return;
    }

    await this.deviceRegistrar?.({
      deviceId: identity.deviceId,
      hostname: os.hostname(),
      identitySource: identity.identitySource,
      platform: process.platform,
    }).catch((err) => {
      logger.warn(
        `Device registration failed after reconnect (non-fatal): ${(err as Error).message}`,
      );
    });
    this.authRefreshAttempted = false;
    this.retryAt = undefined;
    this.setConnectionError(undefined);
  }

  private setupClientEvents(client: GatewayClient) {
    client.on('status_changed', (status) => {
      this.setStatus(status);
      if (status === 'connected') {
        this.retryAt = undefined;
        this.setConnectionError(undefined);
      }
    });

    client.on('reconnecting', (delay) => {
      this.retryAt = Date.now() + delay;
      this.setConnectionError({
        code: 'NETWORK',
        message: 'Connection interrupted',
        retriable: true,
      });
    });

    client.on('auth_failed', (reason) => {
      this.recoverAuthentication(client, reason);
    });

    client.on('tool_call_request', (request) => {
      this.handleToolCallRequest(request, client);
    });

    client.on('message_api_request', (request) => {
      this.handleMessageApiRequest(request, client);
    });

    client.on('system_info_request', (request) => {
      this.handleSystemInfoRequest(client, request);
    });

    client.on('rpc_request', (request) => {
      this.handleRpcRequest(client, request);
    });

    client.on('agent_run_request', (request) => {
      this.handleAgentRunRequest(client, request);
    });

    client.on('auth_expired', () => {
      logger.warn('Received auth_expired, will reconnect with refreshed token');
      this.handleAuthExpired();
    });

    client.on('error', (error) => {
      logger.error('WebSocket error:', error.message);
      const code: GatewayConnectionErrorCode =
        /unexpected server response|status code|handshake/i.test(error.message)
          ? 'HANDSHAKE_REJECTED'
          : 'NETWORK';
      this.setConnectionError({ code, message: error.message, retriable: true });
    });
  }

  private recoverAuthentication(client: GatewayClient, reason: string) {
    if (client !== this.client || this.authRecoveryPromise) return;

    this.authRecoveryPromise = (async () => {
      if (this.authRefreshAttempted || !this.tokenRefresher) {
        this.failConnection('AUTH_REQUIRED', reason, false);
        return;
      }

      this.authRefreshAttempted = true;
      this.setConnectionError({ code: 'AUTH_FAILED', message: reason, retriable: true });
      const refreshResult = await this.tokenRefresher();
      if (!refreshResult.success) {
        this.failConnection('AUTH_REQUIRED', refreshResult.error || reason, false);
        return;
      }
      if (!this.app.storeManager.get('gatewayEnabled')) return;
      const reconnectResult = await this.doConnect();
      if (!reconnectResult.success) {
        this.failConnection('AUTH_REQUIRED', reconnectResult.error || reason, false);
      }
    })().finally(() => {
      this.authRecoveryPromise = null;
    });
  }

  // ─── Auth Expired Handling ───

  private async handleAuthExpired() {
    // Disconnect the current client
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }

    if (!this.tokenRefresher) {
      logger.error('No token refresher configured, cannot handle auth_expired');
      this.failConnection('AUTH_REQUIRED', 'No token refresher configured', false);
      return;
    }

    logger.info('Attempting token refresh before reconnect');
    const result = await this.tokenRefresher();

    if (result.success) {
      logger.info('Token refreshed, reconnecting');
      await this.doConnect();
    } else {
      logger.error('Token refresh failed:', result.error);
      this.failConnection('AUTH_REQUIRED', result.error || 'Token refresh failed', false);
    }
  }

  // ─── System Info ───

  private handleSystemInfoRequest(client: GatewayClient, request: SystemInfoRequestMessage) {
    logger.info(`Received system_info_request: requestId=${request.requestId}`);
    client.sendSystemInfoResponse({
      requestId: request.requestId,
      result: {
        success: true,
        systemInfo: {
          arch: os.arch(),
          desktopPath: app.getPath('desktop'),
          documentsPath: app.getPath('documents'),
          downloadsPath: app.getPath('downloads'),
          homePath: app.getPath('home'),
          musicPath: app.getPath('music'),
          picturesPath: app.getPath('pictures'),
          userDataPath: app.getPath('userData'),
          videosPath: app.getPath('videos'),
          workingDirectory: process.cwd(),
        },
      },
    });
  }

  // ─── Generic Device RPC ───

  private async handleRpcRequest(client: GatewayClient, request: RpcRequestMessage) {
    const { method, params, requestId } = request;
    logger.info(`Received rpc_request: method=${method}, requestId=${requestId}`);

    if (!this.rpcHandler) {
      client.sendRpcResponse({
        requestId,
        result: { error: 'No RPC handler registered', success: false },
      });
      return;
    }

    try {
      const data = await this.rpcHandler(method, params);
      client.sendRpcResponse({ requestId, result: { data, success: true } });
    } catch (error) {
      logger.error(`rpc_request method=${method} failed:`, serializeWireError(error));
      client.sendRpcResponse({
        requestId,
        result: { error: serializeWireError(error), success: false },
      });
    }
  }

  // ─── Agent Run ───

  private handleAgentRunRequest = async (
    client: GatewayClient,
    request: AgentRunRequestMessage,
  ) => {
    logger.info(
      `Received agent_run_request: operationId=${request.operationId} type=${request.agentType}`,
    );

    if (!this.agentRunHandler) {
      logger.warn('No agent run handler configured, rejecting request');
      client.sendAgentRunAck({
        operationId: request.operationId,
        reason: 'no handler',
        status: 'rejected',
      });
      return;
    }

    const result = await this.agentRunHandler(request);
    client.sendAgentRunAck({ operationId: request.operationId, ...result });
  };

  // ─── Tool Call Routing ───

  private handleToolCallRequest = async (
    request: ToolCallRequestMessage,
    client: GatewayClient,
  ) => {
    const { requestId, toolCall } = request;
    const { apiName, arguments: argsStr, identifier, params, type } = toolCall;

    logger.info(
      `Received tool call: apiName=${apiName}, requestId=${requestId}, type=${type ?? 'tool'}`,
    );

    try {
      let result: ToolCallResult;

      if (type === 'mcp') {
        // Tunneled stdio MCP call: route to the local MCP client (spawns the
        // stdio server). Routing is driven by the explicit `type` discriminator,
        // not by sniffing the payload — the builtin local-system tool switch
        // keys on `apiName` and has no MCP server context.
        if (!this.mcpCallHandler) {
          throw new Error('No MCP call handler configured');
        }
        if (!params) {
          throw new Error('MCP tool call missing connection params');
        }
        result = await this.mcpCallHandler({ apiName, arguments: argsStr, identifier, params });
      } else {
        if (!this.toolCallHandler) {
          throw new Error('No tool call handler configured');
        }
        const args = JSON.parse(argsStr);
        result = await this.toolCallHandler(apiName, args, {
          deviceId: request.deviceId ?? this.deviceId ?? undefined,
          executionContext: request.executionContext,
          operationId: request.operationId,
          requestId,
          toolCallId: request.toolCallId,
          topicId: request.topicId,
        });
      }

      // Forward the typed envelope unchanged. Critically, do NOT stringify the
      // whole result into `content` — that would bury the structured payload
      // inside a JSON blob and lose `state`. The wire protocol carries each
      // field separately so downstream (`DeviceGateway` → `RuntimeExecutors`)
      // can persist `state` to `pluginState`. Optional fields are only set
      // when present so payloads stay minimal.
      const wireResult: ToolCallResponseMessage['result'] = {
        content: result.content,
        success: result.success,
      };
      const wireError = serializeWireError(result.error);
      if (wireError !== undefined) wireResult.error = wireError;
      if (result.state !== undefined) wireResult.state = result.state;

      client.sendToolCallResponse({ requestId, result: wireResult });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Tool call failed: apiName=${apiName}, error=${errorMsg}`);

      client.sendToolCallResponse({
        requestId,
        result: {
          content: errorMsg,
          error: errorMsg,
          success: false,
        },
      });
    }
  };

  // ─── Message API Routing ───

  private handleMessageApiRequest = async (
    request: MessageApiRequestMessage,
    client: GatewayClient,
  ) => {
    const { requestId, api } = request;
    const { apiName, payload, platform } = api;

    logger.info(
      `Received message API request: platform=${platform}, apiName=${apiName}, requestId=${requestId}`,
    );

    try {
      if (!this.messageApiHandler) {
        throw new Error('No message API handler configured');
      }

      const result = await this.messageApiHandler(platform, apiName, payload);

      client.sendMessageApiResponse({
        requestId,
        result: {
          content: typeof result === 'string' ? result : JSON.stringify(result),
          success: true,
        },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(
        `Message API request failed: platform=${platform}, apiName=${apiName}, error=${errorMsg}`,
      );

      client.sendMessageApiResponse({
        requestId,
        result: {
          content: errorMsg,
          error: errorMsg,
          success: false,
        },
      });
    }
  };

  // ─── Power Save Blocker ───

  /**
   * Start power save blocker to prevent macOS App Nap from suspending the process
   * while the gateway connection is active. Uses 'prevent-app-suspension' so the
   * display can still sleep — only the app process is kept alive.
   */
  private startPowerSaveBlocker() {
    if (this.powerSaveBlockerId !== null) return;
    this.powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    logger.info(`Power save blocker started (id=${this.powerSaveBlockerId})`);
  }

  private stopPowerSaveBlocker() {
    if (this.powerSaveBlockerId === null) return;
    powerSaveBlocker.stop(this.powerSaveBlockerId);
    logger.info(`Power save blocker stopped (id=${this.powerSaveBlockerId})`);
    this.powerSaveBlockerId = null;
  }

  // ─── Status Broadcasting ───

  private setStatus(status: GatewayConnectionStatus) {
    if (this.status === status) {
      this.broadcastState();
      return;
    }

    logger.info(`Connection status: ${this.status} → ${status}`);
    this.status = status;

    // Keep the app process alive while gateway is connected so macOS App Nap
    // does not suspend it during display sleep, which would drop the WebSocket.
    if (status === 'connected') {
      this.startPowerSaveBlocker();
    } else {
      this.stopPowerSaveBlocker();
    }

    this.broadcastState();
  }

  private setConnectionError(error: GatewayConnectionError | undefined) {
    this.connectionError = error;
    this.broadcastState();
  }

  private failConnection(code: GatewayConnectionErrorCode, message: string, retriable: boolean) {
    this.connectionError = { code, message, retriable };
    this.retryAt = undefined;
    this.setStatus('disconnected');
  }

  private broadcastState() {
    this.app.browserManager.broadcastToAllWindows(
      'gatewayConnectionStatusChanged',
      this.getState(),
    );
  }

  // ─── Gateway URL ───

  private getGatewayUrl(): string {
    return resolveGatewayUrl({
      envUrl: getDesktopEnv().DEVICE_GATEWAY_URL,
      storedUrl: this.app.storeManager.get('gatewayUrl'),
    });
  }

  // ─── Token Helpers ───

  /**
   * Extract userId (sub claim) from JWT without verification.
   * The token will be verified server-side; this local hint is used only to
   * derive the stable device id before authentication completes.
   */
  private extractUserIdFromToken(token: string): string | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      return payload.sub || null;
    } catch {
      logger.warn('Failed to extract userId from JWT token');
      return null;
    }
  }
}
