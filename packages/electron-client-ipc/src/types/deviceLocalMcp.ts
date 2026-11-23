export interface DeviceLocalMcpConfig {
  args?: string[];
  command: string;
  env?: Record<string, string>;
}

export interface DeviceLocalMcpTool {
  description?: string;
  inputSchema: Record<string, unknown>;
  name: string;
}

/** Safe to expose to the renderer. Process settings stay in the main process. */
export interface DeviceLocalMcpServer {
  enabled: boolean;
  enabledTools: string[];
  identifier: string;
  name: string;
  tools: DeviceLocalMcpTool[];
}

export const isDeviceLocalMcpIdentifier = (identifier: string): boolean =>
  /^local-mcp-[0-9a-f]{24}$/.test(identifier);

export const deviceLocalMcpErrors = {
  account: 'DEVICE_LOCAL_MCP_AUTHENTICATED_ACCOUNT_REQUIRED',
  connection: 'DEVICE_LOCAL_MCP_CONNECTION',
  invalidConfig: 'DEVICE_LOCAL_MCP_INVALID_CONFIG',
  secureStorage: 'DEVICE_LOCAL_MCP_SECURE_STORAGE',
  serverUnavailable: 'DEVICE_LOCAL_MCP_SERVER_UNAVAILABLE',
  stopFailed: 'DEVICE_LOCAL_MCP_CANNOT_STOP_PROCESS',
  toolSelection: 'DEVICE_LOCAL_MCP_TOOL_SELECTION',
} as const;

export const DeviceLocalMcpSetupIdentifier = 'local-mcp-setup';
export const DeviceLocalMcpSetupApi = 'configure';
export type DeviceLocalMcpPreset = 'opencadstudio';

export interface DeviceLocalMcpDraft extends DeviceLocalMcpConfig {
  name: string;
}

export const isDeviceLocalMcpToolIdentifier = (identifier: string): boolean =>
  identifier === DeviceLocalMcpSetupIdentifier || isDeviceLocalMcpIdentifier(identifier);
