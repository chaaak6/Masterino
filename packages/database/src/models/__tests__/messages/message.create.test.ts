import { FileModel } from '../../file';
import type {
  CommitToolResultInput,
  DBMessageItem,
  EnsureToolMessageInput,
  MessageMetadata,
} from '@lobechat/types';
import { asc, eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { uuid } from '@/utils/uuid';

import { getTestDB } from '../../../core/getTestDB';
import {
  agents,
  chatGroups,
  chunks,
  embeddings,
  files,
  messagePlugins,
  messageQueries,
  messageQueryChunks,
  messages,
  messagesFiles,
  sessions,
  topics,
  users,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import {
  MessageModel,
  ToolMessageIntentConflictError,
  ToolResultCommitConflictError,
  ToolResultCommitTargetError,
} from '../../message';
import { codeEmbedding } from '../fixtures/embedding';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'message-create-test';
const otherUserId = 'message-create-test-other';
const messageModel = new MessageModel(serverDB, userId);
const embeddingsId = uuid();

beforeEach(async () => {
  // Clear tables before each test case
  await serverDB.transaction(async (trx) => {
    await trx.delete(users).where(eq(users.id, userId));
    await trx.delete(users).where(eq(users.id, otherUserId));
    await trx.insert(users).values([{ id: userId }, { id: otherUserId }]);

    await trx.insert(sessions).values([
      // { id: 'session1', userId },
      // { id: 'session2', userId },
      { id: '1', userId },
    ]);
    await trx.insert(files).values({
      id: 'f1',
      userId,
      url: 'abc',
      name: 'file-1',
      fileType: 'image/png',
      size: 1000,
    });

    await trx.insert(embeddings).values({
      id: embeddingsId,
      embeddings: codeEmbedding,
      userId,
    });
  });
});

afterEach(async () => {
  // Clear tables after each test case
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

describe('MessageModel Create Tests', () => {
  it('persists local descriptions without fake file foreign keys and dual-writes uploaded IDs once', async () => {
    const local = {
      source: 'local' as const,
      attachmentId: 'a',
      localResourceId: 'r',
      deviceId: 'd',
      name: 'report.xlsx',
      mime: 'application/xlsx',
      size: 12,
      version: 'v',
    };
    const item = await messageModel.create({
      content: 'read this',
      role: 'user',
      files: ['f1', 'f1'],
      attachments: { schemaVersion: 1, items: [local] },
    });
    const [row] = await serverDB.select().from(messages).where(eq(messages.id, item.id));
    expect(row.attachments?.items).toHaveLength(2);
    expect(row.attachments?.items[0]).toEqual(local);
    const links = await serverDB
      .select()
      .from(messagesFiles)
      .where(eq(messagesFiles.messageId, item.id));
    expect(links.map((link) => link.fileId)).toEqual(['f1']);
  });

  it('rolls back both representations when a transaction is interrupted after relation insertion', async () => {
    const originalTransaction = serverDB.transaction.bind(serverDB);
    const fault = vi.spyOn(serverDB, 'transaction').mockImplementation(async (callback: any) =>
      originalTransaction(async (trx) => {
        await callback(trx);
        throw new Error('simulated transaction interruption');
      }),
    );
    try {
      await expect(
        messageModel.create(
          { content: 'read', role: 'user', files: ['f1'] },
          'attachment-interrupted',
        ),
      ).rejects.toThrow('interruption');
    } finally {
      fault.mockRestore();
    }
    expect(
      await serverDB.select().from(messages).where(eq(messages.id, 'attachment-interrupted')),
    ).toEqual([]);
    expect(
      await serverDB
        .select()
        .from(messagesFiles)
        .where(eq(messagesFiles.messageId, 'attachment-interrupted')),
    ).toEqual([]);
  });

  it('removes uploaded JSON references with deleted files while preserving local references', async () => {
    const local = {
      source: 'local' as const,
      attachmentId: 'a',
      localResourceId: 'r',
      deviceId: 'd',
      name: 'report.xlsx',
      mime: 'application/xlsx',
      size: 12,
      version: 'v',
    };
    const item = await messageModel.create({
      content: 'read',
      role: 'user',
      files: ['f1'],
      attachments: { schemaVersion: 1, items: [local] },
    });
    await new FileModel(serverDB, userId).delete('f1');
    const [row] = await serverDB.select().from(messages).where(eq(messages.id, item.id));
    expect(row.attachments?.items).toEqual([local]);
    expect(
      await serverDB.select().from(messagesFiles).where(eq(messagesFiles.messageId, item.id)),
    ).toEqual([]);
  });

  it('rejects unowned uploaded references without leaving a message or association', async () => {
    await expect(
      messageModel.create(
        { content: 'no', role: 'user', files: ['missing-file'] },
        'attachment-invalid',
      ),
    ).rejects.toThrow();
    expect(
      await serverDB.select().from(messages).where(eq(messages.id, 'attachment-invalid')),
    ).toEqual([]);
    expect(
      await serverDB
        .select()
        .from(messagesFiles)
        .where(eq(messagesFiles.messageId, 'attachment-invalid')),
    ).toEqual([]);
  });

  it('replaces attachment links and JSON in one transaction and preserves both after a failed update', async () => {
    const item = await messageModel.create({ content: 'read', role: 'user', files: ['f1'] });
    const bad = await messageModel.update(item.id, {
      attachments: {
        schemaVersion: 1,
        items: [
          {
            source: 'uploaded',
            attachmentId: 'bad',
            fileId: 'missing',
            name: 'x',
            mime: 'image/png',
            size: 1,
          },
        ],
      },
    });
    expect(bad.success).toBe(false);
    const [row] = await serverDB.select().from(messages).where(eq(messages.id, item.id));
    expect(row.attachments?.items[0]).toMatchObject({ fileId: 'f1' });
    expect(
      await serverDB.select().from(messagesFiles).where(eq(messagesFiles.messageId, item.id)),
    ).toHaveLength(1);
    await messageModel.update(item.id, { attachments: { schemaVersion: 1, items: [] } });
    expect(
      await serverDB.select().from(messagesFiles).where(eq(messagesFiles.messageId, item.id)),
    ).toHaveLength(0);
  });

  describe('ensureToolMessage', () => {
    it('creates one canonical tool message from an immutable intent', async () => {
      await serverDB.insert(agents).values({ id: 'agent-ensure', userId });
      await messageModel.create(
        {
          agentId: 'agent-ensure',
          content: 'assistant tool call',
          role: 'assistant',
        },
        'msg_ensure_parent',
      );

      const result = await messageModel.ensureToolMessage({
        agentId: 'agent-ensure',
        id: 'msg_ensure_tool',
        parentMessageId: 'msg_ensure_parent',
        toolCall: {
          apiName: 'runCommand',
          arguments: '{"command":"pwd"}',
          executor: 'client',
          identifier: 'lobe-local-system',
          intervention: { status: 'approved' },
          result_msg_id: 'provider-result-1',
          source: 'builtin',
          thoughtSignature: 'signed-thought',
          toolCallId: 'call_ensure_1',
          type: 'builtin',
        },
      });

      expect(result).toEqual({ disposition: 'created', id: 'msg_ensure_tool' });

      const [storedMessage] = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.id, result.id));
      const [storedPlugin] = await serverDB
        .select()
        .from(messagePlugins)
        .where(eq(messagePlugins.id, result.id));

      expect(storedMessage).toMatchObject({
        agentId: 'agent-ensure',
        content: '',
        metadata: {
          toolLifecycle: {
            intentFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
        },
        parentId: 'msg_ensure_parent',
        role: 'tool',
      });
      expect(storedPlugin).toMatchObject({
        apiName: 'runCommand',
        arguments: '{"command":"pwd"}',
        identifier: 'lobe-local-system',
        intervention: { status: 'approved' },
        toolCallId: 'call_ensure_1',
        type: 'builtin',
      });
    });

    it('returns existing when the same immutable intent is replayed', async () => {
      await serverDB.insert(agents).values({ id: 'agent-ensure-replay', userId });
      await messageModel.create(
        {
          agentId: 'agent-ensure-replay',
          content: 'assistant tool call',
          role: 'assistant',
        },
        'msg_ensure_replay_parent',
      );
      const intent: EnsureToolMessageInput = {
        agentId: 'agent-ensure-replay',
        id: 'msg_ensure_replay_tool',
        parentMessageId: 'msg_ensure_replay_parent',
        toolCall: {
          apiName: 'runCommand',
          arguments: '{"command":"pwd"}',
          identifier: 'lobe-local-system',
          toolCallId: 'call_ensure_replay',
          type: 'builtin',
        },
      };

      await messageModel.ensureToolMessage(intent);
      const replay = await messageModel.ensureToolMessage(intent);

      expect(replay).toEqual({ disposition: 'existing', id: 'msg_ensure_replay_tool' });
    });

    it.each([false, true])(
      'treats intervention status as mutable while preserving the immutable intent (path pending: %s)',
      async (pathPending) => {
        await serverDB.insert(agents).values({ id: 'agent-ensure-intervention', userId });
        await messageModel.create(
          {
            agentId: 'agent-ensure-intervention',
            content: 'assistant tool call',
            role: 'assistant',
          },
          'msg_ensure_intervention_parent',
        );
        if (pathPending) await serverDB.insert(topics).values({ id: 'topic-path', userId });
        const intent: EnsureToolMessageInput = {
          ...(pathPending ? { topicId: 'topic-path' } : {}),
          agentId: 'agent-ensure-intervention',
          id: 'msg_ensure_intervention_tool',
          parentMessageId: 'msg_ensure_intervention_parent',
          toolCall: {
            apiName: 'runCommand',
            arguments: '{"command":"pwd"}',
            identifier: 'lobe-local-system',
            intervention: { status: 'pending' },
            toolCallId: 'call_ensure_intervention',
            type: 'builtin',
          },
        };

        await messageModel.ensureToolMessage(intent);
        await serverDB
          .update(messagePlugins)
          .set({
            intervention: { status: 'approved' },
            ...(pathPending
              ? {
                  state: {
                    code: 'INTERVENTION_REQUIRED',
                    workspacePathConsent: {
                      version: 1,
                      operationId: 'paused-op',
                      deviceId: 'device-1',
                      topicId: 'topic-path',
                      actualCwd: '',
                      primaryCwd: '',
                      requestedPath: '/tmp/probe.txt',
                      modes: ['read'],
                    },
                  },
                }
              : {}),
          })
          .where(eq(messagePlugins.id, intent.id));

        await expect(
          messageModel.ensureToolMessage({
            ...intent,
            mode: 'confirm-existing',
            toolCall: { ...intent.toolCall, intervention: { status: 'approved' } },
          }),
        ).resolves.toEqual({ disposition: 'existing', id: intent.id });
      },
    );

    it('atomically adopts an approved unexecuted legacy tool message before result commit', async () => {
      await serverDB.insert(agents).values({ id: 'agent-ensure-legacy-approval', userId });
      const parentMessageId = 'msg_ensure_legacy_approval_parent';
      const id = 'msg_ensure_legacy_approval_tool';
      await messageModel.create(
        {
          agentId: 'agent-ensure-legacy-approval',
          content: 'assistant tool call',
          role: 'assistant',
        },
        parentMessageId,
      );
      await messageModel.create(
        {
          agentId: 'agent-ensure-legacy-approval',
          content: '',
          parentId: parentMessageId,
          plugin: {
            apiName: 'runCommand',
            arguments: '{"command":"pwd"}',
            identifier: 'lobe-local-system',
            type: 'builtin',
          },
          pluginIntervention: { status: 'approved' },
          role: 'tool',
          tool_call_id: 'call_ensure_legacy_approval',
        },
        id,
      );

      await expect(
        messageModel.ensureToolMessage({
          agentId: 'agent-ensure-legacy-approval',
          id,
          mode: 'confirm-existing',
          parentMessageId,
          toolCall: {
            apiName: 'runCommand',
            arguments: '{"command":"pwd"}',
            identifier: 'lobe-local-system',
            intervention: { status: 'approved' },
            toolCallId: 'call_ensure_legacy_approval',
            type: 'builtin',
          },
        }),
      ).resolves.toEqual({ disposition: 'existing', id });

      await expect(
        messageModel.commitToolResult({
          executionAttemptId: 'attempt_ensure_legacy_approval',
          id,
          result: { content: 'approved result', success: true },
        }),
      ).resolves.toEqual({ disposition: 'committed', id });
    });

    it('refuses to adopt a legacy tool message that is not approved and untouched', async () => {
      await serverDB.insert(agents).values({ id: 'agent-ensure-legacy-invalid', userId });
      const parentMessageId = 'msg_ensure_legacy_invalid_parent';
      const id = 'msg_ensure_legacy_invalid_tool';
      await messageModel.create(
        {
          agentId: 'agent-ensure-legacy-invalid',
          content: 'assistant tool call',
          role: 'assistant',
        },
        parentMessageId,
      );
      await messageModel.create(
        {
          agentId: 'agent-ensure-legacy-invalid',
          content: '',
          parentId: parentMessageId,
          plugin: {
            apiName: 'runCommand',
            arguments: '{}',
            identifier: 'lobe-local-system',
            type: 'builtin',
          },
          pluginIntervention: { status: 'pending' },
          role: 'tool',
          tool_call_id: 'call_ensure_legacy_invalid',
        },
        id,
      );

      await expect(
        messageModel.ensureToolMessage({
          agentId: 'agent-ensure-legacy-invalid',
          id,
          mode: 'confirm-existing',
          parentMessageId,
          toolCall: {
            apiName: 'runCommand',
            arguments: '{}',
            identifier: 'lobe-local-system',
            intervention: { status: 'pending' },
            toolCallId: 'call_ensure_legacy_invalid',
            type: 'builtin',
          },
        }),
      ).rejects.toBeInstanceOf(ToolMessageIntentConflictError);

      await serverDB
        .update(messagePlugins)
        .set({ intervention: { status: 'approved' } })
        .where(eq(messagePlugins.id, id));
      await serverDB
        .update(messages)
        .set({ content: 'already executed' })
        .where(eq(messages.id, id));
      await expect(
        messageModel.ensureToolMessage({
          agentId: 'agent-ensure-legacy-invalid',
          id,
          mode: 'confirm-existing',
          parentMessageId,
          toolCall: {
            apiName: 'runCommand',
            arguments: '{}',
            identifier: 'lobe-local-system',
            intervention: { status: 'approved' },
            toolCallId: 'call_ensure_legacy_invalid',
            type: 'builtin',
          },
        }),
      ).rejects.toBeInstanceOf(ToolMessageIntentConflictError);

      await serverDB
        .update(messages)
        .set({ content: '', metadata: { toolLifecycle: { malformed: true } } })
        .where(eq(messages.id, id));
      await expect(
        messageModel.ensureToolMessage({
          agentId: 'agent-ensure-legacy-invalid',
          id,
          mode: 'confirm-existing',
          parentMessageId,
          toolCall: {
            apiName: 'runCommand',
            arguments: '{}',
            identifier: 'lobe-local-system',
            intervention: { status: 'approved' },
            toolCallId: 'call_ensure_legacy_invalid',
            type: 'builtin',
          },
        }),
      ).rejects.toBeInstanceOf(ToolMessageIntentConflictError);
    });

    it('does not create a missing message in confirm-existing mode', async () => {
      await serverDB.insert(agents).values({ id: 'agent-confirm-existing-missing', userId });
      await messageModel.create(
        {
          agentId: 'agent-confirm-existing-missing',
          content: 'assistant tool call',
          role: 'assistant',
        },
        'msg_confirm_existing_missing_parent',
      );

      await expect(
        messageModel.ensureToolMessage({
          agentId: 'agent-confirm-existing-missing',
          id: 'msg_confirm_existing_missing_tool',
          mode: 'confirm-existing',
          parentMessageId: 'msg_confirm_existing_missing_parent',
          toolCall: {
            apiName: 'runCommand',
            arguments: '{}',
            identifier: 'lobe-local-system',
            intervention: { status: 'approved' },
            toolCallId: 'call_confirm_existing_missing',
            type: 'builtin',
          },
        }),
      ).rejects.toBeInstanceOf(ToolMessageIntentConflictError);

      const rows = await serverDB
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.id, 'msg_confirm_existing_missing_tool'));
      expect(rows).toHaveLength(0);
    });

    it('settles concurrent identical intents as one create and one existing replay', async () => {
      await serverDB.insert(agents).values({ id: 'agent-ensure-concurrent', userId });
      await messageModel.create(
        {
          agentId: 'agent-ensure-concurrent',
          content: 'assistant tool call',
          role: 'assistant',
        },
        'msg_ensure_concurrent_parent',
      );
      const intent: EnsureToolMessageInput = {
        agentId: 'agent-ensure-concurrent',
        id: 'msg_ensure_concurrent_tool',
        parentMessageId: 'msg_ensure_concurrent_parent',
        toolCall: {
          apiName: 'runCommand',
          arguments: '{"command":"pwd"}',
          identifier: 'lobe-local-system',
          toolCallId: 'call_ensure_concurrent',
          type: 'builtin',
        },
      };

      const results = await Promise.all([
        messageModel.ensureToolMessage(intent),
        messageModel.ensureToolMessage(intent),
      ]);

      expect(results.map(({ disposition }) => disposition).sort()).toEqual(['created', 'existing']);
    });

    it('rejects a replay that reuses the id for a different immutable intent', async () => {
      await serverDB.insert(agents).values({ id: 'agent-ensure-conflict', userId });
      await messageModel.create(
        {
          agentId: 'agent-ensure-conflict',
          content: 'assistant tool call',
          role: 'assistant',
        },
        'msg_ensure_conflict_parent',
      );
      const intent: EnsureToolMessageInput = {
        agentId: 'agent-ensure-conflict',
        id: 'msg_ensure_conflict_tool',
        parentMessageId: 'msg_ensure_conflict_parent',
        toolCall: {
          apiName: 'runCommand',
          arguments: '{"command":"pwd"}',
          identifier: 'lobe-local-system',
          toolCallId: 'call_ensure_conflict',
          type: 'builtin',
        },
      };

      await messageModel.ensureToolMessage(intent);

      await expect(
        messageModel.ensureToolMessage({
          ...intent,
          toolCall: { ...intent.toolCall, arguments: '{"command":"whoami"}' },
        }),
      ).rejects.toBeInstanceOf(ToolMessageIntentConflictError);
    });

    it('rejects a replay when a marker-only execution field changes', async () => {
      await serverDB.insert(agents).values({ id: 'agent-ensure-source-conflict', userId });
      await messageModel.create(
        {
          agentId: 'agent-ensure-source-conflict',
          content: 'assistant tool call',
          role: 'assistant',
        },
        'msg_ensure_source_parent',
      );
      const intent: EnsureToolMessageInput = {
        agentId: 'agent-ensure-source-conflict',
        id: 'msg_ensure_source_tool',
        parentMessageId: 'msg_ensure_source_parent',
        toolCall: {
          apiName: 'runCommand',
          arguments: '{"command":"pwd"}',
          executor: 'client',
          identifier: 'lobe-local-system',
          source: 'builtin',
          toolCallId: 'call_ensure_source',
          type: 'builtin',
        },
      };

      await messageModel.ensureToolMessage(intent);

      await expect(
        messageModel.ensureToolMessage({
          ...intent,
          toolCall: { ...intent.toolCall, source: 'client' },
        }),
      ).rejects.toBeInstanceOf(ToolMessageIntentConflictError);
    });

    it('returns existing for the same intent after its tool result was committed', async () => {
      await serverDB.insert(agents).values({ id: 'agent-ensure-after-commit', userId });
      await messageModel.create(
        {
          agentId: 'agent-ensure-after-commit',
          content: 'assistant tool call',
          role: 'assistant',
        },
        'msg_ensure_after_commit_parent',
      );
      const intent: EnsureToolMessageInput = {
        agentId: 'agent-ensure-after-commit',
        id: 'msg_ensure_after_commit_tool',
        parentMessageId: 'msg_ensure_after_commit_parent',
        toolCall: {
          apiName: 'runCommand',
          arguments: '{"command":"pwd"}',
          executor: 'client',
          identifier: 'lobe-local-system',
          source: 'builtin',
          toolCallId: 'call_ensure_after_commit',
          type: 'builtin',
        },
      };

      await messageModel.ensureToolMessage(intent);
      await messageModel.commitToolResult({
        executionAttemptId: 'attempt_ensure_after_commit',
        id: intent.id,
        result: { content: 'done', state: { exitCode: 0 }, success: true },
      });

      await expect(messageModel.ensureToolMessage(intent)).resolves.toEqual({
        disposition: 'existing',
        id: intent.id,
      });
    });
  });

  describe('commitToolResult', () => {
    beforeEach(async () => {
      await serverDB.insert(agents).values({ id: 'agent-commit-tool-result', userId });
    });

    const createToolMessage = async (id: string) => {
      const parentMessageId = `parent_${id}`;
      await messageModel.create(
        {
          agentId: 'agent-commit-tool-result',
          content: 'assistant tool call',
          role: 'assistant',
        },
        parentMessageId,
      );
      await messageModel.ensureToolMessage({
        agentId: 'agent-commit-tool-result',
        id,
        parentMessageId,
        toolCall: {
          apiName: 'runCommand',
          arguments: '{"command":"pwd"}',
          executor: 'client',
          identifier: 'lobe-local-system',
          source: 'builtin',
          toolCallId: `call_${id}`,
          type: 'builtin',
        },
      });
      await messageModel.updateMetadata(id, { preserved: 'message metadata' });
    };

    const createCommit = (id: string): CommitToolResultInput => ({
      executionAttemptId: `attempt_${id}`,
      id,
      result: {
        content: 'command output',
        error: {
          body: { exitCode: 1 },
          message: 'command failed',
          type: 'BuiltinToolExecutorError',
        },
        metadata: {
          resultMetadata: 'kept',
          toolLifecycle: { executionAttemptId: 'caller-controlled' },
        },
        state: { stderr: 'permission denied', stdout: '' },
        stop: true,
        success: false,
      },
    });

    it('atomically commits a complete result and server-owned lifecycle metadata', async () => {
      const id = 'msg_commit_first';
      await createToolMessage(id);
      const input = createCommit(id);

      const result = await messageModel.commitToolResult(input);

      expect(result).toEqual({ disposition: 'committed', id });

      const [storedMessage] = await serverDB.select().from(messages).where(eq(messages.id, id));
      const [storedPlugin] = await serverDB
        .select()
        .from(messagePlugins)
        .where(eq(messagePlugins.id, id));

      expect(storedMessage).toMatchObject({ content: 'command output' });
      expect(storedMessage.metadata).toMatchObject({
        preserved: 'message metadata',
        resultMetadata: 'kept',
        toolLifecycle: {
          executionAttemptId: input.executionAttemptId,
          intentFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
          resultFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      });
      expect(storedPlugin).toMatchObject({
        error: input.result.error,
        state: input.result.state,
      });
    });

    it('returns existing for the same attempt and canonical result without rewriting', async () => {
      const id = 'msg_commit_replay';
      await createToolMessage(id);
      const input = createCommit(id);
      await messageModel.commitToolResult(input);

      const replay = await messageModel.commitToolResult({
        ...input,
        result: {
          ...input.result,
          metadata: {
            toolLifecycle: { executionAttemptId: 'different-caller-value' },
            resultMetadata: 'kept',
          },
          state: { stdout: '', stderr: 'permission denied' },
        },
      });

      expect(replay).toEqual({ disposition: 'existing', id });
    });

    it('sanitizes null bytes before fingerprinting and writing every result projection', async () => {
      const id = 'msg_commit_null_bytes';
      await createToolMessage(id);
      const input: CommitToolResultInput = {
        executionAttemptId: 'attempt_null_bytes',
        id,
        result: {
          content: 'out\0put',
          error: {
            body: { nested: 'bo\0dy' },
            message: 'fail\0-ed',
            type: 'Tool\0Error',
          },
          metadata: { nested: { label: 'meta\0-data' } },
          state: { stdout: 'sta\0te' },
          success: false,
        },
      };

      await expect(messageModel.commitToolResult(input)).resolves.toEqual({
        disposition: 'committed',
        id,
      });
      await expect(messageModel.commitToolResult(input)).resolves.toEqual({
        disposition: 'existing',
        id,
      });

      const [storedMessage] = await serverDB.select().from(messages).where(eq(messages.id, id));
      const [storedPlugin] = await serverDB
        .select()
        .from(messagePlugins)
        .where(eq(messagePlugins.id, id));
      expect(storedMessage.content).toBe('output');
      expect(storedMessage.metadata).toMatchObject({ nested: { label: 'meta-data' } });
      expect(storedPlugin.error).toEqual({
        body: { nested: 'body' },
        message: 'fail-ed',
        type: 'ToolError',
      });
      expect(storedPlugin.state).toEqual({ stdout: 'state' });
    });

    it.each([
      {
        label: 'content',
        tamper: async (id: string) =>
          serverDB.update(messages).set({ content: 'tampered' }).where(eq(messages.id, id)),
      },
      {
        label: 'caller metadata projection',
        tamper: async (id: string) => {
          const [stored] = await serverDB.select().from(messages).where(eq(messages.id, id));
          return serverDB
            .update(messages)
            .set({
              metadata: {
                ...(stored.metadata as Record<string, unknown>),
                resultMetadata: 'tampered',
              },
            })
            .where(eq(messages.id, id));
        },
      },
      {
        label: 'plugin state',
        tamper: async (id: string) =>
          serverDB
            .update(messagePlugins)
            .set({ state: { stdout: 'tampered' } })
            .where(eq(messagePlugins.id, id)),
      },
      {
        label: 'plugin error',
        tamper: async (id: string) =>
          serverDB
            .update(messagePlugins)
            .set({ error: { message: 'tampered', type: 'OtherError' } })
            .where(eq(messagePlugins.id, id)),
      },
    ])('recognizes an identical replay after later $label mutation', async ({ label, tamper }) => {
      const id = `msg_commit_later_mutation_${label.replaceAll(' ', '_')}`;
      await createToolMessage(id);
      const input = createCommit(id);
      await messageModel.commitToolResult(input);
      await tamper(id);

      await expect(messageModel.commitToolResult(input)).resolves.toEqual({
        disposition: 'existing',
        id,
      });
    });

    it('rejects an identical replay after its server-owned result marker was removed', async () => {
      const id = 'msg_commit_marker_tamper';
      await createToolMessage(id);
      const input = createCommit(id);
      await messageModel.commitToolResult(input);
      const [stored] = await serverDB.select().from(messages).where(eq(messages.id, id));
      await serverDB
        .update(messages)
        .set({
          metadata: {
            ...(stored.metadata as Record<string, unknown>),
            toolLifecycle: undefined,
          },
        })
        .where(eq(messages.id, id));

      await expect(messageModel.commitToolResult(input)).rejects.toBeInstanceOf(
        ToolResultCommitConflictError,
      );
    });

    it('serializes concurrent identical commits into one write and one replay', async () => {
      const id = 'msg_commit_concurrent';
      await createToolMessage(id);
      const input = createCommit(id);

      const results = await Promise.all([
        messageModel.commitToolResult(input),
        messageModel.commitToolResult(input),
      ]);

      expect(results.map(({ disposition }) => disposition).sort()).toEqual([
        'committed',
        'existing',
      ]);
    });

    it('rejects the same attempt with a different result', async () => {
      const id = 'msg_commit_result_conflict';
      await createToolMessage(id);
      const input = createCommit(id);
      await messageModel.commitToolResult(input);

      await expect(
        messageModel.commitToolResult({
          ...input,
          result: { ...input.result, content: 'different output' },
        }),
      ).rejects.toBeInstanceOf(ToolResultCommitConflictError);
    });

    it('rejects a different attempt even when the result is identical', async () => {
      const id = 'msg_commit_attempt_conflict';
      await createToolMessage(id);
      const input = createCommit(id);
      await messageModel.commitToolResult(input);

      await expect(
        messageModel.commitToolResult({ ...input, executionAttemptId: 'stale_attempt' }),
      ).rejects.toBeInstanceOf(ToolResultCommitConflictError);
    });

    it('fails explicitly when the message does not exist', async () => {
      await expect(
        messageModel.commitToolResult(createCommit('msg_commit_missing')),
      ).rejects.toMatchObject({
        name: 'ToolResultCommitTargetError',
        reason: 'message-not-found',
      });
    });

    it('fails explicitly when the target is not a tool message', async () => {
      const id = 'msg_commit_not_tool';
      await messageModel.create({ content: 'assistant', role: 'assistant' }, id);

      await expect(messageModel.commitToolResult(createCommit(id))).rejects.toMatchObject({
        name: 'ToolResultCommitTargetError',
        reason: 'not-tool-message',
      });
    });

    it('fails explicitly when the tool message plugin row is missing', async () => {
      const id = 'msg_commit_plugin_missing';
      await createToolMessage(id);
      await serverDB.delete(messagePlugins).where(eq(messagePlugins.id, id));

      await expect(messageModel.commitToolResult(createCommit(id))).rejects.toMatchObject({
        name: 'ToolResultCommitTargetError',
        reason: 'plugin-not-found',
      });
    });

    it('rolls the message update back when the plugin update fails', async () => {
      const id = 'msg_commit_rollback';
      await createToolMessage(id);
      await serverDB.execute(sql`
        ALTER TABLE message_plugins
        ADD CONSTRAINT message_plugins_commit_state_object
        CHECK (state IS NULL OR jsonb_typeof(state) = 'object')
      `);

      try {
        const input = createCommit(id);
        await expect(
          messageModel.commitToolResult({
            ...input,
            result: { ...input.result, state: 'invalid-for-test-constraint' },
          }),
        ).rejects.toThrow();

        const [storedMessage] = await serverDB.select().from(messages).where(eq(messages.id, id));
        const [storedPlugin] = await serverDB
          .select()
          .from(messagePlugins)
          .where(eq(messagePlugins.id, id));
        expect(storedMessage.content).toBe('');
        expect(storedMessage.metadata).toMatchObject({
          preserved: 'message metadata',
          toolLifecycle: {
            intentFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
        });
        expect(storedPlugin.state).toBeNull();
      } finally {
        await serverDB.execute(sql`
          ALTER TABLE message_plugins
          DROP CONSTRAINT message_plugins_commit_state_object
        `);
      }
    });

    it('exposes typed target errors for callers', () => {
      const error = new ToolResultCommitTargetError('msg', 'message-not-found');

      expect(error.reason).toBe('message-not-found');
    });
  });

  describe('createMessage', () => {
    it('strips caller-forged server-owned tool lifecycle metadata', async () => {
      const id = 'msg_create_forged_tool_lifecycle';
      await messageModel.create(
        {
          content: '',
          metadata: {
            finishType: 'preserved',
            toolLifecycle: { intentFingerprint: 'forged' },
          } as unknown as MessageMetadata,
          plugin: {
            apiName: 'runCommand',
            arguments: '{"command":"pwd"}',
            identifier: 'lobe-local-system',
            type: 'builtin',
          },
          role: 'tool',
          tool_call_id: 'call_forged_tool_lifecycle',
        },
        id,
      );

      const [stored] = await serverDB.select().from(messages).where(eq(messages.id, id));
      expect(stored.metadata).toEqual({ finishType: 'preserved' });
    });

    it('should create a new message', async () => {
      // Call createMessage method
      await messageModel.create({ role: 'user', content: 'new message', sessionId: '1' });

      // Assert result
      const result = await serverDB.select().from(messages).where(eq(messages.userId, userId));
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('new message');
    });

    it('should create a message', async () => {
      const sessionId = 'session1';
      await serverDB.insert(sessions).values([{ id: sessionId, userId }]);

      const result = await messageModel.create({
        content: 'message 1',
        role: 'user',
        sessionId: 'session1',
      });

      expect(result.id).toBeDefined();
      expect(result.content).toBe('message 1');
      expect(result.role).toBe('user');
      expect(result.sessionId).toBe('session1');
      expect(result.userId).toBe(userId);
    });

    it('promotes metadata.usage into the dedicated usage column on create', async () => {
      const usage = { cost: 0.004, totalInputTokens: 70, totalOutputTokens: 30, totalTokens: 100 };
      const result = await messageModel.create({
        content: 'answer',
        metadata: { usage } as any,
        role: 'assistant',
        sessionId: '1',
      });

      expect(result.usage).toEqual(usage);
      // metadata.usage stays written for backward-compatible reads
      expect((result.metadata as any).usage).toEqual(usage);
    });

    it('prefers a top-level usage over metadata.usage on create', async () => {
      const topLevel = { cost: 0.01, totalTokens: 200 };
      const result = await messageModel.create({
        content: 'answer',
        metadata: { usage: { cost: 0.004, totalTokens: 100 } } as any,
        role: 'assistant',
        sessionId: '1',
        usage: topLevel as any,
      });

      expect(result.usage).toEqual(topLevel);
    });

    it('should generate message ID automatically', async () => {
      // Call createMessage method
      await messageModel.create({
        role: 'user',
        content: 'new message',
        sessionId: '1',
      });

      // Assert result
      const result = await serverDB.select().from(messages).where(eq(messages.userId, userId));
      expect(result[0].id).toBeDefined();
      expect(result[0].id).toHaveLength(22);
    });

    it('should create a tool message and insert into messagePlugins table', async () => {
      // Call create method
      const result = await messageModel.create({
        content: 'message 1',
        role: 'tool',
        sessionId: '1',
        tool_call_id: 'tool1',
        plugin: {
          apiName: 'api1',
          arguments: 'arg1',
          identifier: 'plugin1',
          type: 'default',
        },
      });

      // Assert result
      expect(result.id).toBeDefined();
      expect(result.content).toBe('message 1');
      expect(result.role).toBe('tool');
      expect(result.sessionId).toBe('1');

      const pluginResult = await serverDB
        .select()
        .from(messagePlugins)
        .where(eq(messagePlugins.id, result.id));
      expect(pluginResult).toHaveLength(1);
      expect(pluginResult[0].identifier).toBe('plugin1');
    });

    it('should create tool message ', async () => {
      // Call create method
      const state = {
        query: 'Composio',
        answers: [],
        results: [
          {
            url: 'https://www.composio.dev/',
            score: 16,
            title: 'Composio - Connect 90+ tools to your AI agents',
            engine: 'bing',
            content:
              'Faster DevelopmentHigher ReliabilityBetter Integrations. Get Started Now. Our platform lets you ditch the specs and seamlessly integrate any tool you need in less than 5 mins.',
            engines: ['bing', 'qwant', 'brave', 'duckduckgo'],
            category: 'general',
            template: 'default.html',
            positions: [1, 1, 1, 1],
            thumbnail: '',
            parsed_url: ['https', 'www.composio.dev', '/', '', '', ''],
            publishedDate: null,
          },
          {
            url: 'https://www.composio.co/',
            score: 10.75,
            title: 'Composio',
            engine: 'bing',
            content:
              'Composio was created to help streamline the entire book creation process! Writing. Take time out to write / Make a schedule to write consistently. We have writing software that optimizes your books for printing or ebook format. Figure out what you want to write. Collaborate and write with others. Professional editing is a necessity.',
            engines: ['qwant', 'duckduckgo', 'google', 'bing', 'brave'],
            category: 'general',
            template: 'default.html',
            positions: [5, 2, 1, 5, 4],
            thumbnail: null,
            parsed_url: ['https', 'www.composio.co', '/', '', '', ''],
            publishedDate: null,
          },
        ],
        unresponsive_engines: [],
      };
      const result = await messageModel.create({
        content: '[{}]',
        plugin: {
          apiName: 'searchWithSearXNG',
          arguments: '{\n  "query": "Composio"\n}',
          identifier: 'lobe-web-browsing',
          type: 'builtin',
        },
        pluginState: state,
        role: 'tool',
        tool_call_id: 'tool_call_ymxXC2J0',
        sessionId: '1',
      });

      // Assert result
      expect(result.id).toBeDefined();
      expect(result.content).toBe('[{}]');
      expect(result.role).toBe('tool');
      expect(result.sessionId).toBe('1');

      const pluginResult = await serverDB
        .select()
        .from(messagePlugins)
        .where(eq(messagePlugins.id, result.id));
      expect(pluginResult).toHaveLength(1);
      expect(pluginResult[0].identifier).toBe('lobe-web-browsing');
      expect(pluginResult[0].state!).toMatchObject(state);
    });

    it('should handle tool message with null bytes (\\u0000) in plugin state/arguments', async () => {
      // Regression: PostgreSQL rejects \u0000 in text/jsonb columns.
      // This reproduces a real crash from web search tool returning corrupted Unicode,
      // e.g. "montée" encoded as "mont\u0000e9e" instead of "mont\u00e9e".
      const stateWithNullByte = {
        query: 'Auxerre mont\u0000e Ligue 1',
        results: [
          {
            content: 'Some result with null\u0000byte',
            url: 'https://example.com',
          },
        ],
      };

      const argsWithNullByte = `{"query":"Auxerre mont\u0000e9e 2022"}`;

      await expect(
        messageModel.create({
          content: 'tool result',
          plugin: {
            apiName: 'search',
            arguments: argsWithNullByte,
            identifier: 'lobe-web-browsing',
            type: 'builtin',
          },
          pluginState: stateWithNullByte,
          role: 'tool',
          tool_call_id: 'call_null_byte_test',
          sessionId: '1',
        }),
      ).resolves.toBeDefined();

      // Verify the data was stored and null bytes were handled
      const pluginResult = await serverDB
        .select()
        .from(messagePlugins)
        .where(eq(messagePlugins.toolCallId, 'call_null_byte_test'));
      expect(pluginResult).toHaveLength(1);
      expect(pluginResult[0].identifier).toBe('lobe-web-browsing');
      // The stored data should not contain null bytes
      expect(JSON.stringify(pluginResult[0].state)).not.toContain('\u0000');
      expect(pluginResult[0].arguments).not.toContain('\u0000');
    });

    it('should create user and assistant messages with one topic touch', async () => {
      await serverDB.insert(topics).values({
        id: 'topic-pair',
        sessionId: '1',
        title: 'Topic pair',
        userId,
      });

      const timingEvents: string[] = [];
      const result = await messageModel.createUserAndAssistantMessages(
        {
          assistantMessage: {
            content: '',
            model: 'gpt-4o',
            provider: 'openai',
            role: 'assistant',
            sessionId: '1',
            topicId: 'topic-pair',
          },
          userMessage: {
            content: 'hello',
            files: ['f1'],
            role: 'user',
            sessionId: '1',
            topicId: 'topic-pair',
          },
        },
        {
          timing: {
            log: (event) => timingEvents.push(event),
          },
        },
      );

      expect(result.userMessage.id).toBeDefined();
      expect(result.assistantMessage.id).toBeDefined();
      expect(result.assistantMessage.parentId).toBe(result.userMessage.id);
      expect(result.userMessage.createdAt.getTime()).toBeLessThan(
        result.assistantMessage.createdAt.getTime(),
      );

      const dbMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.userId, userId))
        .orderBy(asc(messages.createdAt));

      expect(dbMessages.map((message) => message.id)).toEqual([
        result.userMessage.id,
        result.assistantMessage.id,
      ]);

      const messageFiles = await serverDB
        .select()
        .from(messagesFiles)
        .where(eq(messagesFiles.messageId, result.userMessage.id));

      expect(messageFiles).toHaveLength(1);
      expect(
        timingEvents.filter(
          (event) => event === 'db.message.createUserAndAssistant.messages.insert:start',
        ),
      ).toHaveLength(1);
      expect(timingEvents.some((event) => event.includes('topic.touchUpdatedAt'))).toBe(false);
    });

    it('should not touch topic updatedAt when creating a pair for an existing topic', async () => {
      await serverDB.insert(topics).values({
        id: 'topic-pair-no-touch',
        sessionId: '1',
        title: 'Topic pair no touch',
        updatedAt: new Date('2024-01-01T00:00:00Z'),
        userId,
      });

      const timingEvents: string[] = [];
      const result = await messageModel.createUserAndAssistantMessages(
        {
          assistantMessage: {
            content: '',
            model: 'gpt-4o',
            provider: 'openai',
            role: 'assistant',
            sessionId: '1',
            topicId: 'topic-pair-no-touch',
          },
          userMessage: {
            content: 'hello',
            role: 'user',
            sessionId: '1',
            topicId: 'topic-pair-no-touch',
          },
        },
        {
          timing: {
            log: (event) => timingEvents.push(event),
          },
        },
      );
      const topic = await serverDB.query.topics.findFirst({
        where: (table, { eq }) => eq(table.id, 'topic-pair-no-touch'),
      });

      expect(result.userMessage.id).toBeDefined();
      expect(result.assistantMessage.parentId).toBe(result.userMessage.id);
      expect(
        timingEvents.filter(
          (event) => event === 'db.message.createUserAndAssistant.messages.insert:start',
        ),
      ).toHaveLength(1);
      expect(timingEvents.some((event) => event.includes('topic.touchUpdatedAt'))).toBe(false);
      expect(topic?.updatedAt.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    });

    describe('create with advanced parameters', () => {
      it('should create a message with custom ID', async () => {
        const customId = 'custom-msg-id';

        const result = await messageModel.create(
          {
            role: 'user',
            content: 'message with custom ID',
            sessionId: '1',
          },
          customId,
        );

        expect(result.id).toBe(customId);

        // Verify database records
        const dbResult = await serverDB.select().from(messages).where(eq(messages.id, customId));
        expect(dbResult).toHaveLength(1);
        expect(dbResult[0].id).toBe(customId);
      });

      it('should create a message with file chunks and RAG query ID', async () => {
        // Create test data following proper order: message -> query -> message with chunks
        const chunkId1 = uuid();
        const chunkId2 = uuid();
        const firstMessageId = uuid();
        const secondMessageId = uuid();

        // 1. Create chunks first
        await serverDB.insert(chunks).values([
          { id: chunkId1, text: 'chunk text 1', userId },
          { id: chunkId2, text: 'chunk text 2', userId },
        ]);

        // 2. Create first message (required for messageQuery FK)
        await serverDB.insert(messages).values({
          id: firstMessageId,
          userId,
          role: 'user',
          content: 'user query',
          sessionId: '1',
        });

        // 3. Create message query linked to first message
        const messageQuery = await messageModel.createMessageQuery({
          messageId: firstMessageId,
          rewriteQuery: 'test query',
          userQuery: 'original query',
          embeddingsId,
        });

        // 4. Create second message with file chunks referencing the query
        const result = await messageModel.create(
          {
            role: 'assistant',
            content: 'message with file chunks',
            fileChunks: [
              { id: chunkId1, similarity: 0.95 },
              { id: chunkId2, similarity: 0.85 },
            ],
            ragQueryId: messageQuery.id,
            sessionId: '1',
          },
          secondMessageId,
        );

        // Verify message created successfully
        expect(result.id).toBe(secondMessageId);

        // Verify message query chunk associations created successfully
        const queryChunks = await serverDB
          .select()
          .from(messageQueryChunks)
          .where(eq(messageQueryChunks.messageId, result.id));

        expect(queryChunks).toHaveLength(2);
        expect(queryChunks[0].chunkId).toBe(chunkId1);
        expect(queryChunks[0].queryId).toBe(messageQuery.id);
        expect(queryChunks[0].similarity).toBe('0.95000');
        expect(queryChunks[1].chunkId).toBe(chunkId2);
        expect(queryChunks[1].similarity).toBe('0.85000');
      });

      it('should create a message with files', async () => {
        // Create test data
        await serverDB.insert(files).values([
          {
            id: 'file1',
            name: 'file1.txt',
            fileType: 'text/plain',
            size: 100,
            url: 'url1',
            userId,
          },
          {
            id: 'file2',
            name: 'file2.jpg',
            fileType: 'image/jpeg',
            size: 200,
            url: 'url2',
            userId,
          },
        ]);

        // Call create method
        const result = await messageModel.create({
          role: 'user',
          content: 'message with files',
          files: ['file1', 'file2'],
          sessionId: '1',
        });

        // Verify message created successfully
        expect(result.id).toBeDefined();

        // Verify message file associations created successfully
        const messageFiles = await serverDB
          .select()
          .from(messagesFiles)
          .where(eq(messagesFiles.messageId, result.id));

        expect(messageFiles).toHaveLength(2);
        expect(messageFiles[0].fileId).toBe('file1');
        expect(messageFiles[1].fileId).toBe('file2');
      });

      it('should create a message with custom timestamps', async () => {
        const customCreatedAt = '2022-05-15T10:30:00Z';
        const customUpdatedAt = '2022-05-16T11:45:00Z';

        const result = await messageModel.create({
          role: 'user',
          content: 'message with custom timestamps',
          createdAt: customCreatedAt as any,
          updatedAt: customUpdatedAt as any,
          sessionId: '1',
        });

        // Verify database records
        const dbResult = await serverDB.select().from(messages).where(eq(messages.id, result.id));

        // Date comparison needs to consider timezone and formatting, so use toISOString for comparison
        expect(new Date(dbResult[0].createdAt!).toISOString()).toBe(
          new Date(customCreatedAt).toISOString(),
        );
        expect(new Date(dbResult[0].updatedAt!).toISOString()).toBe(
          new Date(customUpdatedAt).toISOString(),
        );
      });
    });
  });

  describe('batchCreateMessages', () => {
    it('should batch create messages', async () => {
      // Prepare test data
      const newMessages = [
        { id: '1', role: 'user', content: 'message 1' },
        { id: '2', role: 'assistant', content: 'message 2' },
      ] as DBMessageItem[];

      // Call batchCreateMessages method
      await messageModel.batchCreate(newMessages);

      // Assert result
      const result = await serverDB.select().from(messages).where(eq(messages.userId, userId));
      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('message 1');
      expect(result[1].content).toBe('message 2');
    });

    it('should handle messages with and without groupId', async () => {
      await serverDB.insert(sessions).values({ id: 'session1', userId });
      await serverDB.insert(chatGroups).values({ id: 'group1', userId, title: 'Group 1' });

      // Message without groupId - should keep sessionId
      const msgWithoutGroup = await messageModel.create({
        role: 'user',
        content: 'message without group',
        sessionId: 'session1',
      });

      // Message with groupId - sessionId should be set to null
      const msgWithGroup = await messageModel.create({
        role: 'user',
        content: 'message with group',
        sessionId: 'session1',
        groupId: 'group1',
      });

      // Verify from database
      const dbMsgWithoutGroup = await serverDB.query.messages.findFirst({
        where: eq(messages.id, msgWithoutGroup.id),
      });
      const dbMsgWithGroup = await serverDB.query.messages.findFirst({
        where: eq(messages.id, msgWithGroup.id),
      });

      expect(dbMsgWithoutGroup?.sessionId).toBe('session1');
      expect(dbMsgWithoutGroup?.groupId).toBeNull();

      expect(dbMsgWithGroup?.sessionId).toBeNull();
      expect(dbMsgWithGroup?.groupId).toBe('group1');
    });
  });

  describe('createMessageQuery', () => {
    it('should create a new message query', async () => {
      // Create test data
      await serverDB.insert(messages).values({
        id: 'msg1',
        userId,
        role: 'user',
        content: 'test message',
      });

      // Call createMessageQuery method
      const result = await messageModel.createMessageQuery({
        messageId: 'msg1',
        userQuery: 'original query',
        rewriteQuery: 'rewritten query',
        embeddingsId,
      });

      // Assert result
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.messageId).toBe('msg1');
      expect(result.userQuery).toBe('original query');
      expect(result.rewriteQuery).toBe('rewritten query');
      expect(result.userId).toBe(userId);

      // Verify records in the database
      const dbResult = await serverDB
        .select()
        .from(messageQueries)
        .where(eq(messageQueries.id, result.id));

      expect(dbResult).toHaveLength(1);
      expect(dbResult[0].messageId).toBe('msg1');
      expect(dbResult[0].userQuery).toBe('original query');
      expect(dbResult[0].rewriteQuery).toBe('rewritten query');
    });

    it('should create a message query with embeddings ID', async () => {
      // Create test data
      await serverDB.insert(messages).values({
        id: 'msg2',
        userId,
        role: 'user',
        content: 'test message',
      });

      // Call createMessageQuery method
      const result = await messageModel.createMessageQuery({
        messageId: 'msg2',
        userQuery: 'test query',
        rewriteQuery: 'test rewritten query',
        embeddingsId,
      });

      // Assert result
      expect(result).toBeDefined();
      expect(result.embeddingsId).toBe(embeddingsId);

      // Verify records in the database
      const dbResult = await serverDB
        .select()
        .from(messageQueries)
        .where(eq(messageQueries.id, result.id));

      expect(dbResult[0].embeddingsId).toBe(embeddingsId);
    });

    it('should generate a unique ID for each message query', async () => {
      // Create test data
      await serverDB.insert(messages).values({
        id: 'msg3',
        userId,
        role: 'user',
        content: 'test message',
      });

      // Create two message queries consecutively
      const result1 = await messageModel.createMessageQuery({
        messageId: 'msg3',
        userQuery: 'query 1',
        rewriteQuery: 'rewritten query 1',
        embeddingsId,
      });

      const result2 = await messageModel.createMessageQuery({
        messageId: 'msg3',
        userQuery: 'query 2',
        rewriteQuery: 'rewritten query 2',
        embeddingsId,
      });

      // Assert result
      expect(result1.id).not.toBe(result2.id);
    });
  });

  describe('updateMessageRAG', () => {
    it('should insert message query chunks for RAG', async () => {
      // prepare message and query
      const messageId = 'rag-msg-1';
      const queryId = uuid();
      const chunk1 = uuid();
      const chunk2 = uuid();

      await serverDB.transaction(async (trx) => {
        await trx.insert(messages).values({ id: messageId, role: 'user', userId, content: 'c' });
        await trx.insert(chunks).values([
          { id: chunk1, text: 'a' },
          { id: chunk2, text: 'b' },
        ]);
        await trx
          .insert(messageQueries)
          .values({ id: queryId, messageId, userId, userQuery: 'q', rewriteQuery: 'rq' });
      });

      await messageModel.updateMessageRAG(messageId, {
        ragQueryId: queryId,
        fileChunks: [
          { id: chunk1, similarity: 0.9 },
          { id: chunk2, similarity: 0.8 },
        ],
      });

      const rows = await serverDB
        .select()
        .from(messageQueryChunks)
        .where(eq(messageQueryChunks.messageId, messageId));

      expect(rows).toHaveLength(2);
      const s1 = rows.find((r) => r.chunkId === chunk1)!;
      const s2 = rows.find((r) => r.chunkId === chunk2)!;
      expect(s1.queryId).toBe(queryId);
      expect(s1.similarity).toBe('0.90000');
      expect(s2.similarity).toBe('0.80000');
    });
  });
});
