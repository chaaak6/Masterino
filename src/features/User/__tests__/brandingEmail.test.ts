import { BRANDING_EMAIL } from '@lobechat/business-const';
import { describe, expect, it } from 'vitest';

describe('branding emails', () => {
  it('uses the MasterLion AI inbox for customer support and business contact', () => {
    expect(BRANDING_EMAIL.support).toBe('ai@bielcrystal.com');
    expect(BRANDING_EMAIL.business).toBe('ai@bielcrystal.com');
  });
});
