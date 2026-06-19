import { TRPCError } from '@trpc/server';
import { ModelProvider } from 'model-bank';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AiProviderModel } from '@/database/models/aiProvider';
import { UserModel } from '@/database/models/user';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { type AiProviderDetailItem, type AiProviderRuntimeState } from '@/types/aiProvider';
import {
  CreateAiProviderSchema,
  UpdateAiProviderConfigSchema,
  UpdateAiProviderSchema,
} from '@/types/aiProvider';
import { type ProviderConfig } from '@/types/user/settings';

const assertNewApiProvider = (id: string) => {
  if (id !== ModelProvider.NewAPI) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This deployment only allows the Aihub provider',
    });
  }
};

const aiProviderProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  const { aiProvider } = await getServerGlobalConfig();

  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  return opts.next({
    ctx: {
      aiInfraRepos: new AiInfraRepos(
        ctx.serverDB,
        ctx.userId,
        aiProvider as Record<string, ProviderConfig>,
      ),
      aiProviderModel: new AiProviderModel(ctx.serverDB, ctx.userId),
      gateKeeper,
      userModel: new UserModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const aiProviderRouter = router({
  checkProviderConnectivity: aiProviderProcedure
    .use(withScopedPermission('ai_provider:update'))
    .input(
      z.object({
        id: z.string(),
        model: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Get the provider detail to find checkModel
      const detail = await ctx.aiInfraRepos.getAiProviderDetail(
        input.id,
        KeyVaultsGateKeeper.getUserKeyVaults,
      );

      const model = input.model || detail?.checkModel;
      if (!model) {
        return { error: 'No check model configured. Use --model to specify one.', ok: false };
      }

      try {
        const modelRuntime = await initModelRuntimeFromDB(
          ctx.serverDB,
          ctx.userId,
          input.id,
          ctx.workspaceId ?? undefined,
        );

        const response = await modelRuntime.chat({
          messages: [{ content: 'Hi', role: 'user' }],
          model,
          stream: false,
          temperature: 0,
        });

        // If we get a response without error, connectivity is ok
        if (response.ok) {
          return { model, ok: true };
        }

        const errorBody = await response.text();
        return { error: errorBody, model, ok: false, status: response.status };
      } catch (error: any) {
        const errorType = error.errorType || error.type;
        const msg = errorType
          ? errorType
          : typeof error === 'string'
            ? error
            : error.message || (typeof error === 'object' ? JSON.stringify(error) : String(error));
        return { error: msg, model, ok: false };
      }
    }),

  createAiProvider: aiProviderProcedure
    .use(withScopedPermission('ai_provider:create'))
    .input(CreateAiProviderSchema)
    .mutation(async () => {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Custom providers are disabled in this Aihub-only deployment',
      });
    }),

  getAiProviderById: aiProviderProcedure
    .input(z.object({ id: z.string() }))

    .query(async ({ input, ctx }): Promise<AiProviderDetailItem | undefined> => {
      assertNewApiProvider(input.id);
      return ctx.aiInfraRepos.getAiProviderDetail(input.id, KeyVaultsGateKeeper.getUserKeyVaults);
    }),

  getAiProviderList: aiProviderProcedure.query(async ({ ctx }) => {
    const list = await ctx.aiInfraRepos.getAiProviderList();
    return list.filter((item) => item.id === ModelProvider.NewAPI);
  }),

  getAiProviderRuntimeState: aiProviderProcedure
    .input(z.object({ isLogin: z.boolean().optional() }))
    .query(async ({ ctx }): Promise<AiProviderRuntimeState> => {
      return ctx.aiInfraRepos.getAiProviderRuntimeState(KeyVaultsGateKeeper.getUserKeyVaults);
    }),

  removeAiProvider: aiProviderProcedure
    .use(withScopedPermission('ai_provider:delete'))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      assertNewApiProvider(input.id);
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'The Aihub provider is managed by administrator bindings',
      });
    }),

  toggleProviderEnabled: aiProviderProcedure
    .use(withScopedPermission('ai_provider:update'))
    .input(
      z.object({
        enabled: z.boolean(),
        id: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      assertNewApiProvider(input.id);
      if (!input.enabled) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'The Aihub provider cannot be disabled',
        });
      }

      return ctx.aiProviderModel.toggleProviderEnabled(input.id, input.enabled);
    }),

  updateAiProvider: aiProviderProcedure
    .use(withScopedPermission('ai_provider:update'))
    .input(
      z.object({
        id: z.string(),
        value: UpdateAiProviderSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      assertNewApiProvider(input.id);
      return ctx.aiProviderModel.update(input.id, input.value);
    }),

  updateAiProviderConfig: aiProviderProcedure
    .use(withScopedPermission('ai_provider:update'))
    .input(
      z.object({
        id: z.string(),
        value: UpdateAiProviderConfigSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      assertNewApiProvider(input.id);
      if (input.value.keyVaults) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Aihub credentials are managed by administrator bindings',
        });
      }

      return ctx.aiProviderModel.updateConfig(
        input.id,
        input.value,
        ctx.gateKeeper.encrypt,
        KeyVaultsGateKeeper.getUserKeyVaults,
      );
    }),

  updateAiProviderOrder: aiProviderProcedure
    .use(withScopedPermission('ai_provider:update'))
    .input(
      z.object({
        sortMap: z.array(
          z.object({
            id: z.string(),
            sort: z.number(),
          }),
        ),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (input.sortMap.some((item) => item.id !== ModelProvider.NewAPI)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the Aihub provider can be ordered in this deployment',
        });
      }

      return ctx.aiProviderModel.updateOrder(input.sortMap);
    }),
});

export type AiProviderRouter = typeof aiProviderRouter;
