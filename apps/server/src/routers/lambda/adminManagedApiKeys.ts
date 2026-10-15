import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { ManagedApiKeyModel } from '@/database/models/managedApiKey';
import { enterpriseAuditLogs } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { requireAdminAccess } from '@/server/services/enterprise/adminPermissionService';

const procedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  const admin = await requireAdminAccess(ctx);
  return next({
    ctx: { managedKeyModel: new ManagedApiKeyModel(ctx.serverDB), managedKeyActorId: admin.userId },
  });
});
const idInput = z.object({ id: z.string().min(1) });
const audit = (db: LobeChatDatabase, actor: string, action: string, id: string) =>
  db
    .insert(enterpriseAuditLogs)
    .values({ actorUserId: actor, action, targetId: id, targetType: 'api_key', result: 'success' });
async function managedAction<T>(action: () => Promise<T>) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof Error && error.message === 'Managed API key not found')
      throw new TRPCError({ code: 'NOT_FOUND', message: '访问 Key 不存在' });
    throw error;
  }
}
export const adminManagedApiKeysRouter = router({
  list: procedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
        q: z.string().trim().optional(),
      }),
    )
    .query(({ ctx, input }) => ctx.managedKeyModel.list(input)),
  create: procedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(256),
        description: z.string().trim().max(1000).optional(),
        expiresAt: z
          .date()
          .nullable()
          .optional()
          .refine((value) => !value || value.getTime() > Date.now(), '请选择未来的有效期'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.managedKeyModel.create(ctx.managedKeyActorId, input);
      await audit(ctx.serverDB, ctx.managedKeyActorId, 'api_key.create', result.id);
      return result;
    }),
  reveal: procedure.input(idInput).mutation(async ({ ctx, input }) => {
    const key = await managedAction(() => ctx.managedKeyModel.reveal(input.id));
    await audit(ctx.serverDB, ctx.managedKeyActorId, 'api_key.reveal', input.id);
    return { key };
  }),
  setEnabled: procedure
    .input(idInput.extend({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const result = await managedAction(() =>
        ctx.managedKeyModel.setEnabled(input.id, input.enabled),
      );
      await audit(
        ctx.serverDB,
        ctx.managedKeyActorId,
        input.enabled ? 'api_key.enable' : 'api_key.disable',
        input.id,
      );
      return result;
    }),
  delete: procedure.input(idInput).mutation(async ({ ctx, input }) => {
    const result = await managedAction(() => ctx.managedKeyModel.delete(input.id));
    await audit(ctx.serverDB, ctx.managedKeyActorId, 'api_key.delete', input.id);
    return result;
  }),
});
