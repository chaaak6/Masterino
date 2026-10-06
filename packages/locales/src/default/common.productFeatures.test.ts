import { describe, expect, it } from 'vitest';

import vi from '../../../../locales/vi-VN/common.json';
import zh from '../../../../locales/zh-CN/common.json';
import common from './common';

describe('product feature disabled copy', () => {
  it('keeps Chinese copy in Chinese resources and uses English source copy', () => {
    expect(common['productFeatures.disabled']).toBe('Coming soon');
    expect(common['productFeatures.disabledTitle']).toBe('Coming soon');
    expect(common['productFeatures.disabledDescription']).toBe('Coming soon');
    expect(zh['productFeatures.disabled']).toBe('敬请期待');
    expect(vi['productFeatures.disabled']).toBe('Sắp ra mắt');
  });
});
