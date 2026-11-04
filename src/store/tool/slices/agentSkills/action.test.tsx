import type { SkillImportResult, SkillItem } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { type PropsWithChildren, useLayoutEffect } from 'react';
import { mutate as globalMutate, SWRConfig, useSWRConfig } from 'swr';
import { afterEach, expect, it, vi } from 'vitest';

import { setScopedMutate } from '@/libs/swr';
import { agentSkillService } from '@/services/skill';

import type { ToolStore } from '../../store';
import { AgentSkillsActionImpl } from './action';
import { type AgentSkillsState, initialAgentSkillsState } from './initialState';

afterEach(() => {
  vi.restoreAllMocks();
  setScopedMutate(globalMutate);
});

const ScopedMutate = ({ children }: PropsWithChildren) => {
  const { mutate } = useSWRConfig();
  useLayoutEffect(() => setScopedMutate(mutate), [mutate]);
  return children;
};

it('refreshes a mounted detail and its resource tree after URL reimport', async () => {
  const oldSkill = { id: 'qa-skill', name: 'QA', content: 'Old body' } as SkillItem;
  const newSkill = { ...oldSkill, content: 'New body' };
  const reference = {
    name: 'retained.md',
    path: 'references/retained.md',
    type: 'file' as const,
    content: 'Retained bytes',
  };
  vi.spyOn(agentSkillService, 'getById')
    .mockResolvedValueOnce(oldSkill)
    .mockResolvedValue(newSkill);
  vi.spyOn(agentSkillService, 'listResources')
    .mockResolvedValueOnce([])
    .mockResolvedValue([reference]);
  vi.spyOn(agentSkillService, 'importFromUrl').mockResolvedValue({
    skill: newSkill,
    status: 'updated',
  } as SkillImportResult);
  vi.spyOn(agentSkillService, 'list').mockResolvedValue({ data: [], total: 0 });
  let state: AgentSkillsState = { ...initialAgentSkillsState, agentSkillDetailMap: {} };
  const impl = new AgentSkillsActionImpl(
    (update: any) => {
      state = { ...state, ...(typeof update === 'function' ? update(state) : update) };
    },
    () => ({ ...state, refreshAgentSkills: impl.refreshAgentSkills }) as ToolStore,
  );
  const cache = new Map();
  const wrapper = ({ children }: PropsWithChildren) => (
    <SWRConfig value={{ provider: () => cache }}>
      <ScopedMutate>{children}</ScopedMutate>
    </SWRConfig>
  );
  const { result } = renderHook(() => impl.useFetchAgentSkillDetail('qa-skill'), { wrapper });
  await waitFor(() => expect(result.current.data?.skillDetail?.content).toBe('Old body'));
  await act(async () => {
    await impl.importAgentSkillFromUrl({ url: 'https://example.com/SKILL.md' });
  });
  await waitFor(() => expect(result.current.data?.skillDetail?.content).toBe('New body'));
  expect(result.current.data?.resourceTree).toEqual([reference]);
  expect(state.agentSkillDetailMap['qa-skill']?.content).toBe('New body');
});
