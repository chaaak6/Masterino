import type { Job } from 'bullmq';
import { Worker } from 'bullmq';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { getServerDB } from '@/database/server';
import { AsyncTaskError, AsyncTaskErrorType, AsyncTaskStatus } from '@/types/asyncTask';

import type {
  MemoryExtractionHourlyWorkflowPayload,
  MemoryExtractionPayloadInput,
} from '../extract';
import { createMemoryQueueWorkerConnection, getMemoryQueuePrefix } from './connection';
import { MEMORY_QUEUE_JOB_NAMES, MEMORY_QUEUE_NAME, type MemoryQueueJobName } from './constants';
import { createMemoryQueueContext } from './context';
import {
  hourlyWorkflowHandler,
  personaUpdateHandler,
  processTopicHandler,
  processTopicsHandler,
  processUsersHandler,
  processUserTopicsHandler,
} from './processors';
import { closeMemoryQueueClients, MemoryExtractionQueueService } from './service';
import type { MemoryPersonaQueuePayload, MemoryQueueJobData } from './types';

let memoryWorker: Worker<MemoryQueueJobData, unknown, MemoryQueueJobName> | undefined;

const resolveConcurrency = () => {
  const value = Number(process.env.MEMORY_USER_MEMORY_CONCURRENCY || 1);

  if (!Number.isInteger(value) || value < 1) {
    throw new Error('MEMORY_USER_MEMORY_CONCURRENCY must be a positive integer');
  }

  return value;
};

const ensureQueueRunId = <T extends { queueRunId?: string }>(job: Job<T>) => ({
  ...job.data,
  queueRunId: job.data.queueRunId || job.id,
});

const processMemoryJob = async (job: Job<MemoryQueueJobData, unknown, MemoryQueueJobName>) => {
  switch (job.name) {
    case MEMORY_QUEUE_JOB_NAMES.hourly: {
      return hourlyWorkflowHandler(
        createMemoryQueueContext(
          ensureQueueRunId(job as Job<MemoryExtractionHourlyWorkflowPayload>),
        ),
      );
    }
    case MEMORY_QUEUE_JOB_NAMES.processUsers: {
      return processUsersHandler(
        createMemoryQueueContext(ensureQueueRunId(job as Job<MemoryExtractionPayloadInput>)),
      );
    }
    case MEMORY_QUEUE_JOB_NAMES.processUserTopics: {
      return processUserTopicsHandler(
        createMemoryQueueContext(ensureQueueRunId(job as Job<MemoryExtractionPayloadInput>)),
      );
    }
    case MEMORY_QUEUE_JOB_NAMES.processTopics: {
      return processTopicsHandler(
        createMemoryQueueContext(ensureQueueRunId(job as Job<MemoryExtractionPayloadInput>)),
      );
    }
    case MEMORY_QUEUE_JOB_NAMES.processTopic: {
      return processTopicHandler(
        createMemoryQueueContext(ensureQueueRunId(job as Job<MemoryExtractionPayloadInput>)),
      );
    }
    case MEMORY_QUEUE_JOB_NAMES.personaUpdate: {
      return personaUpdateHandler(
        createMemoryQueueContext(ensureQueueRunId(job as Job<MemoryPersonaQueuePayload>)),
      );
    }
    default: {
      throw new Error(`Unsupported memory queue job: ${job.name}`);
    }
  }
};

export const markJobFailed = async (
  job: Job<MemoryQueueJobData, unknown, MemoryQueueJobName> | undefined,
  error: Error,
) => {
  const data = job?.data as
    | { asyncTaskId?: string; userId?: string; userIds?: string[]; workspaceId?: string }
    | undefined;
  const asyncTaskId = data?.asyncTaskId;
  const userId = data?.userId || data?.userIds?.[0];
  if (!asyncTaskId || !userId) return;

  try {
    const db = await getServerDB();
    await new AsyncTaskModel(db, userId, data?.workspaceId).update(asyncTaskId, {
      error: new AsyncTaskError(AsyncTaskErrorType.ServerError, error.message),
      status: AsyncTaskStatus.Error,
    });
  } catch (taskError) {
    console.error('[memory-queue] failed to mark async task as failed', taskError);
  }
};

export const hasExhaustedMemoryJobAttempts = (
  job: Pick<Job, 'attemptsMade' | 'opts'> | undefined,
) => !job || job.attemptsMade >= (job.opts.attempts ?? 1);

export const startMemoryQueueWorker = async () => {
  if (memoryWorker) return memoryWorker;

  memoryWorker = new Worker<MemoryQueueJobData, unknown, MemoryQueueJobName>(
    MEMORY_QUEUE_NAME,
    processMemoryJob,
    {
      concurrency: resolveConcurrency(),
      connection: createMemoryQueueWorkerConnection(),
      prefix: getMemoryQueuePrefix(),
    },
  );

  memoryWorker.on('error', (error) => {
    console.error('[memory-queue] worker error', error);
  });
  memoryWorker.on('failed', (job, error) => {
    console.error(`[memory-queue] job ${job?.id || 'unknown'} failed`, error);
    if (hasExhaustedMemoryJobAttempts(job)) {
      void markJobFailed(job, error);
    }
  });

  await memoryWorker.waitUntilReady();

  if (process.env.MEMORY_QUEUE_SCHEDULER_ENABLED === '1') {
    await MemoryExtractionQueueService.ensureHourlyScheduler();
  } else {
    await MemoryExtractionQueueService.disableHourlyScheduler();
  }

  return memoryWorker;
};

export const closeMemoryQueueWorker = async () => {
  const worker = memoryWorker;
  memoryWorker = undefined;
  await worker?.close();
  await closeMemoryQueueClients();
};
