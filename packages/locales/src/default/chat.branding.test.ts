import { describe, expect, it } from 'vitest';

import enUSChat from '../../../../locales/en-US/chat.json';

import chat from './chat';

describe('chat branding copy', () => {
  it('uses the Masterino Chinese assistant name for the built-in inbox assistant', () => {
    expect(chat['inbox.title']).toBe('小宗狮AI');
    expect(enUSChat['inbox.title']).toBe('小宗狮AI');
  });
});
