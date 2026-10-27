import type { ManagedModelDescription } from '@lobechat/types';
import { integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const managedModelCatalog = pgTable('managed_model_catalog', {
  modelId: text('model_id').primaryKey(),
  version: integer('version').notNull().default(1),
  draft: jsonb('draft').$type<ManagedModelDescription>().notNull(),
  published: jsonb('published').$type<ManagedModelDescription>(),
  publishedRevision: text('published_revision'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const managedModelCatalogRevisions = pgTable('managed_model_catalog_revisions', {
  id: text('id').primaryKey(),
  modelId: text('model_id')
    .notNull()
    .references(() => managedModelCatalog.modelId),
  description: jsonb('description').$type<ManagedModelDescription>().notNull(),
  reason: text('reason').notNull(),
  actorUserId: text('actor_user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
