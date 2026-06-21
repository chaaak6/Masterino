import { describe, expect, it } from 'vitest';

import { menuKey } from './utils';

describe('ModelSwitchPanel utils', () => {
  it('uses raw model ids in keys for Aihub models', () => {
    expect(menuKey('newapi', 'glm-5.1')).not.toBe(menuKey('newapi', 'glm5-5.1'));
  });
});
