import { and, eq, sql } from 'drizzle-orm';

import { topics } from '../schemas/topic';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from './workspace';

/** Merge extraction state against the latest row without changing conversation updatedAt. */
export const updateTopicMemoryExtractMetadata = (
  db: LobeChatDatabase,
  userId: string,
  id: string,
  status: 'completed' | 'failed',
  runStatePatch: Record<string, unknown>,
  workspaceId?: string,
) => {
  const existingRunState = sql`COALESCE(${topics.metadata}->'userMemoryExtractRunState', '{}'::jsonb)`;
  const mergedRunState =
    status === 'completed'
      ? sql`(${existingRunState} - 'error') || ${JSON.stringify(runStatePatch)}::jsonb`
      : sql`${existingRunState} || ${JSON.stringify(runStatePatch)}::jsonb`;
  const metadata = sql`jsonb_set(
    COALESCE(${topics.metadata}, '{}'::jsonb) || jsonb_build_object('userMemoryExtractStatus', ${status}::text),
    '{userMemoryExtractRunState}',
    ${mergedRunState}
  )`;

  return db
    .update(topics)
    .set({ metadata, updatedAt: topics.updatedAt })
    .where(and(eq(topics.id, id), buildWorkspaceWhere({ userId, workspaceId }, topics)))
    .returning();
};
