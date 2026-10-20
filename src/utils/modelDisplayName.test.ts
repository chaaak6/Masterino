import { describe, expect, it } from 'vitest';

import { modelDisplayName } from './modelDisplayName';

describe('modelDisplayName', () => {
  it('hides only the editorial compatibility suffix', () => {
    expect(modelDisplayName('DeepSeek V4 Flash（兼容名）', 'deepseek-flash')).toBe('DeepSeek V4 Flash');
    expect(modelDisplayName('DeepSeek V4 Flash (兼容名)', 'deepseek-flash')).toBe('DeepSeek V4 Flash');
    expect(modelDisplayName('DeepSeek V4 Flash', 'deepseek-flash')).toBe('DeepSeek V4 Flash');
  });
});
