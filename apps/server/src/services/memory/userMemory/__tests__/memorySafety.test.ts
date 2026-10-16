import { describe, expect, it } from 'vitest';

import { prepareMemoryConversationMessage } from '../conversation';

describe('memory extraction safety', () => {
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
