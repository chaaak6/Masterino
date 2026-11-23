import type { SkillListItem, ToolManifest } from '@lobechat/types';
import type { IEditor } from '@lobehub/editor';
import { renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { agentSkillService } from '@/services/skill';
import { useToolStore } from '@/store/tool';

import type * as localMcpPicker from '../../hooks/useDeviceLocalMcpPicker';
import { INSERT_ACTION_TAG_COMMAND } from './command';
import { useSlashActionItems } from './useSlashActionItems';

const picker = vi.hoisted(() => ({ manifests: [] as ToolManifest[] }));
vi.mock('../../hooks/useAgentId', () => ({ useAgentId: () => 'agent' }));
vi.mock('../../hooks/useDeviceLocalMcpPicker', async (importOriginal) => ({
  ...(await importOriginal<typeof localMcpPicker>()),
  useDeviceLocalMcpPicker: () => ({ manifests: picker.manifests, workspace: {} }),
}));
vi.mock('../../store', () => ({ useChatInputStore: () => undefined }));
vi.mock('@/hooks/useFetchProjectSkills', () => ({ useFetchProjectSkills: () => ({}) }));

const previousSkills = useToolStore.getState().agentSkills;

afterEach(() => {
  picker.manifests = [];
  useToolStore.setState({ agentSkills: previousSkills });
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('inserts a selected local MCP as a turn-scoped tool tag', async () => {
  const identifier = 'local-mcp-000000000000000000000001';
  picker.manifests = [
    {
      api: [{ description: 'Inspect the drawing', name: 'ocs_inspect', parameters: {} }],
      identifier,
      meta: { title: 'OpenCADStudio' },
      type: 'mcp',
    },
  ];
  vi.spyOn(agentSkillService, 'list').mockResolvedValue({ data: [], total: 0 });
  const { result } = renderHook(useSlashActionItems);
  if (typeof result.current !== 'function') throw new Error('Expected a slash item provider');
  const items = await result.current(null);
  const item = items.find((item) => 'label' in item && item.label === 'OpenCADStudio');
  if (!item || !('onSelect' in item) || typeof item.onSelect !== 'function')
    throw new Error('Expected a selectable MCP item');
  const dispatchCommand = vi.fn();
  item.onSelect({ dispatchCommand } as unknown as IEditor, '');
  expect(dispatchCommand).toHaveBeenCalledWith(INSERT_ACTION_TAG_COMMAND, {
    category: 'tool',
    label: 'OpenCADStudio',
    type: identifier,
  });
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

it('shows cached skills on a slow connection and reuses the pending refresh', async () => {
  vi.useFakeTimers();
  const cached = {
    id: 'cached',
    identifier: 'cached',
    name: 'Cached skill',
    source: 'market',
  } as SkillListItem;
  const installed = { ...cached, id: 'new', identifier: 'new', name: 'New skill' };
  useToolStore.setState({ agentSkills: [cached] });
  const response = Promise.withResolvers<{ data: SkillListItem[]; total: number }>();
  const list = vi.spyOn(agentSkillService, 'list').mockReturnValue(response.promise);
  const { result } = renderHook(useSlashActionItems);
  const openSlashMenu = result.current;
  if (typeof openSlashMenu !== 'function') throw new Error('Expected a slash item provider');

  const firstOpen = openSlashMenu(null);
  await vi.advanceTimersByTimeAsync(150);
  expect(await firstOpen).toContainEqual(expect.objectContaining({ label: cached.name }));

  const secondOpen = openSlashMenu(null);
  expect(list).toHaveBeenCalledOnce();
  response.resolve({ data: [cached, installed], total: 2 });
  expect(await secondOpen).toContainEqual(expect.objectContaining({ label: installed.name }));
});
