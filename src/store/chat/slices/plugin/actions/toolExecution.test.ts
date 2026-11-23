import type { ChatToolPayload } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { mcpService } from '@/services/mcp';
import { messageService } from '@/services/message';
import { archiveToolResultViaServer } from '@/services/toolResultArchive';
import { useToolStore } from '@/store/tool';
import { hasExecutor } from '@/store/tool/slices/builtin/executors';

import { PluginTypesActionImpl } from './pluginTypes';
import { PluginPublicApiActionImpl } from './publicApi';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { projectWorkspace: { finalizeLocalScratch: { mutate: vi.fn() } } },
}));

vi.mock('@/services/mcp', () => ({
  mcpService: { invokeMcpToolCall: vi.fn() },
}));

vi.mock('@/services/message', () => ({
  messageService: { updateMessageError: vi.fn() },
}));

vi.mock('@/services/toolResultArchive', () => ({
  archiveToolResultViaServer: vi.fn(async ({ content }: { content: string }) => content),
}));

vi.mock('@/store/chat/slices/message/selectors', () => ({
  dbMessageSelectors: {
    getDbMessageById: vi.fn(() => () => ({ agentId: 'agent-1', topicId: 'topic-1' })),
  },
  displayMessageSelectors: {
    getDisplayMessageById: vi.fn(() => () => undefined),
  },
}));

vi.mock('@/store/tool', () => ({
  useToolStore: { getState: vi.fn() },
}));

vi.mock('@/store/tool/selectors', () => ({
  composioStoreSelectors: { composioAsLobeTools: vi.fn(() => []) },
  lobehubSkillStoreSelectors: { lobehubSkillAsLobeTools: vi.fn(() => []) },
}));

vi.mock('@/store/tool/slices/builtin/executors', () => ({
  hasExecutor: vi.fn(),
}));

const builtinPayload = {
  apiName: 'run',
  arguments: '{"input":"hello"}',
  id: 'tool-call-1',
  identifier: 'local-tool',
  type: 'builtin',
} as ChatToolPayload;

const mcpPayload = {
  ...builtinPayload,
  identifier: 'mcp-tool',
  type: 'mcp',
} as ChatToolPayload;

const createActions = () => {
  const state: any = {
    activeAgentId: 'agent-1',
    messageOperationMap: {},
    operations: {},
    optimisticUpdateToolMessage: vi.fn().mockResolvedValue(undefined),
  };
  const get = () => state;

  Object.assign(
    state,
    new PluginTypesActionImpl(vi.fn() as any, get as any),
    new PluginPublicApiActionImpl(vi.fn() as any, get as any),
  );

  return state;
};

describe('raw tool execution boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes a builtin exactly once without archiving or writing its message', async () => {
    const invokeBuiltinTool = vi.fn().mockResolvedValue({
      content: 'local result',
      metadata: { source: 'local' },
      state: { finished: true },
      success: true,
    });
    vi.mocked(hasExecutor).mockReturnValue(true);
    vi.mocked(useToolStore.getState).mockReturnValue({ invokeBuiltinTool } as any);
    const actions = createActions();
    const signal = new AbortController().signal;

    const result = await actions.internal_executeDifferentTypePlugin(
      'tool-message-1',
      builtinPayload,
      undefined,
      signal,
    );

    expect(result).toEqual({
      content: 'local result',
      metadata: { source: 'local' },
      state: { finished: true },
      success: true,
    });
    expect(invokeBuiltinTool).toHaveBeenCalledTimes(1);
    expect(invokeBuiltinTool).toHaveBeenCalledWith(
      builtinPayload.identifier,
      builtinPayload.apiName,
      { input: 'hello' },
      expect.objectContaining({ signal }),
    );
    expect(archiveToolResultViaServer).not.toHaveBeenCalled();
    expect(actions.optimisticUpdateToolMessage).not.toHaveBeenCalled();
    expect(messageService.updateMessageError).not.toHaveBeenCalled();
  });

  it('preserves a completed local tool when scratch synchronization fails', async () => {
    const invokeBuiltinTool = vi.fn().mockResolvedValue({
      content: 'command completed once',
      success: true,
      state: { localScratch: { root: '/scratch/topic-1' } },
    });
    vi.mocked(hasExecutor).mockReturnValue(true);
    vi.mocked(useToolStore.getState).mockReturnValue({ invokeBuiltinTool } as any);
    vi.mocked(lambdaClient.projectWorkspace.finalizeLocalScratch.mutate).mockRejectedValue(
      new Error('gateway disconnected'),
    );
    const actions = createActions();
    actions.messageOperationMap['tool-message-1'] = 'runtime-operation';
    actions.operations['runtime-operation'] = {
      context: { agentId: 'agent-1', topicId: 'topic-1' },
      id: 'runtime-operation',
      type: 'execAgentRuntime',
      metadata: {
        executionContext: {
          version: 1,
          plan: { deviceId: 'device-1', kind: 'device', target: 'local' },
        },
      },
    };
    const result = await actions.internal_executeBuiltinTool('tool-message-1', builtinPayload);
    expect(result.success).toBe(true);
    expect(result.content).toContain('command completed once');
    expect(result.state.workspaceSynchronizationPending).toBe(true);
    expect(invokeBuiltinTool).toHaveBeenCalledTimes(1);
    expect(lambdaClient.projectWorkspace.finalizeLocalScratch.mutate).toHaveBeenCalledWith({
      deviceId: 'device-1',
      operationId: 'runtime-operation',
      topicId: 'topic-1',
      toolCallId: 'tool-call-1',
    });
  });

  it.each(['explicit', 'tool', 'runtime'] as const)(
    'does not publish late scratch success after %s cancellation',
    async (source) => {
      const controller = new AbortController();
      let complete!: (result: any) => void;
      const invokeBuiltinTool = vi.fn(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      );
      vi.mocked(hasExecutor).mockReturnValue(true);
      vi.mocked(useToolStore.getState).mockReturnValue({ invokeBuiltinTool } as any);
      const actions = createActions();
      actions.messageOperationMap['tool-message-1'] = 'tool-operation';
      actions.operations['tool-operation'] = {
        abortController: source === 'tool' ? controller : undefined,
        context: { agentId: 'agent-1', topicId: 'topic-1' },
        id: 'tool-operation',
        parentOperationId: 'runtime-operation',
        type: 'executeToolCall',
      };
      actions.operations['runtime-operation'] = {
        abortController: source === 'runtime' ? controller : undefined,
        context: { agentId: 'agent-1', topicId: 'topic-1' },
        id: 'runtime-operation',
        type: 'execAgentRuntime',
        metadata: {
          executionContext: {
            version: 1,
            plan: { deviceId: 'device-1', kind: 'device', target: 'local' },
          },
        },
      };
      const pending = actions.internal_executeBuiltinTool(
        'tool-message-1',
        builtinPayload,
        undefined,
        source === 'explicit' ? controller.signal : undefined,
      );
      controller.abort();
      complete({
        content: 'late success',
        success: true,
        state: { localScratch: { root: '/scratch/topic-1' } },
      });
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(lambdaClient.projectWorkspace.finalizeLocalScratch.mutate).not.toHaveBeenCalled();
    },
  );

  it('passes the root runtime frozen execution context to client tool executors', async () => {
    const invokeBuiltinTool = vi.fn().mockResolvedValue({ content: 'ok', success: true });
    vi.mocked(hasExecutor).mockReturnValue(true);
    vi.mocked(useToolStore.getState).mockReturnValue({ invokeBuiltinTool } as any);
    const actions = createActions();
    actions.messageOperationMap['tool-message-1'] = 'tool-operation';
    actions.operations['tool-operation'] = {
      context: { agentId: 'agent-1', topicId: 'topic-1' },
      id: 'tool-operation',
      metadata: {},
      parentOperationId: 'runtime-operation',
      type: 'executeToolCall',
    };
    actions.operations['runtime-operation'] = {
      context: { agentId: 'agent-1', topicId: 'topic-1' },
      id: 'runtime-operation',
      metadata: {
        executionContext: {
          accessRoots: [
            {
              modes: ['read', 'write', 'exec'],
              rootPath: '/workspace/project',
              scope: 'primary',
              source: 'workspace',
            },
          ],
          cwd: '/workspace/project',
          plan: { deviceId: 'device-1', kind: 'device', target: 'local' },
          version: 1,
          workspace: {
            deviceId: 'device-1',
            id: 'workspace-1',
            kind: 'device',
            rootPath: '/workspace/project',
          },
        },
      },
      type: 'execAgentRuntime',
    };

    await actions.internal_executeDifferentTypePlugin(
      'tool-message-1',
      builtinPayload,
      undefined,
      new AbortController().signal,
    );

    expect(invokeBuiltinTool).toHaveBeenCalledWith(
      builtinPayload.identifier,
      builtinPayload.apiName,
      { input: 'hello' },
      expect.objectContaining({
        executionContext: expect.objectContaining({ cwd: '/workspace/project' }),
        workingDirectory: '/workspace/project',
      }),
    );
  });

  it.each([
    {
      expectedContent: 'composio result',
      payload: { ...builtinPayload, source: 'composio' as const },
      setup: () => {
        const callComposioTool = vi.fn().mockResolvedValue({
          data: {
            content: 'composio result',
            state: { isError: false },
            success: true,
          },
          success: true,
        });
        vi.mocked(useToolStore.getState).mockReturnValue({
          callComposioTool,
          composioServers: [{ identifier: builtinPayload.identifier }],
        } as any);
        return callComposioTool;
      },
    },
    {
      expectedContent: 'skill result',
      payload: { ...builtinPayload, identifier: 'skill-provider', source: 'lobehubSkill' as const },
      setup: () => {
        const callLobehubSkillTool = vi.fn().mockResolvedValue({
          data: 'skill result',
          success: true,
        });
        vi.mocked(useToolStore.getState).mockReturnValue({ callLobehubSkillTool } as any);
        return callLobehubSkillTool;
      },
    },
  ])(
    'executes a $payload.source tool once and returns the unified result without persistence',
    async ({ expectedContent, payload, setup }) => {
      const execute = setup();
      const actions = createActions();

      const result = await actions.internal_executeDifferentTypePlugin('tool-message-1', payload);

      expect(result).toMatchObject({ content: expectedContent, success: true });
      expect(execute).toHaveBeenCalledTimes(1);
      expect(archiveToolResultViaServer).not.toHaveBeenCalled();
      expect(actions.optimisticUpdateToolMessage).not.toHaveBeenCalled();
      expect(messageService.updateMessageError).not.toHaveBeenCalled();
    },
  );

  it('passes the parent operation execution target for an ordinary MCP connector', async () => {
    const actions = createActions();
    const executionContext = { plan: { kind: 'sandbox', target: 'sandbox' }, version: 1 };
    actions.messageOperationMap['tool-message-1'] = 'tool-op';
    actions.operations['tool-op'] = { metadata: {}, parentOperationId: 'agent-op' };
    actions.operations['agent-op'] = { metadata: { executionContext } };

    await actions.internal_executeDifferentTypePlugin('tool-message-1', mcpPayload);

    expect(mcpService.invokeMcpToolCall).toHaveBeenCalledWith(
      mcpPayload,
      expect.objectContaining({ executionContext }),
    );
  });

  it('executes an MCP tool once and returns the unified result without persistence', async () => {
    vi.mocked(mcpService.invokeMcpToolCall).mockResolvedValue({
      content: 'mcp result',
      state: { content: [], isError: false },
      success: true,
    });
    const actions = createActions();
    const signal = new AbortController().signal;

    const result = await actions.internal_executeDifferentTypePlugin(
      'tool-message-1',
      mcpPayload,
      undefined,
      signal,
    );

    expect(result).toEqual({
      content: 'mcp result',
      state: { content: [], isError: false },
      success: true,
    });
    expect(mcpService.invokeMcpToolCall).toHaveBeenCalledTimes(1);
    expect(mcpService.invokeMcpToolCall).toHaveBeenCalledWith(
      mcpPayload,
      expect.objectContaining({ signal }),
    );
    expect(archiveToolResultViaServer).not.toHaveBeenCalled();
    expect(actions.optimisticUpdateToolMessage).not.toHaveBeenCalled();
    expect(messageService.updateMessageError).not.toHaveBeenCalled();
  });

  it('returns a business failure as success=false without throwing', async () => {
    vi.mocked(mcpService.invokeMcpToolCall).mockResolvedValue({
      content: 'permission denied',
      error: { message: 'permission denied' },
      state: { content: [], isError: true },
      success: false,
    });
    const actions = createActions();

    const result = await actions.internal_executeDifferentTypePlugin('tool-message-1', mcpPayload);

    expect(result).toMatchObject({
      content: 'permission denied',
      error: { message: 'permission denied', type: 'MCPToolExecutionError' },
      success: false,
    });
  });

  it.each([
    {
      payload: builtinPayload,
      setup: (error: Error) => {
        vi.mocked(hasExecutor).mockReturnValue(true);
        vi.mocked(useToolStore.getState).mockReturnValue({
          invokeBuiltinTool: vi.fn().mockRejectedValue(error),
        } as any);
      },
    },
    {
      payload: mcpPayload,
      setup: (error: Error) => {
        vi.mocked(mcpService.invokeMcpToolCall).mockRejectedValue(error);
      },
    },
    {
      payload: { ...builtinPayload, source: 'composio' as const },
      setup: (error: Error) => {
        vi.mocked(useToolStore.getState).mockReturnValue({
          callComposioTool: vi.fn().mockRejectedValue(error),
          composioServers: [{ identifier: builtinPayload.identifier }],
        } as any);
      },
    },
    {
      payload: {
        ...builtinPayload,
        identifier: 'skill-provider',
        source: 'lobehubSkill' as const,
      },
      setup: (error: Error) => {
        vi.mocked(useToolStore.getState).mockReturnValue({
          callLobehubSkillTool: vi.fn().mockRejectedValue(error),
        } as any);
      },
    },
  ])(
    'propagates a $payload.type/$payload.source execution exception without persisting',
    async ({ payload, setup }) => {
      const error = new Error('execution transport failed');
      setup(error);
      const actions = createActions();

      await expect(
        actions.internal_executeDifferentTypePlugin('tool-message-1', payload),
      ).rejects.toBe(error);
      expect(archiveToolResultViaServer).not.toHaveBeenCalled();
      expect(actions.optimisticUpdateToolMessage).not.toHaveBeenCalled();
      expect(messageService.updateMessageError).not.toHaveBeenCalled();
    },
  );
});

describe('legacy tool invocation composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes once, archives once, and persists the projected builtin result', async () => {
    const invokeBuiltinTool = vi.fn().mockResolvedValue({
      content: 'large local result',
      metadata: { source: 'local' },
      state: { finished: true },
      success: true,
    });
    vi.mocked(hasExecutor).mockReturnValue(true);
    vi.mocked(useToolStore.getState).mockReturnValue({ invokeBuiltinTool } as any);
    vi.mocked(archiveToolResultViaServer).mockResolvedValue('archived local result');
    const actions = createActions();

    const result = await actions.internal_invokeDifferentTypePlugin(
      'tool-message-1',
      builtinPayload,
    );

    expect(result).toMatchObject({ content: 'large local result', success: true });
    expect(invokeBuiltinTool).toHaveBeenCalledTimes(1);
    expect(archiveToolResultViaServer).toHaveBeenCalledTimes(1);
    expect(actions.optimisticUpdateToolMessage).toHaveBeenCalledTimes(1);
    expect(actions.optimisticUpdateToolMessage).toHaveBeenCalledWith(
      'tool-message-1',
      {
        content: 'archived local result',
        metadata: { source: 'local' },
        pluginError: undefined,
        pluginState: { finished: true },
      },
      undefined,
    );
  });

  it('executes once, archives once, and persists the projected MCP result', async () => {
    vi.mocked(mcpService.invokeMcpToolCall).mockResolvedValue({
      content: 'large mcp result',
      state: { content: [], isError: false },
      success: true,
    });
    vi.mocked(archiveToolResultViaServer).mockResolvedValue('archived mcp result');
    const actions = createActions();

    const result = await actions.internal_invokeDifferentTypePlugin('tool-message-1', mcpPayload);

    expect(result).toBe('archived mcp result');
    expect(mcpService.invokeMcpToolCall).toHaveBeenCalledTimes(1);
    expect(archiveToolResultViaServer).toHaveBeenCalledTimes(1);
    expect(actions.optimisticUpdateToolMessage).toHaveBeenCalledWith(
      'tool-message-1',
      {
        content: 'archived mcp result',
        pluginError: undefined,
        pluginState: { content: [], isError: false },
      },
      undefined,
    );
  });

  it('preserves the legacy remote return value when a builtin payload routes to Composio', async () => {
    const callComposioTool = vi.fn().mockResolvedValue({
      data: {
        content: 'large composio result',
        state: { isError: false },
        success: true,
      },
      success: true,
    });
    vi.mocked(useToolStore.getState).mockReturnValue({
      callComposioTool,
      composioServers: [{ identifier: builtinPayload.identifier }],
    } as any);
    vi.mocked(archiveToolResultViaServer).mockResolvedValue('archived composio result');
    const actions = createActions();

    const result = await actions.internal_invokeDifferentTypePlugin('tool-message-1', {
      ...builtinPayload,
      source: 'composio',
    });

    expect(result).toBe('archived composio result');
    expect(callComposioTool).toHaveBeenCalledTimes(1);
    expect(archiveToolResultViaServer).toHaveBeenCalledTimes(1);
    expect(actions.optimisticUpdateToolMessage).toHaveBeenCalledWith(
      'tool-message-1',
      {
        content: 'archived composio result',
        pluginError: undefined,
        pluginState: { isError: false },
      },
      undefined,
    );
  });

  it('preserves legacy MCP transport-error reporting outside the lifecycle path', async () => {
    const error = new Error('mcp transport failed');
    vi.mocked(mcpService.invokeMcpToolCall).mockRejectedValue(error);
    const actions = createActions();

    await expect(
      actions.internal_invokeDifferentTypePlugin('tool-message-1', mcpPayload),
    ).resolves.toBeUndefined();

    expect(messageService.updateMessageError).toHaveBeenCalledWith('tool-message-1', error, {
      agentId: 'agent-1',
      topicId: 'topic-1',
    });
    expect(archiveToolResultViaServer).not.toHaveBeenCalled();
    expect(actions.optimisticUpdateToolMessage).not.toHaveBeenCalled();
  });

  it('preserves legacy remote transport-error reporting outside the lifecycle path', async () => {
    const error = new Error('remote transport failed');
    const callComposioTool = vi.fn().mockRejectedValue(error);
    vi.mocked(useToolStore.getState).mockReturnValue({
      callComposioTool,
      composioServers: [{ identifier: builtinPayload.identifier }],
    } as any);
    vi.mocked(archiveToolResultViaServer).mockResolvedValue('remote transport failed');
    const actions = createActions();

    await expect(
      actions.internal_invokeDifferentTypePlugin('tool-message-1', {
        ...builtinPayload,
        source: 'composio',
      }),
    ).resolves.toBeUndefined();

    expect(messageService.updateMessageError).toHaveBeenCalledWith('tool-message-1', error, {
      agentId: 'agent-1',
      topicId: 'topic-1',
    });
    expect(archiveToolResultViaServer).not.toHaveBeenCalled();
    expect(actions.optimisticUpdateToolMessage).not.toHaveBeenCalled();
  });
});
