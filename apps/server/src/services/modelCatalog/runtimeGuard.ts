import type { ModelRuntime } from '@lobechat/model-runtime';
import { TRPCError } from '@trpc/server';
import { ModelProvider } from 'model-bank';

import type { LobeChatDatabase } from '@/database/type';
import { NewApiService } from '@/server/services/newApi';

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
  if (provider !== ModelProvider.NewAPI || process.env.MASTERINO_MODEL_CATALOG_ENABLED === 'false')
    return runtime;
  return new Proxy(runtime, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== 'function') return value;
      if (!modelCallMethods.has(String(property))) return value.bind(target);
      return async (payload: { model?: string }, ...args: unknown[]) => {
        if ((await new ModelCatalogRepository(db).settings()).enabled && payload.model) {
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
