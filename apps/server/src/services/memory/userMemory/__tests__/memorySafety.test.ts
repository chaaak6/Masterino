import type { AiProviderRuntimeState } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { prepareMemoryConversationMessage } from '../conversation';
import { resolveMemoryEmbeddingConfig } from '../embeddingConfig';

const runtimeState = {
  enabledAiModels: [
    { abilities: {}, enabled: true, id: 'glm-5.3', providerId: 'newapi', type: 'chat' },
    {
      abilities: {},
      enabled: true,
      id: 'text-embedding-3-large',
      providerId: 'newapi',
      type: 'embedding',
    },
  ],
} as AiProviderRuntimeState;

describe('memory extraction safety', () => {
  it('falls back to an authorized embedding when a saved chat model was selected', () => {
    expect(
      resolveMemoryEmbeddingConfig(
        runtimeState,
        { model: 'glm-5.3', provider: 'newapi' },
        { model: 'text-embedding-3-large', provider: 'newapi' },
      ),
    ).toMatchObject({ model: 'text-embedding-3-large', provider: 'newapi' });
  });

  it('preserves a valid embedding override', () => {
    expect(
      resolveMemoryEmbeddingConfig(
        runtimeState,
        { model: 'text-embedding-3-large', provider: 'newapi' },
        { model: 'other', provider: 'newapi' },
      ).model,
    ).toBe('text-embedding-3-large');
  });

  it('omits tool outputs and bounds oversized conversation messages', () => {
    expect(
      prepareMemoryConversationMessage({ content: 'tool data', role: 'tool' }),
    ).toBeUndefined();
    const prepared = prepareMemoryConversationMessage({
      content: `start${'x'.repeat(900_000)}end`,
      role: 'user',
    });
    expect(prepared?.content.length).toBeLessThan(33_000);
    expect(prepared?.content).toContain('start');
    expect(prepared?.content).toContain('end');
  });
});
