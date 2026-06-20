import { describe, expect, it } from 'vitest';

import { menuKey } from './utils';

describe('ModelSwitchPanel utils', () => {
  it('uses the same key for equivalent Aihub GLM ids', () => {
    expect(menuKey('newapi', 'glm-5.1')).toBe(menuKey('newapi', 'glm5-5.1'));
  });
});
