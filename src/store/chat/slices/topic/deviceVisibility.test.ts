import { expect, it, vi } from 'vitest';

import type { ChatStoreState } from '../../initialState';
import { topicMapKey } from '../../utils/topicMapKey';
import { topicSelectors } from './selectors';

vi.mock('@lobechat/const', () => ({ isDesktop: true }));
vi.mock('@/store/electron', () => ({
  getElectronStoreState: () => ({ gatewayDeviceInfo: { deviceId: 'mac-a' } }),
}));
vi.mock('@/store/projectWorkspace/store', () => ({
  getProjectWorkspaceStoreState: () => ({ topicStatesById: {}, workspacesById: {} }),
}));

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
  expect(
    topicSelectors
      .displayTopicsForSidebar(1)(state)
      ?.map((t) => t.id),
  ).toEqual(['local']);
  expect(topicSelectors.displayTopics(state)?.map((t) => t.id)).toEqual(['local']);
  expect(topicSelectors.searchTopics(state)?.map((t) => t.id)).toEqual(['local']);
  expect(topicSelectors.getTopicById('foreign-0')(state)?.id).toBe('foreign-0');
});
