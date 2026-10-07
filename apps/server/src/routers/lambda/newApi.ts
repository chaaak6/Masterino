import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { requireAihubManage } from '@/server/services/enterprise/adminPermissionService';
import { NewApiService } from '@/server/services/newApi';
import { createAihubReadiness } from '@/server/services/newApi/readiness/production';

const newApiProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

  return next({
    ctx: {
      newApiService: new NewApiService({
        db: ctx.serverDB,
        gateKeeper,
        userId: ctx.userId,
      }),
      aihubReadiness: createAihubReadiness({
        db: ctx.serverDB,
        gateKeeper,
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
  getSubscriptionSummary: newApiProcedure.query(async ({ ctx }) => {
    return ctx.newApiService.getSubscriptionSummary();
  }),

  getAccountSummary: newApiProcedure.query(async ({ ctx }) => {
    return ctx.newApiService.getAccountSummary();
  }),

  getBindingStatus: newApiProcedure.query(async ({ ctx }) => {
    return ctx.aihubReadiness.get(ctx.userId);
  }),

  ensureReadiness: newApiProcedure
    // `repairIamBinding` remains accepted for older clients. The unified
    // readiness workflow always reconciles IAM idempotently, so there is no
    // separate repair mode to pass through.
    .input(z.object({ repairIamBinding: z.boolean().optional() }).optional())
    .mutation(async ({ ctx }) => {
      return ctx.aihubReadiness.ensure(ctx.userId, {
        force: true,
        trigger: 'manual_retry',
      });
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

  rebindCurrentUser: newApiProcedure.mutation(async ({ ctx }) => {
    const state = await ctx.aihubReadiness.ensure(ctx.userId, {
      force: true,
      trigger: 'manual_retry',
    });
    const oauthBinding = state.oauthBinding ?? state.iamOAuthBinding ?? { status: 'unknown' };
    return {
      ...oauthBinding,
      repaired: oauthBinding.status === 'active',
    };
  }),

  importBindings: newApiProcedure
    .input(z.object({ rows: z.array(bindingImportRowSchema).min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireAihubManage(ctx);
      return ctx.newApiService.importBindings(input.rows);
    }),

  syncModels: newApiProcedure.mutation(async ({ ctx }) => {
    const state = await ctx.aihubReadiness.ensure(ctx.userId, {
      force: true,
      trigger: 'manual_model_sync',
    });
    if (state.status !== 'active') {
      throw new Error(state.errorMessage || 'Aihub readiness could not be established');
    }
    return { models: state.models ?? [] };
  }),

  validateBinding: newApiProcedure
    .input(bindingImportRowSchema)
    .mutation(async ({ ctx, input }) => {
      await requireAihubManage(ctx);
      return ctx.newApiService.validateBinding(input);
    }),
});

export type NewApiRouter = typeof newApiRouter;
