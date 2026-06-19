import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { requireAihubManage } from '@/server/services/enterprise/adminPermissionService';
import { NewApiService } from '@/server/services/newApi';

const newApiProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

  return next({
    ctx: {
      newApiService: new NewApiService({
        db: ctx.serverDB,
        gateKeeper,
        userId: ctx.userId,
      }),
    },
  });
});

const bindingImportRowSchema = z.object({
  email: z.string().email().optional(),
  lobeUserId: z.string().min(1).optional(),
  newApiAccessToken: z.string().min(1).optional(),
  newApiUserId: z.coerce.number().int().positive().optional(),
  username: z.string().min(1).optional(),
});

export const newApiRouter = router({
  getAccountSummary: newApiProcedure.query(async ({ ctx }) => {
    return ctx.newApiService.getAccountSummary();
  }),

  getBindingStatus: newApiProcedure.query(async ({ ctx }) => {
    return ctx.newApiService.getBindingStatus();
  }),

  getUsageSummary: newApiProcedure
    .input(
      z
        .object({
          endTimestamp: z.number().int().positive().optional(),
          startTimestamp: z.number().int().positive().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return ctx.newApiService.getUsageSummary(input);
    }),

  importBindings: newApiProcedure
    .input(z.object({ rows: z.array(bindingImportRowSchema).min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireAihubManage(ctx);
      return ctx.newApiService.importBindings(input.rows);
    }),

  syncModels: newApiProcedure.mutation(async ({ ctx }) => {
    return ctx.newApiService.syncModels();
  }),

  validateBinding: newApiProcedure.input(bindingImportRowSchema).mutation(async ({ ctx, input }) => {
    await requireAihubManage(ctx);
    return ctx.newApiService.validateBinding(input);
  }),
});

export type NewApiRouter = typeof newApiRouter;
