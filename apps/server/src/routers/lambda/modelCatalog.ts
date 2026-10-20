import { ManagedModelDescriptionSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  requireAdminAccess,
  requireAihubManage,
} from '@/server/services/enterprise/adminPermissionService';
import { createEffectiveModelCatalog } from '@/server/services/modelCatalog';
import { ModelCatalogRepository } from '@/server/services/modelCatalog/repository';
import { NewApiBridgeClient } from '@/server/services/newApi/bridgeClient';
import { NewApiClient } from '@/server/services/newApi/client';
import { buildAihubPricing, resolveAihubDisplayPricing } from '@/server/services/newApi/pricing';

const modelId = z.string().trim().min(1).max(150);
const versionInput = z.object({
  modelId,
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(2000),
});
const read = authedProcedure.use(serverDatabase);
const manage = read.use(async ({ ctx, next }) => {
  await requireAdminAccess(ctx);
  const actor = await requireAihubManage(ctx);
  return next({
    ctx: { actorId: actor.userId, catalog: new ModelCatalogRepository(ctx.serverDB) },
  });
});

export const modelCatalogRouter = router({
  check: read
    .input(z.object({ knownRevision: z.string().max(100).optional() }).optional())
    .query(({ ctx, input }) =>
      createEffectiveModelCatalog(ctx.serverDB, ctx.userId).read(input?.knownRevision),
    ),
  list: manage.query(async ({ ctx }) => ({
    records: await ctx.catalog.list(),
    settings: await ctx.catalog.settings(),
  })),
  pricing: manage.input(z.object({ modelId })).query(async ({ input }) => {
    const baseUrl = process.env.AIHUB_PROXY_URL;
    if (!baseUrl)
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'AIHUB_PROXY_URL is required' });
    const client = new NewApiClient({ baseUrl });
    const [response, status] = await Promise.all([client.getPricing(), client.getStatus()]);
    return resolveAihubDisplayPricing(
      buildAihubPricing(input.modelId, {
        response,
        status,
        scope: 'public',
        fetchedAt: new Date().toISOString(),
      }),
    );
  }),
  discover: manage.query(() => new NewApiBridgeClient().listAvailableModelIds()),
  history: manage
    .input(z.object({ modelId }))
    .query(({ ctx, input }) => ctx.catalog.history(input.modelId)),
  saveDraft: manage
    .input(
      z.object({
        modelId,
        expectedVersion: z.number().int().nonnegative(),
        draft: ManagedModelDescriptionSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.catalog.save(ctx.actorId, input.modelId, input.expectedVersion, input.draft),
    ),
  publish: manage
    .input(versionInput)
    .mutation(({ ctx, input }) =>
      ctx.catalog.publish(ctx.actorId, input.modelId, input.expectedVersion, input.reason),
    ),
  rollback: manage
    .input(versionInput.extend({ revision: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      ctx.catalog.publish(
        ctx.actorId,
        input.modelId,
        input.expectedVersion,
        input.reason,
        input.revision,
      ),
    ),
  updateSettings: manage
    .input(z.object({ enabled: z.boolean(), silentRefreshEnabled: z.boolean() }))
    .mutation(({ ctx, input }) => ctx.catalog.updateSettings(ctx.actorId, input)),
});
