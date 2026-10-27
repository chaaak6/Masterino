import { describe, expect, it } from 'vitest';

import { isBackendPath } from './protocol';

describe('desktop skill download routing', () => {
  it('proxies skill downloads while preserving unrelated local paths', () => {
    expect(isBackendPath('/api/market/skills/qa/download')).toBe(true);
    expect(isBackendPath('/api/market/skills-other')).toBe(false);
    expect(isBackendPath('/api/local-only')).toBe(false);
  });
});
