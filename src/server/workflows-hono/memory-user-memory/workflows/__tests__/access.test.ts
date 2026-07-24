import { MemorySourceType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { personaUpdateHandler } from '../personaUpdate';
import { processTopicWorkflow } from '../processTopic';
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
  mockTriggerProcessUserTopics,
} = vi.hoisted(() => ({
  mockComposeWriting: vi.fn(),
  mockCreateExecutor: vi.fn(),
  mockExtractTopic: vi.fn(),
  mockIsPersonalMemoryEnabled: vi.fn(),
  mockTriggerPersonaUpdate: vi.fn(),
  mockTriggerProcessTopics: vi.fn(),
  mockTriggerProcessUserTopics: vi.fn(),
}));

vi.mock('@lobechat/observability-otel/modules/upstash-workflow', () => ({
  buildUpstashWorkflowAttributes: vi.fn(() => ({})),
  tracer: {
    startActiveSpan: vi.fn(async (_name, callback) =>
      callback({
        end: vi.fn(),
        recordException: vi.fn(),
        setAttributes: vi.fn(),
        setStatus: vi.fn(),
      }),
    ),
  },
}));

vi.mock('@upstash/workflow/hono', () => ({
  createWorkflow: vi.fn((handler) => handler),
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

vi.mock('@/server/globalConfig/parseMemoryExtractionConfig', () => ({
  parseMemoryExtractionConfig: vi.fn(() => ({ upstashWorkflowExtraHeaders: {} })),
}));

vi.mock('@/server/services/memory/userMemory/access', () => ({
  isPersonalMemoryEnabled: mockIsPersonalMemoryEnabled,
}));

vi.mock('@/server/services/memory/userMemory/extract', () => ({
  MemoryExtractionExecutor: {
    create: mockCreateExecutor,
  },
  MemoryExtractionWorkflowService: {
    triggerPersonaUpdate: mockTriggerPersonaUpdate,
    triggerProcessTopics: mockTriggerProcessTopics,
    triggerProcessUserTopics: mockTriggerProcessUserTopics,
  },
  buildWorkflowPayloadInput: vi.fn((payload) => payload),
  normalizeMemoryExtractionPayload: vi.fn((payload) => payload),
}));

vi.mock('@/server/services/memory/userMemory/persona/service', () => ({
  UserPersonaService: vi.fn(() => ({ composeWriting: mockComposeWriting })),
  buildUserPersonaJobInput: vi.fn().mockResolvedValue({ username: 'Test User' }),
}));

vi.mock('../../../qstashClient', () => ({
  createWorkflowQstashClient: vi.fn(() => ({})),
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
    mockTriggerPersonaUpdate.mockResolvedValue({ workflowRunId: 'persona-run' });
    mockTriggerProcessTopics.mockResolvedValue({ workflowRunId: 'topics-run' });
    mockTriggerProcessUserTopics.mockResolvedValue({ workflowRunId: 'users-run' });
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

  it('does not invoke topics or persona when memory is disabled before a topic batch', async () => {
    mockIsPersonalMemoryEnabled.mockResolvedValue(false);
    const context = createContext(basePayload);

    const result = await processTopicsHandler(context);

    expect(result).toMatchObject({ processedTopics: 0, processedUsers: 0 });
    expect(context.invoke).not.toHaveBeenCalled();
    expect(mockTriggerPersonaUpdate).not.toHaveBeenCalled();
  });

  it('rechecks consent between CEPA and identity extraction', async () => {
    mockIsPersonalMemoryEnabled.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const context = createContext(basePayload);

    const result = await (processTopicWorkflow as any)(context);

    expect(result).toEqual({ message: 'Memory was disabled before identity extraction.' });
    expect(mockExtractTopic).toHaveBeenCalledTimes(1);
  });

  it('skips queued persona writing after memory is disabled', async () => {
    mockIsPersonalMemoryEnabled.mockResolvedValue(false);
    const context = createContext({ userIds: ['user-1'] });

    const result = await personaUpdateHandler(context);

    expect(result).toMatchObject({ processedUsers: 0, skippedUsers: 1 });
    expect(mockComposeWriting).not.toHaveBeenCalled();
  });
});
