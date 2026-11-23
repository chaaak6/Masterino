import { deviceLocalMcpErrors } from '@lobechat/electron-client-ipc';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

import type { MCPClient } from './client';
import type { DeviceLocalMcpScope } from './deviceLocalAccount';
import type { ToolCallResult } from './types';

interface Session {
  client: MCPClient;
  closing?: Promise<void>;
  drained: PromiseWithResolvers<void>;
  inFlight: number;
  ready: Promise<void>;
  retired: boolean;
}

export class DeviceLocalMcpSessions {
  private readonly sessions = new Map<string, Session>();

  async retire(identifier: string) {
    const session = this.sessions.get(identifier);
    if (!session) return;
    session.retired = true;
    if (session.inFlight === 0) {
      session.drained.resolve();
      await this.close(identifier, session);
    }
  }

  private close(identifier: string, session: Session) {
    return (session.closing ??= session.client.disconnect().then(
      () => {
        if (this.sessions.get(identifier) === session) this.sessions.delete(identifier);
      },
      () => {
        session.closing = undefined;
        throw new Error(deviceLocalMcpErrors.stopFailed);
      },
    ));
  }

  async call(
    identifier: string,
    toolName: string,
    args: Record<string, unknown>,
    access: {
      authorize: (scope: DeviceLocalMcpScope) => () => MCPClient;
      getScope: () => Promise<DeviceLocalMcpScope>;
    },
  ): Promise<ToolCallResult> {
    let session: Session;
    for (;;) {
      const scope = await access.getScope();
      // Recheck after the async account lookup. Disable/remove update the record before retiring.
      const createClient = access.authorize(scope);
      const current = this.sessions.get(identifier);
      if (current?.retired) {
        await current.drained.promise;
        await this.close(identifier, current);
        continue;
      }
      if (current) {
        session = current;
      } else {
        const client = createClient();
        session = {
          client,
          drained: Promise.withResolvers<void>(),
          inFlight: 0,
          ready: Promise.resolve().then(() => client.initialize()),
          retired: false,
        };
        this.sessions.set(identifier, session);
        client.onClose(() => {
          if (this.sessions.get(identifier) === session && !session.retired)
            void this.retire(identifier).catch(() => {});
        });
      }
      break;
    }

    session.inFlight++;
    try {
      await session.ready.catch((cause) => {
        session.retired = true;
        throw new Error(deviceLocalMcpErrors.connection, { cause });
      });
      const scope = await access.getScope();
      if (session.retired) throw new Error(deviceLocalMcpErrors.serverUnavailable);
      // Initialization may have taken seconds. Recheck access immediately before dispatch.
      access.authorize(scope);
      try {
        return await session.client.callTool(toolName, args);
      } catch (cause) {
        if (
          !session.retired &&
          cause instanceof McpError &&
          cause.code !== ErrorCode.ConnectionClosed &&
          cause.code !== ErrorCode.RequestTimeout
        )
          throw cause;
        session.retired = true;
        // An edit may have reached the editor. Never replay an interrupted request.
        throw new Error(
          'Could not communicate with the device-local MCP process. Check the drawing before retrying.',
          { cause },
        );
      }
    } finally {
      session.inFlight--;
      if (session.retired && session.inFlight === 0) {
        session.drained.resolve();
        // Keep failed cleanup in the registry so a later call can retry it.
        await this.close(identifier, session).catch(() => {});
      }
    }
  }
}
