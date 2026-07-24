import { MemorySourceType } from '@lobechat/types';
import { type WorkflowContext } from '@upstash/workflow';
import { chunk } from 'es-toolkit/compat';

import { appEnv } from '@/envs/app';
import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import {
  buildWorkflowPayloadInput,
  MemoryExtractionExecutor,
  type MemoryExtractionHourlyWorkflowPayload,
  MemoryExtractionWorkflowService,
  normalizeMemoryExtractionPayload,
} from '@/server/services/memory/userMemory/extract';

const USER_PAGE_SIZE = 200;
const USER_BATCH_SIZE = 20;

const { webhook, upstashWorkflowExtraHeaders } = parseMemoryExtractionConfig();

const resolveBaseUrl = () => webhook.baseUrl || appEnv.INTERNAL_APP_URL || appEnv.APP_URL;

export const hourlyWorkflowHandler = async (
  context: WorkflowContext<MemoryExtractionHourlyWorkflowPayload>,
) => {
  const { cursor, dryRun } = context.requestPayload || {};

  const baseUrl = resolveBaseUrl();
  if (!baseUrl) {
    throw new Error('Missing baseUrl for hourly memory extraction workflow');
  }

  const parsedCursor = cursor
    ? { createdAt: new Date(cursor.createdAt), id: cursor.id }
    : undefined;
  if (parsedCursor && Number.isNaN(parsedCursor.createdAt.getTime())) {
    throw new Error('Invalid cursor date for hourly memory extraction workflow');
  }

  const executor = await MemoryExtractionExecutor.create();
  const userBatch = await context.run(
    `memory:user-memory:hourly:list-users:${parsedCursor?.id || 'root'}`,
    () => executor.getUsersForHourlyExtraction(USER_PAGE_SIZE, parsedCursor),
  );

  const nextCursor = userBatch.cursor
    ? {
        createdAt: userBatch.cursor.createdAt.toISOString(),
        id: userBatch.cursor.id,
      }
    : undefined;

  const userIds = await context.run(
    `memory:user-memory:hourly:filter-runtime-rollout:${parsedCursor?.id || 'root'}`,
    async () => {
      const checks = await Promise.all(
        userBatch.ids.map(async (userId) => ({
          enabled:
            (await getServerFeatureFlagsStateFromRuntimeConfig(userId)).enableMemory === true,
          userId,
        })),
      );

      return checks.filter((item) => item.enabled).map((item) => item.userId);
    },
  );

  if (userIds.length === 0) {
    if (nextCursor) {
      await context.run('memory:user-memory:hourly:schedule-next-page', () =>
        MemoryExtractionWorkflowService.triggerHourly(
          { baseUrl, cursor: nextCursor, dryRun },
          { extraHeaders: upstashWorkflowExtraHeaders },
        ),
      );
    }

    return {
      hasNextPage: !!nextCursor,
      message: 'No eligible users for hourly memory extraction.',
      processedUsers: 0,
    };
  }

  if (!dryRun) {
    const batches = chunk(userIds, USER_BATCH_SIZE);
    await Promise.all(
      batches.map((batchUserIds, index) =>
        context.run(`memory:user-memory:hourly:trigger-users:${index}`, () =>
          MemoryExtractionWorkflowService.triggerProcessUsers(
            buildWorkflowPayloadInput(
              normalizeMemoryExtractionPayload({
                baseUrl,
                mode: 'workflow',
                sources: [MemorySourceType.ChatTopic],
                userIds: batchUserIds,
              }),
            ),
            { extraHeaders: upstashWorkflowExtraHeaders },
          ),
        ),
      ),
    );
  }

  if (nextCursor) {
    await context.run('memory:user-memory:hourly:schedule-next-page', () =>
      MemoryExtractionWorkflowService.triggerHourly(
        {
          baseUrl,
          cursor: nextCursor,
          dryRun,
        },
        { extraHeaders: upstashWorkflowExtraHeaders },
      ),
    );
  }

  return {
    dryRun: !!dryRun,
    hasNextPage: !!nextCursor,
    processedUsers: userIds.length,
    scheduledBatches: dryRun ? 0 : chunk(userIds, USER_BATCH_SIZE).length,
  };
};

export const hourlyWorkflowOptions = {
  flowControl: {
    key: 'memory-user-memory.call-cron-hourly-analysis',
    parallelism: 1,
    ratePerSecond: 1,
  },
};
