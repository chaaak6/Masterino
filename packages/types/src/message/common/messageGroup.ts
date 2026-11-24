/**
 * Message group type
 * - parallel: multi-model parallel conversations
 * - compression: compressed message group
 */
export const MessageGroupType = {
  Parallel: 'parallel',
  Compression: 'compression',
} as const;

export type IMessageGroupType = (typeof MessageGroupType)[keyof typeof MessageGroupType];

/**
 * Metadata for compression type message groups
 */
export interface CompressionGroupMetadata {
  compressedAt?: string;
  compressedTokenCount?: number;
  /** Durable lifecycle marker used to keep failed summary attempts auditable. */
  compressionStatus?: 'completed' | 'failed' | 'pending';
  // Compression info
  compressionStrategy?: 'summarize';

  endMessageId?: string;
  // UI state
  expanded?: boolean;
  failedAt?: string;
  /** Stable, non-sensitive failure category. Raw provider errors must never be stored here. */
  failureCode?: 'SUMMARY_FAILED';
  originalMessageCount?: number;

  // Statistics
  originalTokenCount?: number;
  pinnedMessageIds?: string[];

  // Compression range
  startMessageId?: string;
  /** Membership and version recorded atomically with the published summary. */
  coverage?: { ids: string[]; updatedAt: string };
  /** Source versions captured before generating a summary. */
  stagedSources?: { id: string; updatedAt: string }[];
}

/**
 * Message group item
 */
export interface MessageGroupItem {
  clientId?: string | null;
  content?: string | null;
  createdAt: Date;
  description?: string | null;
  editorData?: any | null;

  id: string;
  parentGroupId?: string | null;

  parentMessageId?: string | null;
  // Metadata
  title?: string | null;
  topicId?: string | null;

  // Compression fields
  type?: IMessageGroupType | null;
  updatedAt: Date;
  userId: string;
}
