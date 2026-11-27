import { ChatErrorType } from '@lobechat/types';
import { NextResponse } from 'next/server';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { filterAihubModels } from '@/server/services/modelCatalog/availability';
import { ModelCatalogRepository } from '@/server/services/modelCatalog/repository';
import { createErrorResponse } from '@/utils/errorResponse';

import { resolveValidWorkspaceIdFromRequest } from '../../_utils/workspace';

const createModelListErrorResponse = (provider: string, e: unknown) => {
  console.error('[models] Provider model listing failed', {
    errorName: e instanceof Error ? e.name : 'ProviderError',
    provider,
  });

  return createErrorResponse(ChatErrorType.InternalServerError, {
    message: 'Provider unavailable',
    provider,
  });
};

export const GET = checkAuth(async (req, { params, userId, serverDB }) => {
  const provider = (await params)!.provider!;

  try {
    const workspaceId = await resolveValidWorkspaceIdFromRequest({ req, serverDB, userId });

    // Read user's provider config from database
    const agentRuntime = await initModelRuntimeFromDB(serverDB, userId, provider, workspaceId, {
      allowEnvironmentFallback: false,
    });

    const models = await agentRuntime.models();
    const list =
      provider === 'newapi' && models
        ? filterAihubModels(models, await new ModelCatalogRepository(serverDB).settings())
        : models;

    return NextResponse.json(list);
  } catch (e) {
    return createModelListErrorResponse(provider, e);
  }
});
