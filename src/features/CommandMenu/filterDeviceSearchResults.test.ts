import { describe, expect, it, vi } from 'vitest';

import type { SearchResult } from '@/database/repositories/search';
import { lambdaClient } from '@/libs/trpc/client';
import {
  ProjectWorkspaceSeamUnavailableError,
  projectWorkspaceService,
} from '@/services/projectWorkspace';

import { filterDeviceSearchResults } from './filterDeviceSearchResults';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { topic: { getTopicDetail: { query: vi.fn() } } },
}));
vi.mock('@/services/projectWorkspace', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  projectWorkspaceService: { getTopicState: vi.fn() },
}));

describe('filterDeviceSearchResults', () => {
  it('verifies older API hits once per topic and preserves scoped and unrelated results', async () => {
    const getTopicState = vi.mocked(projectWorkspaceService.getTopicState);
    getTopicState.mockResolvedValue({
      snapshot: {
        boundDeviceId: 'owner',
        target: 'local',
        targetCapturedAt: '',
        version: 1,
        workspaceId: 'scratch-id',
        workspaceKind: 'scratch',
      },
    });
    const hits = [
      { id: 'foreign-topic', type: 'topic' },
      { id: 'foreign-message', topicId: 'foreign-topic', type: 'message' },
      { id: 'visible-topic', type: 'topic', workspaceDeviceScope: 'current' },
      { id: 'visible-page', type: 'page' },
    ] as SearchResult[];

    expect(await filterDeviceSearchResults(hits, 'current')).toEqual({
      incomplete: false,
      results: hits.slice(2),
    });
    expect(getTopicState).toHaveBeenCalledExactlyOnceWith('foreign-topic');
  });

  it('uses legacy topic details to keep ordinary hits and hide foreign workspace hits', async () => {
    vi.mocked(projectWorkspaceService.getTopicState).mockRejectedValue(
      new ProjectWorkspaceSeamUnavailableError(),
    );
    vi.mocked(lambdaClient.topic.getTopicDetail.query)
      .mockResolvedValueOnce({ metadata: null } as never)
      .mockResolvedValueOnce({
        metadata: { boundDeviceId: 'other', workingDirectory: '/other/project' },
      } as never);
    const hits = [
      { id: 'ordinary-topic', type: 'topic' },
      { id: 'foreign-message', topicId: 'foreign-topic', type: 'message' },
    ] as SearchResult[];

    expect(await filterDeviceSearchResults(hits, 'current')).toEqual({
      incomplete: false,
      results: hits.slice(0, 1),
    });
  });

  it('reports incomplete results when a topic lookup fails and keeps verified matches', async () => {
    vi.mocked(projectWorkspaceService.getTopicState).mockRejectedValue(new Error('Unavailable'));
    const hits = [
      { id: 'unknown-topic', type: 'topic' },
      { id: 'visible-topic', type: 'topic', workspaceDeviceScope: 'current' },
    ] as SearchResult[];

    expect(await filterDeviceSearchResults(hits, 'current')).toEqual({
      incomplete: true,
      results: hits.slice(1),
    });
  });

  it('reports a missing legacy topic detail as an incomplete search', async () => {
    vi.mocked(projectWorkspaceService.getTopicState).mockRejectedValue(
      new ProjectWorkspaceSeamUnavailableError(),
    );
    vi.mocked(lambdaClient.topic.getTopicDetail.query).mockResolvedValue(null as never);
    const hits = [{ id: 'missing-topic', type: 'topic' }] as SearchResult[];
    expect(await filterDeviceSearchResults(hits, 'current')).toEqual({
      incomplete: true,
      results: [],
    });
  });
});
