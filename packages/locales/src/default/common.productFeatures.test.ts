import { describe, expect, it } from 'vitest';

import common from './common';

describe('product feature disabled copy', () => {
  it('uses the requested Chinese coming-soon wording for unopened features', () => {
    expect(common['productFeatures.disabled']).toBe('敬请期待');
    expect(common['productFeatures.disabledTitle']).toBe('敬请期待');
    expect(common['productFeatures.disabledDescription']).toBe('敬请期待');
  });
});
