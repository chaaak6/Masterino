import { and, count, desc, eq, ilike, or } from 'drizzle-orm';

import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { apiKeys, users } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { ApiKeyModel } from './apiKey';

/** Administrative catalog only; authentication remains the existing owner-bound API Key flow. */
export class ManagedApiKeyModel {
  constructor(private db: LobeChatDatabase) {}

  async create(userId: string, input: { name: string; description?: string; expiresAt?: Date | null }) {
    const row = await new ApiKeyModel(this.db, userId).create({ ...input, isAdminManaged: true });
    return { id: row.id };
  }

  async list(input: { page: number; pageSize: number; q?: string }) {
    const where = and(eq(apiKeys.isAdminManaged, true), input.q ? or(ilike(apiKeys.name, `%${input.q}%`), ilike(apiKeys.description, `%${input.q}%`)) : undefined);
    const [items, totals] = await Promise.all([
      this.db.select({ id: apiKeys.id, name: apiKeys.name, description: apiKeys.description, enabled: apiKeys.enabled, createdAt: apiKeys.createdAt, expiresAt: apiKeys.expiresAt, lastUsedAt: apiKeys.lastUsedAt, ownerUserId: apiKeys.userId, ownerFullName: users.fullName, ownerUsername: users.username, ownerEmail: users.email })
        .from(apiKeys).innerJoin(users, eq(users.id, apiKeys.userId)).where(where)
        .orderBy(desc(apiKeys.createdAt)).limit(input.pageSize).offset((input.page - 1) * input.pageSize),
      this.db.select({ total: count() }).from(apiKeys).where(where),
    ]);
    return { items: items.map(({ ownerFullName, ownerUsername, ownerEmail, ...item }) => ({ ...item, ownerName: ownerFullName || ownerUsername || ownerEmail || item.ownerUserId })), total: totals[0].total };
  }

  async reveal(id: string) {
    const row = await this.db.query.apiKeys.findFirst({ where: and(eq(apiKeys.id, id), eq(apiKeys.isAdminManaged, true)), columns: { key: true } });
    if (!row) throw new Error('Managed API key not found');
    const gate = await KeyVaultsGateKeeper.initWithEnvKey();
    const value = await gate.decrypt(row.key);
    if (!value.wasAuthentic) throw new Error('Unable to decrypt API key');
    return value.plaintext;
  }

  async setEnabled(id: string, enabled: boolean) {
    const rows = await this.db.update(apiKeys).set({ enabled, updatedAt: new Date() }).where(and(eq(apiKeys.id, id), eq(apiKeys.isAdminManaged, true))).returning({ id: apiKeys.id });
    if (!rows.length) throw new Error('Managed API key not found');
    return rows[0];
  }

  async delete(id: string) {
    const rows = await this.db.delete(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.isAdminManaged, true))).returning({ id: apiKeys.id });
    if (!rows.length) throw new Error('Managed API key not found');
    return rows[0];
  }
}
