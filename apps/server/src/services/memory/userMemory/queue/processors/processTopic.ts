import { LayersEnum, MemorySourceType } from '@lobechat/types';
import { errorMessageFrom } from '@lobechat/utils';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { TopicModel } from '@/database/models/topic';
import { getServerDB } from '@/database/server';
import { isPersonalMemoryEnabled } from '@/server/services/memory/userMemory/access';
import { AsyncTaskError, AsyncTaskErrorType, AsyncTaskStatus } from '@/types/asyncTask';

import {
  MemoryExtractionExecutor,
  type MemoryExtractionPayloadInput,
  normalizeMemoryExtractionPayload,
} from '../../extract';
import { type MemoryQueueContext } from '../context';

const CEPA_LAYERS: LayersEnum[] = [
  LayersEnum.Context,
  LayersEnum.Experience,
  LayersEnum.Preference,
  LayersEnum.Activity,
];
const IDENTITY_LAYERS: LayersEnum[] = [LayersEnum.Identity];

const isCancellationRequested = async (
  userId: string,
  asyncTaskId: string,
  workspaceId?: string,
) => {
  const db = await getServerDB();
  return new AsyncTaskModel(db, userId, workspaceId).isUserMemoryExtractionCancellationRequested(
    asyncTaskId,
  );
};

export const processTopicHandler = async (
  context: MemoryQueueContext<MemoryExtractionPayloadInput>,
) => {
  const payload = normalizeMemoryExtractionPayload(context.requestPayload || {});
  const topicId = payload.topicIds[0];
  const userId = payload.userIds[0];

  if (!userId || !topicId) {
    return { message: 'Missing userId or topicId for topic workflow.' };
  }
  if (!payload.sources.includes(MemorySourceType.ChatTopic)) {
    return { message: 'Source not supported in topic workflow.' };
  }
  if (payload.workspaceId) {
    return { message: 'Workspace memory extraction is disabled.' };
  }

  const memoryEnabled = await context.run(
    `memory:user-memory:extract:users:${userId}:topics:${topicId}:consent-check:before`,
    async () => {
      const db = await getServerDB();
      return isPersonalMemoryEnabled({ db, userId });
    },
  );
  if (!memoryEnabled) {
    return { message: 'Memory was disabled before topic processing.' };
  }

  const executor = await MemoryExtractionExecutor.create();

  try {
    if (
      payload.asyncTaskId &&
      (await context.run(
        `memory:user-memory:extract:users:${userId}:topics:${topicId}:cancel-check:before`,
        () => isCancellationRequested(userId, payload.asyncTaskId!, payload.workspaceId),
      ))
    ) {
      return { message: 'Memory extraction task cancellation requested, skip topic.' };
    }

    const cepaLayers = payload.layers.length
      ? payload.layers.filter((layer) => CEPA_LAYERS.includes(layer))
      : CEPA_LAYERS;

    await context.run(`memory:user-memory:extract:users:${userId}:topics:${topicId}:cepa`, () =>
      executor.extractTopic({
        asyncTaskId: payload.asyncTaskId,
        forceAll: payload.forceAll,
        forceTopics: payload.forceTopics,
        from: payload.from,
        layers: cepaLayers,
        reportProgress: false,
        source: MemorySourceType.ChatTopic,
        to: payload.to,
        topicId,
        userId,
        userInitiated: payload.userInitiated,
        workspaceId: payload.workspaceId,
      }),
    );

    const identityMemoryEnabled = await context.run(
      `memory:user-memory:extract:users:${userId}:topics:${topicId}:consent-check:identity`,
      async () => {
        const db = await getServerDB();
        return isPersonalMemoryEnabled({ db, userId });
      },
    );
    if (!identityMemoryEnabled) {
      return { message: 'Memory was disabled before identity extraction.' };
    }

    if (
      payload.asyncTaskId &&
      (await context.run(
        `memory:user-memory:extract:users:${userId}:topics:${topicId}:cancel-check:identity`,
        () => isCancellationRequested(userId, payload.asyncTaskId!, payload.workspaceId),
      ))
    ) {
      return {
        message: 'Memory extraction task cancellation requested, skip identity extraction.',
      };
    }

    const identityLayers = payload.layers.length
      ? payload.layers.filter((layer) => IDENTITY_LAYERS.includes(layer))
      : IDENTITY_LAYERS;

    await context.run(`memory:user-memory:extract:users:${userId}:topics:${topicId}:identity`, () =>
      executor.extractTopic({
        asyncTaskId: payload.asyncTaskId,
        forceAll: payload.forceAll,
        forceTopics: payload.forceTopics,
        from: payload.from,
        layers: identityLayers,
        reportProgress: false,
        source: MemorySourceType.ChatTopic,
        to: payload.to,
        topicId,
        userId,
        userInitiated: payload.userInitiated,
        workspaceId: payload.workspaceId,
      }),
    );

    if (payload.asyncTaskId && payload.userInitiated) {
      await context.run(
        `memory:user-memory:extract:users:${userId}:topics:${topicId}:progress`,
        () =>
          getServerDB().then((db) =>
            new AsyncTaskModel(
              db,
              userId,
              payload.workspaceId,
            ).incrementUserMemoryExtractionProgress(payload.asyncTaskId!),
          ),
      );
    }

    return {
      processedTopics: 1,
      processedUsers: 1,
      topicId,
      userId,
    };
  } catch (error) {
    try {
      const db = await getServerDB();
      await new TopicModel(db, userId, payload.workspaceId).updateMemoryExtractionMetadata(
        topicId,
        'failed',
        {
          error: (errorMessageFrom(error) || 'Memory topic extraction failed').slice(0, 500),
          lastRunAt: new Date().toISOString(),
        },
      );
    } catch (metadataError) {
      console.error('[memory-queue] failed to record topic extraction failure', metadataError);
    }

    if (payload.asyncTaskId && payload.userInitiated) {
      try {
        const db = await getServerDB();
        const asyncTaskModel = new AsyncTaskModel(db, userId, payload.workspaceId);
        await asyncTaskModel.update(payload.asyncTaskId, {
          error: new AsyncTaskError(
            AsyncTaskErrorType.ServerError,
            errorMessageFrom(error) || 'Memory topic extraction failed',
          ),
          status: AsyncTaskStatus.Error,
        });
        await asyncTaskModel.incrementUserMemoryExtractionProgress(payload.asyncTaskId);
      } catch (taskError) {
        console.error('[memory-queue] failed to record topic job failure', taskError);
      }
    }

    throw error;
  }
};
