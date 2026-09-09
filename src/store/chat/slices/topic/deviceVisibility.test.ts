import { expect, it, vi } from 'vitest';

import { scopeDeviceTopics } from '@/hooks/useDeviceTopics';

import type { ChatStoreState } from '../../initialState';
import { topicMapKey } from '../../utils/topicMapKey';
import { topicSelectors } from './selectors';

it('filters cached foreign projects before the sidebar/@ limit and in drawer/search selectors', () => {
  const foreign = Array.from({ length: 30 }, (_, i) => ({
    id: `foreign-${i}`,
    favorite: true,
    createdAt: 100,
    updatedAt: 100,
    metadata: { workspaceId: 'foreign', boundDeviceId: 'mac-b' },
  }));
  const local = {
    id: 'local',
    createdAt: 1,
    updatedAt: 1,
    metadata: { workspaceId: 'local', boundDeviceId: 'mac-a' },
  };
  const items = [...foreign, local];
  const state = {
    activeAgentId: 'agent',
    topicDataMap: { [topicMapKey({ agentId: 'agent' })]: { items } },
    searchTopics: items,
  } as unknown as ChatStoreState;
  const scoped = scopeDeviceTopics(state, {
    currentDeviceId: 'mac-a',
    topicStatesById: {},
    workspacesById: {},
  });
  expect(
    topicSelectors
      .displayTopicsForSidebar(1)(scoped)
      ?.map((t) => t.id),
  ).toEqual(['local']);
  expect(topicSelectors.displayTopics(scoped)?.map((t) => t.id)).toEqual(['local']);
  expect(topicSelectors.searchTopics(scoped)?.map((t) => t.id)).toEqual(['local']);
  expect(
    topicSelectors
      .getTopicsByAgentId('agent')(scoped)
      ?.map((t) => t.id),
  ).toEqual(['local']);
  expect(topicSelectors.getTopicById('foreign-0')(state)?.id).toBe('foreign-0');
});

vi.mock('@/store/chat', () => ({ useChatStore: vi.fn() }));
vi.mock('@/store/electron', () => ({ useElectronStore: vi.fn() }));
vi.mock('@/store/projectWorkspace/store', () => ({ useProjectWorkspaceStore: vi.fn() }));
