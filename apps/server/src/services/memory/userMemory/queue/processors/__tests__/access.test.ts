import { MemorySourceType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { personaUpdateHandler } from '../personaUpdate';
import { processTopicHandler } from '../processTopic';
import { processTopicsHandler } from '../processTopics';
import { processUsersHandler } from '../processUsers';
import { processUserTopicsHandler } from '../processUserTopics';

const {
  mockComposeWriting,
  mockCreateExecutor,
  mockExtractTopic,
  mockIsPersonalMemoryEnabled,
  mockTriggerPersonaUpdate,
  mockTriggerProcessTopics,
  mockTriggerTopicFlow,
  mockTriggerProcessUserTopics,
  mockUpdateTopicMetadata,
} = vi.hoisted(() => ({
  mockComposeWriting: vi.fn(),
  mockCreateExecutor: vi.fn(),
  mockExtractTopic: vi.fn(),
  mockIsPersonalMemoryEnabled: vi.fn(),
  mockTriggerPersonaUpdate: vi.fn(),
  mockTriggerProcessTopics: vi.fn(),
  mockTriggerTopicFlow: vi.fn(),
  mockTriggerProcessUserTopics: vi.fn(),
  mockUpdateTopicMetadata: vi.fn(),
}));

vi.mock('@/database/models/asyncTask', () => ({
  AsyncTaskModel: vi.fn(() => ({
    incrementUserMemoryExtractionProgress: vi.fn(),
    isUserMemoryExtractionCancellationRequested: vi.fn().mockResolvedValue(false),
  })),
}));

vi.mock('@/database/server', () => ({
  getServerDB: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(() => ({ updateMetadata: mockUpdateTopicMetadata })),
}));

vi.mock('@/server/services/memory/userMemory/access', () => ({
  isPersonalMemoryEnabled: mockIsPersonalMemoryEnabled,
}));

vi.mock('@/server/services/memory/userMemory/extract', () => ({
  MemoryExtractionExecutor: {
    create: mockCreateExecutor,
  },
  buildWorkflowPayloadInput: vi.fn((payload) => payload),
  normalizeMemoryExtractionPayload: vi.fn((payload) => payload),
}));

vi.mock('@/server/services/memory/userMemory/queue/service', () => ({
  MemoryExtractionQueueService: {
    triggerPersonaUpdate: mockTriggerPersonaUpdate,
    triggerProcessTopics: mockTriggerProcessTopics,
    triggerTopicFlow: mockTriggerTopicFlow,
    triggerProcessUserTopics: mockTriggerProcessUserTopics,
  },
}));

vi.mock('@/server/services/memory/userMemory/persona/service', () => ({
  UserPersonaService: vi.fn(() => ({ composeWriting: mockComposeWriting })),
  buildUserPersonaJobInput: vi.fn().mockResolvedValue({ username: 'Test User' }),
}));

const basePayload = {
  baseUrl: 'https://example.com',
  forceAll: false,
  forceTopics: false,
  from: undefined,
  layers: [],
  mode: 'workflow' as const,
  sources: [MemorySourceType.ChatTopic],
  to: undefined,
  topicIds: ['topic-1'],
  userIds: ['user-1'],
  userInitiated: true,
};

const createContext = (payload: Record<string, unknown>) =>
  ({
    invoke: vi.fn(),
    requestPayload: payload,
    run: vi.fn(async (_name: string, callback: () => unknown) => callback()),
  }) as any;

describe('queued memory workflow access checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPersonalMemoryEnabled.mockResolvedValue(true);
    mockExtractTopic.mockResolvedValue({
      extracted: true,
      layers: {},
      memoryIds: [],
    });
    mockCreateExecutor.mockResolvedValue({
      extractTopic: mockExtractTopic,
      getTopics: vi.fn(),
    });
    mockTriggerPersonaUpdate.mockResolvedValue({ jobId: 'persona-job' });
    mockTriggerProcessTopics.mockResolvedValue({ jobId: 'topics-job' });
    mockTriggerTopicFlow.mockResolvedValue({
      jobId: 'persona-parent-job',
      topicJobIds: ['topic-job'],
    });
    mockTriggerProcessUserTopics.mockResolvedValue({ jobId: 'users-job' });
  });

  it('rejects workspace payloads at the user fan-out entry', async () => {
    const context = createContext({ ...basePayload, workspaceId: 'workspace-1' });

    const result = await processUsersHandler(context);

    expect(result).toEqual({ message: 'Workspace memory extraction is disabled.' });
    expect(mockCreateExecutor).not.toHaveBeenCalled();
    expect(mockTriggerProcessUserTopics).not.toHaveBeenCalled();
  });

  it('does not enqueue topic batches after the user disables memory', async () => {
    mockIsPersonalMemoryEnabled.mockResolvedValue(false);
    const context = createContext(basePayload);

    await processUserTopicsHandler(context);

    expect(mockTriggerProcessTopics).not.toHaveBeenCalled();
  });

  it('does not enqueue a topic flow when memory is disabled before a topic batch', async () => {
    mockIsPersonalMemoryEnabled.mockResolvedValue(false);
    const context = createContext(basePayload);

    const result = await processTopicsHandler(context);

    expect(result).toMatchObject({ processedTopics: 0, processedUsers: 0 });
    expect(mockTriggerTopicFlow).not.toHaveBeenCalled();
  });

  it('rechecks consent between CEPA and identity extraction', async () => {
    mockIsPersonalMemoryEnabled.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const context = createContext(basePayload);

    const result = await processTopicHandler(context);

    expect(result).toEqual({ message: 'Memory was disabled before identity extraction.' });
    expect(mockExtractTopic).toHaveBeenCalledTimes(1);
  });

  it('records a failed topic so hourly extraction can back off', async () => {
    mockExtractTopic.mockRejectedValueOnce(new Error('Embedding model unavailable'));

    await expect(processTopicHandler(createContext(basePayload))).rejects.toThrow(
      'Embedding model unavailable',
    );
    expect(mockUpdateTopicMetadata).toHaveBeenCalledWith(
      'topic-1',
      expect.objectContaining({
        userMemoryExtractRunState: expect.objectContaining({
          error: 'Embedding model unavailable',
          lastRunAt: expect.any(String),
        }),
        userMemoryExtractStatus: 'failed',
      }),
    );
  });

  it('skips queued persona writing after memory is disabled', async () => {
    mockIsPersonalMemoryEnabled.mockResolvedValue(false);
    const context = createContext({ userIds: ['user-1'] });

    const result = await personaUpdateHandler(context);

    expect(result).toMatchObject({ processedUsers: 0, skippedUsers: 1 });
    expect(mockComposeWriting).not.toHaveBeenCalled();
  });
});
