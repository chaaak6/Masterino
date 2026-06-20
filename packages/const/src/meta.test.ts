import { describe, expect, it } from 'vitest';

import { DEFAULT_INBOX_AVATAR, DEFAULT_INBOX_TITLE } from './meta';

describe('default MasterLion metadata', () => {
  it('uses MasterLion inbox identity and brand assets by default', () => {
    expect(DEFAULT_INBOX_TITLE).toBe('小宗狮AI');
    expect(DEFAULT_INBOX_AVATAR).toBe('/brand/masterlion/avatar.png');
  });
});
