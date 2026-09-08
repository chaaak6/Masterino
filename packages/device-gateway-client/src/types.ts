import type { ExecutionAccessRoot, ToolCallExecutionContext } from '@lobechat/types';

// ─── Device Info ───

/** A single live gateway WebSocket connection belonging to a device. */
export interface DeviceConnection {
  capabilities?: DeviceGatewayCapabilities;
  /** Freeform routing label, e.g. `desktop` / `desktop-dev` / `cli` / `cli-dev`. */
  channel?: string;
  connectedAt: number;
  /** Per-install random UUID — the gateway's stale-connection dedupe key. */
  connectionId: string;
  protocolVersion?: number;
}

/**
 * A device as surfaced by the gateway `/api/device/devices` endpoint. Keyed by
 * the stable `deviceId` (one entry per physical machine); the live WS sessions
 * are nested under `channels` so a single device can hold several at once
 * (e.g. desktop app + `lh connect` both connected).
 */
export interface GatewayDevice {
  channels: DeviceConnection[];
  /** Most recent channel's connect time. */
  connectedAt: number;
  deviceId: string;
  hostname: string;
  platform: string;
}

export interface DeviceSystemInfo {
  arch: string;
  desktopPath: string;
  documentsPath: string;
  downloadsPath: string;
  homePath: string;
  musicPath: string;
  picturesPath: string;
  userDataPath: string;
  videosPath: string;
  workingDirectory: string;
}

// ─── WebSocket Protocol Messages (mirrors the device-gateway service's types) ───

/**
 * Optional features negotiated during authentication. Absence always means
 * legacy/unknown; callers must not infer hard validation from a new server or
 * from the presence of an executionContext request alone.
 */
export interface DeviceGatewayCapabilities {
  executionContextValidation?: boolean;
}

export const CURRENT_DEVICE_GATEWAY_PROTOCOL_VERSION = 2;

// Client → Server
export interface AuthMessage {
  capabilities?: DeviceGatewayCapabilities;
  protocolVersion?: number;
  serverUrl?: string;
  token: string;
  tokenType?: 'apiKey' | 'jwt' | 'serviceToken';
  type: 'auth';
}

export interface HeartbeatMessage {
  type: 'heartbeat';
}

export interface ToolCallResponseMessage {
  requestId: string;
  result: {
    content: string;
    error?: string;
    state?: unknown;
    success: boolean;
  };
  type: 'tool_call_response';
}

export interface MessageApiResponseMessage {
  requestId: string;
  result: {
    content: string;
    error?: string;
    success: boolean;
  };
  type: 'message_api_response';
}

// Server → Client
export interface HeartbeatAckMessage {
  type: 'heartbeat_ack';
}

export interface AuthSuccessMessage {
  type: 'auth_success';
  /** User id derived from the verified credential by the gateway. */
  userId?: string;
}

export interface AuthFailedMessage {
  reason: string;
  type: 'auth_failed';
}

export interface AuthExpiredMessage {
  type: 'auth_expired';
}

/**
 * Stdio MCP connection params forwarded to the device for a tunneled MCP tool
 * call. The cloud server can't spawn the user's local MCP binary, so the
 * command/args/env travel to the device, which spawns and calls it locally.
 */
export interface GatewayMcpStdioParams {
  args: string[];
  command: string;
  env?: Record<string, string>;
  name: string;
  type: 'stdio';
}

/**
 * How the device should execute a tunneled tool call. Explicit so routing never
 * depends on structural sniffing (e.g. "does `params` exist?") — the gateway
 * relays every call over one `tool-call` channel, so the discriminator must be
 * a dedicated field, not the shape of the payload.
 *
 * `'tool'` is the generic builtin/local-system call; `'mcp'` is a tunneled
 * stdio MCP call. Open to future kinds (e.g. `'skill'`).
 */
export type GatewayToolCallType = 'tool' | 'mcp';

/**
 * Topic grants need their tuple on the untrusted device so it can independently
 * reject stale or misrouted grants. The base fields remain the frozen C0
 * ToolCallExecutionContext shape.
 */
export type GatewayExecutionAccessRoot = ExecutionAccessRoot & {
  deviceId?: string;
  expiresAt?: string;
  operationId?: string;
  topicId?: string;
};

export interface GatewayToolCallExecutionContext extends Omit<
  ToolCallExecutionContext,
  'accessRoots'
> {
  accessRoots?: GatewayExecutionAccessRoot[];
}

/** The existing desktop IPC call shape, shared with its main-process boundary. */
export interface LocalToolCallRequest {
  apiName: string;
  args: Record<string, unknown>;
  executionContext?: GatewayToolCallExecutionContext;
  purpose?: 'skill-command' | 'skill-script';
  trace?: Pick<ToolCallRequestMessage, 'deviceId' | 'operationId' | 'toolCallId' | 'topicId'>;
}

export interface ToolCallRequestMessage {
  /** Device identity repeated on the wire for topic-grant tuple verification. */
  deviceId?: string;
  /** Frozen, operation-scoped execution boundary. Omitted by legacy servers. */
  executionContext?: GatewayToolCallExecutionContext;
  /** Operation that triggered the call, propagated by the gateway for tracing. */
  operationId?: string;
  requestId: string;
  /** Per-call timeout (ms) the gateway forwards; clients pass it through. */
  timeout?: number;
  toolCall: {
    apiName: string;
    arguments: string;
    identifier: string;
    /** Stdio MCP connection params — present only when `type === 'mcp'`. */
    params?: GatewayMcpStdioParams;
    /**
     * Routing discriminator. `'mcp'` → the device's local MCP client (spawns
     * the stdio server); `'tool'` (or omitted, for back-compat with older
     * servers) → the builtin local-system tool switch.
     */
    type?: GatewayToolCallType;
  };
  /** Stable id of this model tool invocation, distinct from the relay request id. */
  toolCallId?: string;
  topicId?: string;
  type: 'tool_call_request';
}

export interface MessageApiRequestMessage {
  api: {
    apiName: string;
    payload: Record<string, unknown>;
    platform: string;
  };
  requestId: string;
  type: 'message_api_request';
}

// Server → Client
export interface SystemInfoRequestMessage {
  requestId: string;
  type: 'system_info_request';
}

// Client → Server
export interface SystemInfoResponseMessage {
  requestId: string;
  result: {
    success: boolean;
    systemInfo: DeviceSystemInfo;
  };
  type: 'system_info_response';
}

// ─── Generic device RPC (server-internal method forwarding) ───
// Unlike tool calls, RPCs are server-initiated operations the LLM never sees
// (e.g. workspace-init scans). The gateway relays them opaquely, correlating by
// `requestId`, so new device methods need no per-method gateway route — only a
// new entry in the device-side RPC dispatcher.

// Server → Client
export interface RpcRequestMessage {
  /** Name of the device-side method to invoke (e.g. `initWorkspace`). */
  method: string;
  /** JSON-serializable arguments for the method. */
  params?: unknown;
  requestId: string;
  /** Per-call timeout (ms) the gateway forwards; clients pass it through. */
  timeout?: number;
  type: 'rpc_request';
}

// Client → Server
export interface RpcResponseMessage {
  requestId: string;
  result: {
    /** Method return value, present when `success`. */
    data?: unknown;
    error?: string;
    success: boolean;
  };
  type: 'rpc_response';
}

/** Server → Client: request the desktop to spawn `lh hetero exec`. */
export interface AgentRunRequestMessage {
  agentType: string;
  cwd?: string;
  /** Server-resolved execution environment. Optional for legacy requests. */
  env?: Record<string, string>;
  /** Frozen operation authority. New devices prefer this over legacy cwd/env fields. */
  executionContext?: GatewayToolCallExecutionContext;
  /**
   * Image attachments from the user message, as URLs the device can fetch
   * (signed S3 URLs). Appended as image content blocks after the prompt so
   * the CLI gets vision input — mirrors the desktop local-mode
   * `sendPrompt(imageList)` path. Optional — omitted for older servers.
   */
  imageList?: Array<{ id?: string; url: string }>;
  jwt: string;
  /** Frozen chat-model reference; devices reject cross-operation reuse. */
  modelRef?: {
    capturedAt: string;
    kind: string;
    modelId: string;
    operationId: string;
    providerId: string;
  };
  operationId: string;
  prompt: string;
  resumeSessionId?: string;
  /** Workspace policy. Missing means the safe default `off`. */
  skillPolicy?: 'off' | 'project' | 'user';
  /** Frozen registry winners that have inline content and may be materialized for the CLI. */
  skills?: Array<{
    content?: string;
    description: string;
    identifier: string;
    key: string;
    name: string;
    source: string;
  }>;
  /**
   * Static context injected before the user prompt (workspace conventions,
   * conversation history on resume). The desktop sends it to `lh hetero exec`
   * as the first text block of a content-block array. Optional — omitted for
   * older servers that don't build a device-specific context.
   */
  systemContext?: string;
  topicId: string;
  type: 'agent_run_request';
}

/** Client → Server: acknowledgement for an agent_run_request. */
export interface AgentRunAckMessage {
  operationId: string;
  reason?: string;
  status: 'accepted' | 'rejected';
  type: 'agent_run_ack';
}

export type ClientMessage =
  | AgentRunAckMessage
  | AuthMessage
  | HeartbeatMessage
  | MessageApiResponseMessage
  | RpcResponseMessage
  | SystemInfoResponseMessage
  | ToolCallResponseMessage;
export type ServerMessage =
  | AgentRunRequestMessage
  | AuthExpiredMessage
  | AuthFailedMessage
  | AuthSuccessMessage
  | HeartbeatAckMessage
  | MessageApiRequestMessage
  | RpcRequestMessage
  | SystemInfoRequestMessage
  | ToolCallRequestMessage;

// ─── Client Types ───

export type ConnectionStatus =
  | 'authenticating'
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'reconnecting';

export type GatewayConnectErrorCode =
  | 'AUTH_FAILED'
  | 'HANDSHAKE_REJECTED'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'UNKNOWN';

export type GatewayConnectResult =
  | { success: true; userId?: string }
  | { code: GatewayConnectErrorCode; error: string; success: false };

export interface GatewayClientEvents {
  agent_run_request: (request: AgentRunRequestMessage) => void;
  auth_expired: () => void;
  auth_failed: (reason: string) => void;
  connected: (userId?: string) => void;
  disconnected: () => void;
  error: (error: Error) => void;
  heartbeat_ack: () => void;
  message_api_request: (request: MessageApiRequestMessage) => void;
  reconnecting: (delay: number) => void;
  rpc_request: (request: RpcRequestMessage) => void;
  status_changed: (status: ConnectionStatus) => void;
  system_info_request: (request: SystemInfoRequestMessage) => void;
  tool_call_request: (request: ToolCallRequestMessage) => void;
}
