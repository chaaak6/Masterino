import { expect, it } from 'vitest';

import {
  resolveClientSkillExecutionContext,
  resolveOwnedClientSkillTool,
} from './clientSkillToolEvidence';

const request = { topicId: 'topic', messageId: 'tool', apiName: 'execScript' as const };
function fixture() {
  const messages = new Map<string, any>([
    [
      'tool',
      { id: 'tool', topicId: 'topic', role: 'tool', parentId: 'assistant', agentId: 'agent' },
    ],
    [
      'assistant',
      {
        id: 'assistant',
        topicId: 'topic',
        role: 'assistant',
        parentId: 'user',
        tools: [{ id: 'call', identifier: 'lobe-skills', apiName: 'execScript' }],
      },
    ],
    ['user', { id: 'user', topicId: 'topic', role: 'user' }],
  ]);
  const storage = {
    findTopic: async () => ({ id: 'topic', agentId: 'agent' }),
    findMessage: async (id: string) => messages.get(id),
    findPlugin: async () => ({
      identifier: 'lobe-skills',
      apiName: 'execScript',
      toolCallId: 'call',
      arguments: '{"skillId":"user:demo","command":"python script.py"}',
    }),
  };
  return { messages, storage };
}
it('uses owned persisted arguments and a server-derived message-chain operation', async () => {
  const { storage } = fixture();
  const result = await resolveOwnedClientSkillTool(request, storage);
  expect(result.operationId).toBe('client-message:assistant');
  expect(result.args.command).toBe('python script.py');
});
it('rejects unowned topics and messages from another topic', async () => {
  const { messages, storage } = fixture();
  await expect(
    resolveOwnedClientSkillTool(request, { ...storage, findTopic: async () => undefined }),
  ).rejects.toThrow('NOT_OWNED');
  messages.get('tool').topicId = 'other';
  await expect(resolveOwnedClientSkillTool(request, storage)).rejects.toThrow('NOT_OWNED');
});
it('rejects a same-name call from another plugin and broken parent association', async () => {
  const { messages, storage } = fixture();
  await expect(
    resolveOwnedClientSkillTool(request, {
      ...storage,
      findPlugin: async () => ({ identifier: 'other', apiName: 'execScript', toolCallId: 'call' }),
    }),
  ).rejects.toThrow('NOT_OWNED');
  messages.get('assistant').tools[0].id = 'different';
  await expect(resolveOwnedClientSkillTool(request, storage)).rejects.toThrow('MISMATCH');
});

it('accepts an explicitly cloud-bound Web context', () => {
  expect(
    resolveClientSkillExecutionContext({
      isDesktop: false,
      executionTargetByPlatform: { web: 'sandbox' },
    }).plan.kind,
  ).toBe('sandbox');
});
it.each(['device', 'none'] as const)(
  'preserves a %s target instead of forcing cloud package authority',
  (target) => {
    const context = resolveClientSkillExecutionContext({
      isDesktop: false,
      canUseDevice: false,
      requestedDeviceId: target === 'device' ? 'owned-device' : undefined,
      executionTargetByPlatform: { web: target },
    });
    expect(context.plan.kind).toBe(target);
    if (context.plan.kind === 'device') expect(context.plan.deviceId).toBe('owned-device');
  },
);
