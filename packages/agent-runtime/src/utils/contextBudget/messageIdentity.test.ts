import { MessagesEngine, stripContextMessageIdentity } from '@lobechat/context-engine';
import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { evaluateContextBudget } from './preflight';

describe('context-engine to persisted compression candidates', () => {
  it('keeps persisted history selectable after final message cleanup', async () => {
    const messages: UIChatMessage[] = [
      {
        id: 'previous-user',
        role: 'user',
        content: 'Explain the project.',
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: 'previous-answer',
        role: 'assistant',
        content: 'Project details. '.repeat(2000),
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: 'latest-user',
        role: 'user',
        content: 'Continue with the next skill.',
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    const result = await new MessagesEngine({
      enableSystemDate: false,
      messages,
      model: 'unknown-model',
      provider: 'newapi',
      preserveMessageIdentity: true,
    }).process();
    const budget = evaluateContextBudget({
      configuredWindowTokens: 2048,
      messages: result.messages as UIChatMessage[],
      modelId: 'unknown-model',
      operationId: 'operation',
      providerId: 'newapi',
      trigger: 'final-preflight',
    });
    const persistedIds = new Set(messages.map((message) => message.id));
    // This is the client executor's persisted-history intersection, after the real CE pipeline.
    expect(budget.partition.candidateIds.filter((id) => persistedIds.has(id))).toEqual([
      'previous-user',
      'previous-answer',
    ]);
    expect(budget.partition.preservedIds).toContain('latest-user');
    expect(budget.decision.kind).toBe('compress');
    const providerMessages = stripContextMessageIdentity(result.messages);
    expect(providerMessages.map((message) => message.content)).toEqual(
      result.messages.map((message) => message.content),
    );
    for (const message of providerMessages) {
      expect(message).not.toHaveProperty('id');
      expect(message).not.toHaveProperty('metadata');
    }
  });
  it('keeps the recent complete turn intact, including its pinned reply', async () => {
    const messages: UIChatMessage[] = [
      { id: 'old', role: 'user', content: 'Previous question', createdAt: 0, updatedAt: 0 },
      {
        id: 'pinned',
        role: 'assistant',
        content: 'Keep this answer',
        metadata: { pinned: true },
        createdAt: 0,
        updatedAt: 0,
      },
      { id: 'latest', role: 'user', content: 'Next question', createdAt: 0, updatedAt: 0 },
    ];
    const result = await new MessagesEngine({
      enableSystemDate: false,
      messages,
      model: 'test',
      provider: 'openai',
      preserveMessageIdentity: true,
    }).process();
    const budget = evaluateContextBudget({
      configuredWindowTokens: 8192,
      messages: result.messages as UIChatMessage[],
      modelId: 'test',
      operationId: 'operation',
      providerId: 'openai',
      trigger: 'final-preflight',
    });
    expect(budget.partition.candidateIds).toEqual([]);
    expect(budget.partition.preservedIds).toEqual(['old', 'pinned', 'latest']);
    expect(stripContextMessageIdentity(result.messages)[1]).not.toHaveProperty('metadata');
  });

  it('strips internal message IDs without removing provider tool-call IDs', () => {
    const messages = [
      {
        id: 'db-assistant',
        metadata: { pinned: true },
        role: 'assistant',
        tool_calls: [
          { id: 'call-1', type: 'function', function: { name: 'read', arguments: '{}' } },
        ],
      },
      { id: 'db-tool', role: 'tool', tool_call_id: 'call-1', content: 'ok' },
    ];
    const provider = stripContextMessageIdentity(messages);
    expect(provider[0].tool_calls?.[0].id).toBe('call-1');
    expect(provider[1].tool_call_id).toBe('call-1');
    expect(provider[1].content).toBe('ok');
    expect(provider.every((message) => !('id' in message) && !('metadata' in message))).toBe(true);
  });
});
