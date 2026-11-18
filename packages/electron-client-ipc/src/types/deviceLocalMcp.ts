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
