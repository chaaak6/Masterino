import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import { archiveToolResultViaServer } from '@/services/toolResultArchive';

import { createChatStoreToolCallMessageAdapter } from './chatStoreMessageAdapter';

vi.mock('@/services/message', () => ({
  messageService: {
    commitToolResult: vi.fn(),
    ensureToolMessage: vi.fn(),
  },
}));
vi.mock('@/services/toolResultArchive', () => ({
  archiveToolResultViaServer: vi.fn(),
}));

describe('createChatStoreToolCallMessageAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps an unexecuted path intervention out of the terminal result barrier', async () => {
    vi.mocked(messageService.commitToolResult).mockResolvedValue({
      disposition: 'committed',
      id: 'tool-1',
    });
    const optimisticUpdateToolMessage = vi.fn().mockResolvedValue(undefined);
    const adapter = createChatStoreToolCallMessageAdapter({
      context: { agentId: 'agent-1', topicId: 'topic-1' },
      get: () => ({ optimisticUpdateToolMessage, internal_dispatchMessage: vi.fn() }) as any,
    });
    const state = {
      code: 'INTERVENTION_REQUIRED',
      workspacePathConsent: {
        version: 1,
        actualCwd: '',
        primaryCwd: '',
        requestedPath: '/tmp/probe.txt',
        modes: ['read'],
        deviceId: 'device-1',
        operationId: 'operation-1',
        topicId: 'topic-1',
      },
    };
    await adapter.commitResult({
      executionAttemptId: 'attempt-1',
      messageId: 'tool-1',
      operationId: 'commit-1',
      signal: new AbortController().signal,
      result: { content: 'INTERVENTION_REQUIRED', success: false, state },
      toolCall: {
        id: 'call-1',
        identifier: 'lobe-local-system',
        apiName: 'readFile',
        arguments: '{}',
        type: 'builtin',
      },
    });
    expect(messageService.commitToolResult).not.toHaveBeenCalled();
    expect(optimisticUpdateToolMessage).toHaveBeenCalledWith(
      'tool-1',
      { content: '', pluginError: null, pluginState: state },
      { operationId: 'commit-1' },
    );
  });

  it('never projects a legacy path-consent card while auto-approve is active', async () => {
    vi.mocked(messageService.commitToolResult).mockResolvedValue({
      disposition: 'committed',
      id: 'tool-1',
    });
    const optimisticUpdateToolMessage = vi.fn().mockResolvedValue(undefined);
    const internal_dispatchMessage = vi.fn();
    const adapter = createChatStoreToolCallMessageAdapter({
      approvalMode: 'auto-run',
      context: { agentId: 'agent-1', topicId: 'topic-1' },
      get: () => ({ optimisticUpdateToolMessage, internal_dispatchMessage }) as any,
    });
    const state = {
      code: 'INTERVENTION_REQUIRED',
      workspacePathConsent: {
        version: 1,
        actualCwd: '',
        primaryCwd: '',
        requestedPath: '/tmp/probe.txt',
        modes: ['read'],
        deviceId: 'device-1',
        operationId: 'operation-1',
        topicId: 'topic-1',
      },
    };

    await adapter.commitResult({
      executionAttemptId: 'attempt-1',
      messageId: 'tool-1',
      operationId: 'commit-1',
      signal: new AbortController().signal,
      result: { content: 'INTERVENTION_REQUIRED', success: false, state },
      toolCall: {
        id: 'call-1',
        identifier: 'lobe-local-system',
        apiName: 'readFile',
        arguments: '{}',
        type: 'builtin',
      },
    });

    expect(optimisticUpdateToolMessage).not.toHaveBeenCalledWith(
      'tool-1',
      expect.objectContaining({ pluginState: state }),
      expect.anything(),
    );
    expect(messageService.commitToolResult).toHaveBeenCalledTimes(1);
  });

  it('still projects a credential path card while auto-approve is active', async () => {
    const optimisticUpdateToolMessage = vi.fn().mockResolvedValue(undefined);
    const adapter = createChatStoreToolCallMessageAdapter({
      approvalMode: 'auto-run',
      context: { agentId: 'agent-1', topicId: 'topic-1' },
      get: () => ({ optimisticUpdateToolMessage, internal_dispatchMessage: vi.fn() }) as any,
    });
    const state = {
      code: 'INTERVENTION_REQUIRED',
      workspacePathConsent: {
        version: 1,
        actualCwd: '',
        primaryCwd: '',
        requestedPath: '/workspace/.env',
        modes: ['read'],
        deviceId: 'device-1',
        operationId: 'operation-1',
        topicId: 'topic-1',
      },
    };

    await adapter.commitResult({
      executionAttemptId: 'attempt-credential',
      messageId: 'tool-1',
      operationId: 'commit-credential',
      signal: new AbortController().signal,
      result: { content: 'INTERVENTION_REQUIRED', success: false, state },
      toolCall: {
        id: 'call-1',
        identifier: 'lobe-local-system',
        apiName: 'readFile',
        arguments: '{}',
        type: 'builtin',
      },
    });

    expect(optimisticUpdateToolMessage).toHaveBeenCalledWith(
      'tool-1',
      expect.objectContaining({ pluginState: state }),
      expect.anything(),
    );
    expect(messageService.commitToolResult).not.toHaveBeenCalled();
  });

  it('projects one stable optimistic message before retrying the ensure request', async () => {
    const optimisticCreateTmpMessage = vi.fn();
    const adapter = createChatStoreToolCallMessageAdapter({
      context: { agentId: 'agent-1', topicId: 'topic-1' },
      get: () => ({ optimisticCreateTmpMessage }) as any,
    });
    vi.mocked(messageService.ensureToolMessage)
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ disposition: 'existing', id: 'tool-message-1' });
    const signal = new AbortController().signal;
    const input = {
      context: { agentId: 'agent-1', topicId: 'topic-1' },
      messageId: 'tool-message-1',
      operationId: 'prepare-operation-1',
      parentMessageId: 'assistant-message-1',
      projectLocally: true,
      signal,
      toolCall: {
        apiName: 'runCommand',
        arguments: '{"command":"pwd"}',
        executor: 'client' as const,
        id: 'call-1',
        identifier: 'lobe-local-system',
        intervention: { status: 'approved' as const },
        result_msg_id: 'provider-result-1',
        source: 'builtin' as const,
        thoughtSignature: 'signed-thought',
        type: 'builtin' as const,
      },
    };

    await expect(adapter.ensurePrepared(input)).rejects.toThrow('temporary failure');
    await expect(adapter.ensurePrepared(input)).resolves.toEqual({
      disposition: 'existing',
      messageId: 'tool-message-1',
    });

    expect(optimisticCreateTmpMessage).toHaveBeenCalledTimes(1);
    expect(optimisticCreateTmpMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        parentId: 'assistant-message-1',
        role: 'tool',
        tool_call_id: 'call-1',
      }),
      { operationId: 'prepare-operation-1', tempMessageId: 'tool-message-1' },
    );
    expect(messageService.ensureToolMessage).toHaveBeenCalledTimes(2);
    expect(messageService.ensureToolMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: 'tool-message-1',
        mode: 'create-or-confirm',
        toolCall: expect.objectContaining({
          executor: 'client',
          intervention: { status: 'approved' },
          result_msg_id: 'provider-result-1',
          source: 'builtin',
          thoughtSignature: 'signed-thought',
        }),
      }),
      { signal },
    );
  });

  it('revalidates an existing durable message without recreating its local projection', async () => {
    const optimisticCreateTmpMessage = vi.fn();
    const adapter = createChatStoreToolCallMessageAdapter({
      context: { agentId: 'agent-1', topicId: 'topic-1' },
      get: () => ({ optimisticCreateTmpMessage }) as any,
    });
    vi.mocked(messageService.ensureToolMessage).mockResolvedValue({
      disposition: 'existing',
      id: 'tool-message-existing',
    });

    await expect(
      adapter.ensurePrepared({
        context: { agentId: 'agent-1', topicId: 'topic-1' },
        messageId: 'tool-message-existing',
        operationId: 'prepare-operation-existing',
        parentMessageId: 'assistant-message-1',
        projectLocally: false,
        signal: new AbortController().signal,
        toolCall: {
          apiName: 'runCommand',
          arguments: '{"command":"pwd"}',
          id: 'call-existing',
          result_msg_id: 'tool-message-existing',
          identifier: 'lobe-local-system',
          intervention: { status: 'approved' },
          type: 'builtin',
        },
      }),
    ).resolves.toEqual({ disposition: 'existing', messageId: 'tool-message-existing' });

    expect(optimisticCreateTmpMessage).not.toHaveBeenCalled();
    expect(vi.mocked(messageService.ensureToolMessage).mock.calls[0][0].toolCall.source).toBe(
      'builtin',
    );
    expect(
      vi.mocked(messageService.ensureToolMessage).mock.calls[0][0].toolCall.result_msg_id,
    ).toBeUndefined();
    expect(messageService.ensureToolMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tool-message-existing', mode: 'confirm-existing' }),
      expect.any(Object),
    );
  });

  it('archives and projects one result while retrying the same strict commit payload', async () => {
    const internal_dispatchMessage = vi.fn();
    const adapter = createChatStoreToolCallMessageAdapter({
      context: { agentId: 'agent-1', topicId: 'topic-1' },
      get: () => ({ internal_dispatchMessage }) as any,
    });
    vi.mocked(archiveToolResultViaServer).mockResolvedValue('archived result');
    vi.mocked(messageService.commitToolResult)
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ disposition: 'existing', id: 'tool-message-1' });
    const input = {
      executionAttemptId: 'execution-1',
      messageId: 'tool-message-1',
      operationId: 'sync-operation-1',
      result: { content: 'raw result', state: { value: 1 }, success: true },
      signal: new AbortController().signal,
      toolCall: {
        apiName: 'runCommand',
        arguments: '{}',
        id: 'call-1',
        identifier: 'lobe-local-system',
        type: 'builtin' as const,
      },
    };

    await expect(adapter.commitResult(input)).rejects.toThrow('temporary failure');
    await expect(adapter.commitResult(input)).resolves.toBeUndefined();

    expect(archiveToolResultViaServer).toHaveBeenCalledTimes(1);
    expect(internal_dispatchMessage).toHaveBeenCalledTimes(1);
    expect(messageService.commitToolResult).toHaveBeenCalledTimes(2);
    expect(messageService.commitToolResult).toHaveBeenLastCalledWith(
      {
        executionAttemptId: 'execution-1',
        id: 'tool-message-1',
        result: { content: 'archived result', state: { value: 1 }, success: true },
      },
      { signal: input.signal },
    );
  });

  it('falls back to local truncation when archival fails', async () => {
    const internal_dispatchMessage = vi.fn();
    const adapter = createChatStoreToolCallMessageAdapter({
      context: { agentId: 'agent-1', topicId: 'topic-1' },
      get: () => ({ internal_dispatchMessage }) as any,
    });
    vi.mocked(archiveToolResultViaServer).mockRejectedValue(new Error('archive unavailable'));
    vi.mocked(messageService.commitToolResult).mockResolvedValue({
      disposition: 'committed',
      id: 'tool-message-fallback',
    });
    const signal = new AbortController().signal;

    await adapter.commitResult({
      executionAttemptId: 'execution-fallback',
      messageId: 'tool-message-fallback',
      operationId: 'sync-operation-fallback',
      result: { content: 'raw result', success: true },
      signal,
      toolCall: {
        apiName: 'runCommand',
        arguments: '{}',
        id: 'call-fallback',
        identifier: 'lobe-local-system',
        type: 'builtin',
      },
    });

    expect(messageService.commitToolResult).toHaveBeenCalledWith(
      expect.objectContaining({ result: { content: 'raw result', success: true } }),
      { signal },
    );
  });

  it('cancels promptly when archival never settles', async () => {
    const internal_dispatchMessage = vi.fn();
    const adapter = createChatStoreToolCallMessageAdapter({
      context: { agentId: 'agent-1', topicId: 'topic-1' },
      get: () => ({ internal_dispatchMessage }) as any,
    });
    vi.mocked(archiveToolResultViaServer).mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const pending = adapter.commitResult({
      executionAttemptId: 'execution-never-settles',
      messageId: 'tool-message-never-settles',
      operationId: 'sync-operation-never-settles',
      result: { content: 'raw result', success: true },
      signal: controller.signal,
      toolCall: {
        apiName: 'runCommand',
        arguments: '{}',
        id: 'call-never-settles',
        identifier: 'lobe-local-system',
        type: 'builtin',
      },
    });

    controller.abort(Object.assign(new Error('attempt timed out'), { name: 'AbortError' }));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(internal_dispatchMessage).not.toHaveBeenCalled();
    expect(messageService.commitToolResult).not.toHaveBeenCalled();
  });

  it('does not project or commit an archival result that resolves after cancellation', async () => {
    let resolveArchive: ((value: string) => void) | undefined;
    const archive = new Promise<string>((resolve) => {
      resolveArchive = resolve;
    });
    const internal_dispatchMessage = vi.fn();
    const adapter = createChatStoreToolCallMessageAdapter({
      context: { agentId: 'agent-1', topicId: 'topic-1' },
      get: () => ({ internal_dispatchMessage }) as any,
    });
    vi.mocked(archiveToolResultViaServer).mockReturnValue(archive);
    const controller = new AbortController();
    const pending = adapter.commitResult({
      executionAttemptId: 'execution-late-archive',
      messageId: 'tool-message-late-archive',
      operationId: 'sync-operation-late-archive',
      result: { content: 'raw result', success: true },
      signal: controller.signal,
      toolCall: {
        apiName: 'runCommand',
        arguments: '{}',
        id: 'call-late-archive',
        identifier: 'lobe-local-system',
        type: 'builtin',
      },
    });

    controller.abort(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    resolveArchive?.('late archived result');
    await Promise.resolve();
    await Promise.resolve();

    expect(internal_dispatchMessage).not.toHaveBeenCalled();
    expect(messageService.commitToolResult).not.toHaveBeenCalled();
  });
});
