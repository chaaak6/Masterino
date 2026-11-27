import type { ModelRuntime } from '@lobechat/model-runtime';
import { TRPCError } from '@trpc/server';
import { ModelProvider } from 'model-bank';

import type { LobeChatDatabase } from '@/database/type';
import { NewApiService } from '@/server/services/newApi';

import { getExcludedAihubModelIds } from './availability';
import { ModelCatalogRepository } from './repository';

const modelCallMethods = new Set([
  'chat',
  'generateObject',
  'embeddings',
  'createImage',
  'createVideo',
  'textToSpeech',
]);
/** Specs can be frozen for an operation; authorization is checked at every new upstream call. */
export const withCurrentModelAccess = (
  runtime: ModelRuntime,
  db: LobeChatDatabase,
  userId: string,
  provider: string,
  credential?: string,
): ModelRuntime => {
  if (provider !== ModelProvider.NewAPI) return runtime;
  return new Proxy(runtime, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== 'function') return value;
      if (!modelCallMethods.has(String(property))) return value.bind(target);
      return async (payload: { model?: string }, ...args: unknown[]) => {
        if (!payload.model) return value.apply(target, [payload, ...args]);
        const settings = await new ModelCatalogRepository(db).settings();
        if (getExcludedAihubModelIds(settings).has(payload.model))
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: '该 Aihub 模型已下架，请选择其他模型。',
          });
        if (process.env.MASTERINO_MODEL_CATALOG_ENABLED !== 'false' && settings.enabled) {
          if (!credential)
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: 'Managed Aihub credential is unavailable',
            });
          await new NewApiService({ db, userId }).assertCurrentModelAccess(
            payload.model,
            credential,
          );
        }
        return value.apply(target, [payload, ...args]);
      };
    },
  });
};
