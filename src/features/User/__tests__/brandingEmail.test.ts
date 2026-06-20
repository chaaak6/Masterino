import { BRANDING_EMAIL } from '@lobechat/business-const';
import { describe, expect, it } from 'vitest';

describe('branding emails', () => {
  it('uses the MasterLion AI support inbox for customer support', () => {
    expect(BRANDING_EMAIL.support).toBe('ai@bielcrystal.com');
  });
});
