import { describe, expect, it } from 'vitest';

import enUSChat from '../../../../locales/en-US/chat.json';

import chat from './chat';

describe('chat branding copy', () => {
  it('uses the MasterLion Chinese assistant name for the built-in inbox assistant', () => {
    expect(chat['inbox.title']).toBe('小宗狮AI');
    expect(enUSChat['inbox.title']).toBe('小宗狮AI');
  });
});
