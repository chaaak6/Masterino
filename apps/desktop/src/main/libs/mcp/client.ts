import type { Readable } from 'node:stream';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Progress } from '@modelcontextprotocol/sdk/types.js';

import { stopProcessTree } from '@/utils/stopProcessTree';

import { getDesktopEnv } from '@/env';

import type { MCPClientParams, McpPrompt, McpResource, McpTool, ToolCallResult } from './types';

/**
 * Custom error class for MCP connection errors that includes STDIO logs
 */
export class MCPConnectionError extends Error {
  readonly stderrLogs: string[];

  constructor(message: string, stderrLogs: string[] = []) {
    super(message);
    this.name = 'MCPConnectionError';
    this.stderrLogs = stderrLogs;
  }
}

export class MCPClient {
  private static active = new Set<MCPClient>();
  static async cleanupAll() {
    await Promise.all([...this.active].map((client) => client.disconnect()));
  }
  private disconnecting?: Promise<void>;

  private readonly mcp: Client;

  private transport: Transport;
  private stderrLogs: string[] = [];
  private isStdio: boolean = false;

  constructor(params: MCPClientParams) {
    this.mcp = new Client({ name: 'lobehub-desktop-mcp-client', version: '1.0.0' });

    switch (params.type) {
      case 'http': {
        const headers: Record<string, string> = { ...params.headers };

        if (params.auth) {
          if (params.auth.type === 'bearer' && params.auth.token) {
            headers['Authorization'] = `Bearer ${params.auth.token}`;
          }

          if (params.auth.type === 'oauth2' && params.auth.accessToken) {
            headers['Authorization'] = `Bearer ${params.auth.accessToken}`;
          }
        }

        this.transport = new StreamableHTTPClientTransport(new URL(params.url), {
          requestInit: { headers },
        });
        break;
      }

      case 'stdio': {
        this.isStdio = true;
        const stdioTransport = new StdioClientTransport({
          args: params.args,
          command: params.command,
          env: {
            ...getDefaultEnvironment(),
            ...params.env,
          },
          stderr: 'pipe', // Capture stderr for better error messages
        });

        // Listen to stderr stream to collect logs
        this.setupStderrListener(stdioTransport);

        this.transport = stdioTransport;
        break;
      }

      default: {
        // Exhaustive check

        const _never: never = params;
        throw new Error(`Unsupported MCP connection type: ${(params as any).type}`);
      }
    }
    MCPClient.active.add(this);
  }

  private setupStderrListener(transport: StdioClientTransport) {
    const stderr = transport.stderr as Readable | null;
    if (stderr) {
      stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        // Split by newlines and filter empty lines
        const lines = text.split('\n').filter((line) => line.trim());
        this.stderrLogs.push(...lines);
      });
    }
  }

  /**
   * Get collected stderr logs from the STDIO process
   */
  getStderrLogs(): string[] {
    return this.stderrLogs;
  }

  private isMethodNotFoundError(error: unknown) {
    const err = error as any;
    if (!err) return false;

    if (err.code === -32601) return true;
    if (typeof err.message === 'string' && err.message.includes('Method not found')) return true;
    return false;
  }

  async initialize(options: { onProgress?: (progress: Progress) => void } = {}) {
    try {
      await this.mcp.connect(this.transport, { onprogress: options.onProgress });
    } catch (error) {
      // If this is a STDIO connection and we have stderr logs, enhance the error
      if (this.isStdio && this.stderrLogs.length > 0) {
        const originalMessage = error instanceof Error ? error.message : String(error);
        throw new MCPConnectionError(originalMessage, this.stderrLogs);
      }
      throw error;
    }
  }

  disconnect(): Promise<void> {
    return (this.disconnecting ??= (async () => {
      const close = async () => {
        await this.transport?.close();
      };
      const pid = this.transport instanceof StdioClientTransport ? this.transport.pid : null;
      if (pid) await stopProcessTree(pid, close);
      else await close();
      // Retain failed cleanups so a later installer cannot overlook a live task.
      MCPClient.active.delete(this);
    })());
  }

  async listTools() {
    const { tools } = await this.mcp.listTools();
    return (tools || []) as McpTool[];
  }

  async listResources() {
    const { resources } = await this.mcp.listResources();
    return (resources || []) as McpResource[];
  }

  async listPrompts() {
    const { prompts } = await this.mcp.listPrompts();
    return (prompts || []) as McpPrompt[];
  }

  async listManifests() {
    const [tools, prompts, resources] = await Promise.all([
      this.listTools(),
      this.listPrompts().catch((error) => {
        if (this.isMethodNotFoundError(error)) return [] as McpPrompt[];
        throw error;
      }),
      this.listResources().catch((error) => {
        if (this.isMethodNotFoundError(error)) return [] as McpResource[];
        throw error;
      }),
    ]);

    return {
      prompts: prompts.length === 0 ? undefined : prompts,
      resources: resources.length === 0 ? undefined : resources,
      title: this.mcp.getServerVersion()?.title,
      tools: tools.length === 0 ? undefined : tools,
      version: this.mcp.getServerVersion()?.version?.replace('v', ''),
    };
  }

  async callTool(toolName: string, args: any): Promise<ToolCallResult> {
    const result = await this.mcp.callTool({ arguments: args, name: toolName }, undefined, {
      timeout: getDesktopEnv().MCP_TOOL_TIMEOUT,
    });
    return result as ToolCallResult;
  }
}
