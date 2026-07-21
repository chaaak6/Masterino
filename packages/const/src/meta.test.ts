import { describe, expect, it } from 'vitest';

import { DEFAULT_INBOX_AVATAR, DEFAULT_INBOX_TITLE } from './meta';

describe('default Masterion metadata', () => {
  it('uses Masterion inbox identity and brand assets by default', () => {
    expect(DEFAULT_INBOX_TITLE).toBe('小宗狮AI');
    expect(DEFAULT_INBOX_AVATAR).toBe('/brand/masterlion/avatar.png');
  });
});
