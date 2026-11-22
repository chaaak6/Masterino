import { describe, expect, it, vi } from 'vitest';

import type { SearchResult } from '@/database/repositories/search';
import { projectWorkspaceService } from '@/services/projectWorkspace';

import { filterDeviceSearchResults } from './filterDeviceSearchResults';

vi.mock('@/services/projectWorkspace', () => ({
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

    expect(await filterDeviceSearchResults(hits, 'current')).toEqual(hits.slice(2));
    expect(getTopicState).toHaveBeenCalledExactlyOnceWith('foreign-topic');
  });
});
