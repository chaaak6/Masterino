import type { SkillListItem } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { agentSkillService } from '@/services/skill';
import { useToolStore } from '@/store/tool';

import { useSlashActionItems } from './useSlashActionItems';

vi.mock('../../hooks/useAgentId', () => ({ useAgentId: () => undefined }));
vi.mock('../../store', () => ({ useChatInputStore: () => undefined }));
vi.mock('@/hooks/useEffectiveWorkingDirectory', () => ({
  useEffectiveWorkingDirectory: () => undefined,
}));
vi.mock('@/hooks/useFetchProjectSkills', () => ({ useFetchProjectSkills: () => ({}) }));

const previousSkills = useToolStore.getState().agentSkills;

afterEach(() => {
  useToolStore.setState({ agentSkills: previousSkills });
  vi.restoreAllMocks();
});

it('offers a skill installed externally since the previous slash menu opened', async () => {
  useToolStore.setState({ agentSkills: [] });
  const installed = {
    id: 'external-install',
    identifier: 'external-install',
    name: 'New market skill',
    source: 'market',
  } as SkillListItem;
  vi.spyOn(agentSkillService, 'list')
    .mockResolvedValueOnce({ data: [], total: 0 })
    .mockResolvedValueOnce({ data: [installed], total: 1 });

  const { result } = renderHook(useSlashActionItems);
  const openSlashMenu = result.current;
  if (typeof openSlashMenu !== 'function') throw new Error('Expected a slash item provider');

  expect(await openSlashMenu(null)).not.toContainEqual(
    expect.objectContaining({ label: installed.name }),
  );
  expect(await openSlashMenu(null)).toContainEqual(
    expect.objectContaining({ label: installed.name }),
  );
});
