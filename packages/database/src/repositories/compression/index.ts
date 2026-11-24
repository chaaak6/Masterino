import type { CompressionGroupMetadata } from '@lobechat/types';
import { MessageGroupType } from '@lobechat/types';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { MessageGroupItem } from '../../schemas';
import { messageGroups, messages } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';

export interface CreateCompressionGroupParams {
  content: string;
  editorData?: any;
  messageIds: string[];
  metadata: CompressionGroupMetadata;
  topicId: string;
}

export interface CompressionGroupResult {
  content: string | null;
  createdAt: Date;
  description: string | null;
  editorData: unknown;
  id: string;
  metadata: CompressionGroupMetadata | null;
  topicId: string | null;
  type: string | null;
}

/**
 * Compression Repository - handles message compression operations
 */
export class CompressionRepository {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  private groupsOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messageGroups);

  private messagesOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messages);

  /**
   * Create a compression group and mark messages as compressed
   */
  async createCompressionGroup(params: CreateCompressionGroupParams): Promise<string> {
    const { topicId, content, editorData, messageIds, metadata } = params;

    // Store metadata in the description field as JSON string
    const description = JSON.stringify(metadata);

    // 1. Create compression group
    const result = (await this.db
      .insert(messageGroups)
      .values({
        content,
        description,
        editorData,
        topicId,
        type: MessageGroupType.Compression,
        userId: this.userId,
        workspaceId: this.workspaceId ?? null,
      })
      .returning()) as MessageGroupItem[];

    const group = result[0];

    // 2. Mark messages as compressed
    if (!metadata.stagedSources && messageIds.length > 0) {
      await this.markMessagesAsCompressed(messageIds, group.id);
    }

    return group.id;
  }

  /**
   * Get all compression groups for a topic
   */
  async getCompressionGroups(topicId: string): Promise<CompressionGroupResult[]> {
    const groups = await this.db
      .select()
      .from(messageGroups)
      .where(
        and(
          this.groupsOwnership(),
          eq(messageGroups.topicId, topicId),
          eq(messageGroups.type, MessageGroupType.Compression),
        ),
      )
      .orderBy(messageGroups.createdAt);

    // Parse description field as metadata
    return groups.map((group) => ({
      ...group,
      metadata: group.description ? JSON.parse(group.description) : null,
    })) as unknown as CompressionGroupResult[];
  }

  /**
   * Get the latest compression group for a topic
   */
  async getLatestCompressionGroup(topicId: string): Promise<CompressionGroupResult | null> {
    const groups = await this.getCompressionGroups(topicId);
    return groups.length > 0 ? groups.at(-1)! : null;
  }

  /**
   * Update compression group content
   */
  async updateCompressionContent(
    groupId: string,
    content: string,
    metadata?: Partial<CompressionGroupMetadata>,
  ): Promise<void> {
    const updateData: Record<string, unknown> = {
      content,
      updatedAt: new Date(),
    };

    if (metadata) {
      // Need to merge with existing metadata
      const existing = await this.db
        .select({ description: messageGroups.description })
        .from(messageGroups)
        .where(and(eq(messageGroups.id, groupId), this.groupsOwnership()));

      const existingMetadata = existing[0]?.description ? JSON.parse(existing[0].description) : {};
      updateData.description = JSON.stringify({ ...existingMetadata, ...metadata });
    }

    await this.db
      .update(messageGroups)
      .set(updateData)
      .where(and(eq(messageGroups.id, groupId), this.groupsOwnership()));
  }

  async completeCompression(groupId: string, topicId: string, content: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [group] = await tx
        .select({ description: messageGroups.description, topicId: messageGroups.topicId })
        .from(messageGroups)
        .where(
          and(
            eq(messageGroups.id, groupId),
            this.groupsOwnership(),
            eq(messageGroups.topicId, topicId),
            eq(messageGroups.type, MessageGroupType.Compression),
          ),
        )
        .for('update');

      if (!group) throw new Error('Compression group not found');
      const metadata: CompressionGroupMetadata = group.description
        ? JSON.parse(group.description)
        : {};
      if (metadata.compressionStatus === 'completed') return;
      if (metadata.compressionStatus === 'failed' || !content.trim()) {
        throw new Error('Compression cannot be completed');
      }

      const { stagedSources, ...publishedMetadata } = metadata;
      const completedAt = new Date();
      if (stagedSources) {
        const ids = stagedSources.map(({ id }) => id);
        const scope = and(
          this.messagesOwnership(),
          eq(messages.topicId, topicId),
          isNull(messages.messageGroupId),
          inArray(messages.id, ids),
        );
        const rows = await tx
          .select({ id: messages.id, updatedAt: messages.updatedAt })
          .from(messages)
          .where(scope)
          .orderBy(messages.id)
          .for('update');
        const byId = new Map(rows.map((row) => [row.id, row.updatedAt.toISOString()]));
        if (stagedSources.some(({ id, updatedAt }) => byId.get(id) !== updatedAt)) {
          throw new Error('Compression source changed before publication');
        }
        await tx
          .update(messages)
          .set({ messageGroupId: groupId, updatedAt: completedAt })
          .where(scope);
        publishedMetadata.coverage = { ids, updatedAt: completedAt.toISOString() };
      }

      await tx
        .update(messageGroups)
        .set({
          content,
          description: JSON.stringify({
            ...publishedMetadata,
            compressedAt: completedAt.toISOString(),
            compressionStatus: 'completed',
          } satisfies CompressionGroupMetadata),
        })
        .where(and(eq(messageGroups.id, groupId), this.groupsOwnership()));
    });
  }

  /**
   * Restore the original messages while retaining a sanitized, queryable record of the failed
   * compression attempt. This is deliberately distinct from `deleteCompressionGroup`, which is
   * reserved for an explicit cancellation/removal.
   */
  async markCompressionFailed(
    groupId: string,
    failureCode: 'SUMMARY_FAILED' = 'SUMMARY_FAILED',
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ description: messageGroups.description })
        .from(messageGroups)
        .where(and(eq(messageGroups.id, groupId), this.groupsOwnership()))
        .for('update');

      if (!existing) return;

      let existingMetadata: CompressionGroupMetadata = {};
      if (existing.description) {
        try {
          existingMetadata = JSON.parse(existing.description) as CompressionGroupMetadata;
        } catch {
          // A legacy malformed description must not prevent restoring the original messages.
        }
      }

      if (existingMetadata.compressionStatus === 'completed') return;

      await tx
        .update(messages)
        .set({ messageGroupId: null })
        .where(and(this.messagesOwnership(), eq(messages.messageGroupId, groupId)));

      await tx
        .update(messageGroups)
        .set({
          content: '',
          description: JSON.stringify({
            ...existingMetadata,
            compressionStatus: 'failed',
            failedAt: new Date().toISOString(),
            failureCode,
          } satisfies CompressionGroupMetadata),
          updatedAt: new Date(),
        })
        .where(and(eq(messageGroups.id, groupId), this.groupsOwnership()));
    });
  }

  /**
   * Update compression group metadata (UI state like expanded)
   */
  async updateMetadata(
    groupId: string,
    metadata: Partial<CompressionGroupMetadata>,
  ): Promise<void> {
    // Get existing metadata and merge
    const existing = await this.db
      .select({ metadata: messageGroups.metadata })
      .from(messageGroups)
      .where(and(eq(messageGroups.id, groupId), this.groupsOwnership()));

    const existingData = (existing[0]?.metadata as Record<string, unknown>) || {};
    const newMetadata = { ...existingData, ...metadata };

    await this.db
      .update(messageGroups)
      .set({ metadata: newMetadata, updatedAt: new Date() })
      .where(and(eq(messageGroups.id, groupId), this.groupsOwnership()));
  }

  /**
   * Mark messages as compressed by associating them with a compression group
   */
  async markMessagesAsCompressed(messageIds: string[], groupId: string): Promise<void> {
    if (messageIds.length === 0) return;

    await this.db
      .update(messages)
      .set({ messageGroupId: groupId })
      .where(and(this.messagesOwnership(), inArray(messages.id, messageIds)));
  }

  /**
   * Unmark messages from compression (remove from compression group)
   */
  async unmarkMessagesFromCompression(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;

    await this.db
      .update(messages)
      .set({ messageGroupId: null })
      .where(and(this.messagesOwnership(), inArray(messages.id, messageIds)));
  }

  /**
   * Toggle pin status for a message
   */
  async toggleMessagePin(messageId: string, pinned: boolean): Promise<void> {
    // Get current metadata
    const [message] = await this.db
      .select({ metadata: messages.metadata })
      .from(messages)
      .where(and(eq(messages.id, messageId), this.messagesOwnership()));

    if (!message) return;

    const currentMetadata = (message.metadata as Record<string, unknown>) || {};
    const newMetadata = { ...currentMetadata, pinned };

    await this.db
      .update(messages)
      .set({ metadata: newMetadata })
      .where(and(eq(messages.id, messageId), this.messagesOwnership()));
  }

  /**
   * Get messages that are not compressed (for sending to LLM)
   */
  async getUncompressedMessages(topicId: string) {
    return this.db
      .select()
      .from(messages)
      .where(
        and(
          this.messagesOwnership(),
          eq(messages.topicId, topicId),
          isNull(messages.messageGroupId),
        ),
      )
      .orderBy(messages.createdAt);
  }

  /**
   * Get compressed messages for a specific compression group
   */
  async getCompressedMessages(groupId: string) {
    return this.db
      .select()
      .from(messages)
      .where(and(this.messagesOwnership(), eq(messages.messageGroupId, groupId)))
      .orderBy(messages.createdAt);
  }

  /**
   * Delete a compression group and unmark all associated messages
   */
  async deleteCompressionGroup(groupId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const scope = and(eq(messageGroups.id, groupId), this.groupsOwnership());
      const [group] = await tx
        .select({ id: messageGroups.id })
        .from(messageGroups)
        .where(scope)
        .for('update');
      if (!group) return;

      // Publication takes the same lock before associating the source rows.
      // Detach them before deleting the group, whose foreign key cascades.
      await tx
        .update(messages)
        .set({ messageGroupId: null })
        .where(and(this.messagesOwnership(), eq(messages.messageGroupId, groupId)));
      await tx.delete(messageGroups).where(scope);
    });
  }
}
