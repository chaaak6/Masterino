import type { BuiltinToolContext } from '@lobechat/types';
import { beforeEach, expect, it, vi } from 'vitest';

import { skillsExecutor } from './lobe-skills';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@lobechat/builtin-skills', () => ({ builtinSkills: [] }));
vi.mock('@/helpers/skillFilters', () => ({ filterBuiltinSkills: (skills: unknown) => skills }));
vi.mock('@/libs/trpc/client', () => ({
  toolsClient: { market: { executeSkillTool: { mutate: mocks.execute } } },
}));
vi.mock('@/services/cloudSandbox', () => ({ cloudSandboxService: {} }));
vi.mock('@/services/skill', () => ({ agentSkillService: {} }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockResolvedValue({ success: true, content: 'ok' });
});
it.each(['activateSkill', 'readReference', 'execScript'] as const)(
  'Web %s uses persisted-message server execution',
  async (apiName) => {
    const context = { messageId: 'owned-tool-message', topicId: 'topic' } as BuiltinToolContext;
    expect(
      (
        await skillsExecutor[apiName](
          { command: 'client parameter is not authority' } as never,
          context,
        )
      ).success,
    ).toBe(true);
    expect(mocks.execute).toHaveBeenCalledWith({
      apiName,
      messageId: 'owned-tool-message',
      topicId: 'topic',
    });
  },
);
it('requires message/topic evidence before dispatch', async () => {
  expect(
    (
      await skillsExecutor.execScript({ command: 'print(1)', description: '' }, {
        messageId: 'message',
      } as BuiltinToolContext)
    ).success,
  ).toBe(false);
  expect(mocks.execute).not.toHaveBeenCalled();
});
