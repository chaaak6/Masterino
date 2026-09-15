import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { ModelProvider } from 'model-bank';

import { aiModels, enterpriseUserProfiles, newApiBindings, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { NewApiService } from '@/server/services/newApi';
import {
  type BoundTokenAvailability,
  type BoundTokenInspection,
  type BoundTokenPatch,
  NewApiBridgeClient,
  NewApiBridgeError,
} from '@/server/services/newApi/bridgeClient';
import { getNewApiQuotaAmount } from '@/utils/newApiQuota';

export type UserHealth = 'active' | 'blocked' | 'uninitialized' | 'unknown';
export type TokenHealth = BoundTokenAvailability | 'unbound' | 'unknown';

const tokenErrorToHealth = (error: unknown): TokenHealth => {
  if (error instanceof NewApiBridgeError) {
    if (error.code === 'owner_mismatch') return 'owner_mismatch';
    if (error.code === 'token_deleted') return 'deleted';
    if (error.code === 'token_missing' || error.status === 404) return 'missing';
  }
  return 'unknown';
};

const redactInspection = (inspection?: BoundTokenInspection): BoundTokenInspection | undefined => {
  if (!inspection?.token) return inspection;
  const { key: _key, ...token } = inspection.token as typeof inspection.token & { key?: string };
  return { ...inspection, token };
};

const summarizeHealth = (input: {
  aihubUserStatus?: number | null;
  bindingStatus?: string | null;
  masterinoBanned?: boolean | null;
  modelCount: number;
  newApiUserId?: number | null;
  tokenHealth: TokenHealth;
  verifyAihubUser?: boolean;
}): UserHealth => {
  if (input.masterinoBanned) return 'blocked';
  if (!input.newApiUserId) return 'uninitialized';
  if (input.bindingStatus !== 'active') return 'blocked';
  if (input.tokenHealth === 'unknown') return 'unknown';
  if (input.verifyAihubUser && input.aihubUserStatus === undefined) return 'unknown';
  if (input.aihubUserStatus !== undefined && input.aihubUserStatus !== 1) return 'blocked';
  if (input.tokenHealth !== 'active' || input.modelCount === 0) return 'blocked';
  return 'active';
};

export class UserAvailabilityService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly bridge = new NewApiBridgeClient(),
  ) {}

  private async inspectToken(newApiUserId: number, tokenId: number) {
    try {
      const result = redactInspection(await this.bridge.inspectBoundToken(newApiUserId, tokenId));
      return { inspection: result, tokenHealth: result?.availability ?? 'missing' } as const;
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        tokenHealth: tokenErrorToHealth(error),
      } as const;
    }
  }

  /** Lightweight page enrichment: one DB read per table and only bound token inspections. */
  async summarizeUsers(
    items: Array<{
      employeeNumber?: null | string;
      id: string;
      name: string;
      status: string;
    }>,
  ) {
    if (!items.length) return [];
    const ids = items.map((item) => item.id);
    const [bindings, models] = await Promise.all([
      this.db.query.newApiBindings.findMany({ where: inArray(newApiBindings.userId, ids) }),
      this.db.query.aiModels.findMany({
        columns: { id: true, userId: true },
        where: and(
          inArray(aiModels.userId, ids),
          eq(aiModels.providerId, ModelProvider.NewAPI),
          eq(aiModels.enabled, true),
          eq(aiModels.type, 'chat'),
        ),
      }),
    ]);
    const bindingMap = new Map(bindings.map((binding) => [binding.userId, binding]));
    const modelCounts = new Map<string, number>();
    for (const model of models)
      modelCounts.set(model.userId, (modelCounts.get(model.userId) ?? 0) + 1);

    return Promise.all(
      items.map(async (item) => {
        const binding = bindingMap.get(item.id);
        const token =
          binding?.newApiUserId && binding.managedTokenId
            ? await this.inspectToken(binding.newApiUserId, binding.managedTokenId)
            : { tokenHealth: 'unbound' as const };
        const modelCount = modelCounts.get(item.id) ?? 0;
        return {
          ...item,
          aihubUserId: binding?.newApiUserId ?? null,
          bindingStatus: binding?.status ?? 'missing',
          health: summarizeHealth({
            bindingStatus: binding?.status,
            masterinoBanned: item.status === '禁用',
            modelCount,
            newApiUserId: binding?.newApiUserId,
            tokenHealth: token.tokenHealth,
          }),
          managedTokenId: binding?.managedTokenId ?? null,
          modelCount,
          tokenHealth: token.tokenHealth,
        };
      }),
    );
  }

  async getUser(userId: string) {
    const [user, profile, binding, models] = await Promise.all([
      this.db.query.users.findFirst({ where: eq(users.id, userId) }),
      this.db.query.enterpriseUserProfiles.findFirst({
        where: eq(enterpriseUserProfiles.userId, userId),
      }),
      this.db.query.newApiBindings.findFirst({ where: eq(newApiBindings.userId, userId) }),
      this.db.query.aiModels.findMany({
        columns: { id: true, updatedAt: true },
        orderBy: [desc(aiModels.updatedAt)],
        where: and(
          eq(aiModels.userId, userId),
          eq(aiModels.providerId, ModelProvider.NewAPI),
          eq(aiModels.enabled, true),
          eq(aiModels.type, 'chat'),
        ),
      }),
    ]);
    if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'User was not found' });

    const account =
      binding?.newApiUserId && this.bridge.isEnabled()
        ? await this.bridge.findUserById(binding.newApiUserId).catch(() => undefined)
        : undefined;
    let accountSummary: Awaited<ReturnType<NewApiService['getAccountSummary']>> | undefined;
    if (binding?.newApiUserId) {
      try {
        accountSummary = await new NewApiService({
          db: this.db,
          readOnlyDb: this.bridge,
          userId,
        }).getAccountSummary();
      } catch {
        // Diagnostics remain usable when the upstream status endpoint is unavailable.
      }
    }
    const token =
      binding?.newApiUserId && binding.managedTokenId
        ? await this.inspectToken(binding.newApiUserId, binding.managedTokenId)
        : { tokenHealth: 'unbound' as const };
    const modelCount = models.length;
    const quotaPolicy = accountSummary?.quotaPolicy ?? {
      quotaDisplayType: 'CNY' as const,
      quotaPerUnit: Number(process.env.AIHUB_QUOTA_PER_UNIT) || 500_000,
      usdExchangeRate: Number(process.env.AIHUB_USD_EXCHANGE_RATE) || 7.12,
    };
    return {
      aihub: account
        ? {
            group: account.group ?? null,
            id: account.id,
            status: account.status ?? null,
            username: account.username ?? null,
            walletAmount: getNewApiQuotaAmount(account.quota, quotaPolicy)?.amount ?? null,
          }
        : null,
      quotaPolicy,
      binding: binding
        ? {
            errorCode: binding.errorCode,
            errorMessage: binding.errorMessage,
            iamStatus: binding.iamOAuthBindingStatus,
            lastSyncedAt: binding.lastSyncedAt,
            managedTokenId: binding.managedTokenId,
            readinessVersion: binding.readinessVersion,
            status: binding.status,
          }
        : null,
      health: summarizeHealth({
        aihubUserStatus: account?.status,
        bindingStatus: binding?.status,
        masterinoBanned: user.banned,
        modelCount,
        newApiUserId: binding?.newApiUserId,
        tokenHealth: token.tokenHealth,
        verifyAihubUser: true,
      }),
      masterino: {
        banned: Boolean(user.banned),
        employeeNumber: profile?.employeeNumber ?? null,
        email: user.email ?? null,
        id: user.id,
        name: user.fullName || user.username || user.email || user.id,
      },
      models: {
        count: modelCount,
        lastUpdatedAt: models[0]?.updatedAt ?? null,
      },
      token: {
        error: 'error' in token ? token.error : null,
        inspection: 'inspection' in token ? (token.inspection ?? null) : null,
        status: token.tokenHealth,
      },
    };
  }

  private async getBoundIdentifiers(userId: string) {
    const binding = await this.db.query.newApiBindings.findFirst({
      where: eq(newApiBindings.userId, userId),
    });
    if (!binding?.newApiUserId || !binding.managedTokenId)
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'User has no bound Aihub token',
      });
    return { newApiUserId: binding.newApiUserId, tokenId: binding.managedTokenId };
  }

  async updateBoundToken(userId: string, patch: BoundTokenPatch): Promise<BoundTokenInspection> {
    const { newApiUserId, tokenId } = await this.getBoundIdentifiers(userId);
    const result = await this.bridge.updateBoundToken(newApiUserId, tokenId, patch);
    if (!result) throw new TRPCError({ code: 'NOT_FOUND', message: 'Bound token was not found' });
    if (['deleted', 'missing', 'owner_mismatch'].includes(result.availability)) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: `Bound token cannot be edited: ${result.availability}`,
      });
    }
    return redactInspection(result)!;
  }

  async syncBoundModels(userId: string) {
    await this.getBoundIdentifiers(userId);
    return new NewApiService({ db: this.db, readOnlyDb: this.bridge, userId }).syncBoundModels();
  }
}
