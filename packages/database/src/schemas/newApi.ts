import { index, integer, pgTable, text, varchar } from 'drizzle-orm/pg-core';

import { timestamps, timestamptz } from './_helpers';
import { users } from './user';

export const newApiBindings = pgTable(
  'new_api_bindings',
  {
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .primaryKey()
      .notNull(),

    newApiUserId: integer('new_api_user_id'),
    encryptedAccessToken: text('encrypted_access_token'),
    managedTokenId: integer('managed_token_id'),
    status: varchar('status', { enum: ['pending', 'active', 'error'], length: 16 })
      .default('pending')
      .notNull(),
    lastSyncedAt: timestamptz('last_synced_at'),
    errorMessage: text('error_message'),

    ...timestamps,
  },
  (table) => [
    index('new_api_bindings_new_api_user_id_idx').on(table.newApiUserId),
    index('new_api_bindings_status_idx').on(table.status),
  ],
);

export type NewApiBindingStatusType = (typeof newApiBindings.$inferSelect)['status'];
export type NewApiBindingItem = typeof newApiBindings.$inferSelect;
export type NewNewApiBindingItem = typeof newApiBindings.$inferInsert;
