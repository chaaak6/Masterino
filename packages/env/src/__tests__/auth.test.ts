// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('getAuthConfig', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.AUTH_DISABLE_EMAIL_PASSWORD;
    delete process.env.AUTH_DISABLE_EMAIL_SIGNUP;
  });

  it.each([
    { passwordDisabled: false, signupDisabled: false },
    { passwordDisabled: false, signupDisabled: true },
    { passwordDisabled: true, signupDisabled: false },
    { passwordDisabled: true, signupDisabled: true },
  ])(
    'parses passwordDisabled=$passwordDisabled and signupDisabled=$signupDisabled independently',
    async ({ passwordDisabled, signupDisabled }) => {
      process.env.AUTH_DISABLE_EMAIL_PASSWORD = passwordDisabled ? '1' : '0';
      process.env.AUTH_DISABLE_EMAIL_SIGNUP = signupDisabled ? '1' : '0';

      const { getAuthConfig } = await import('../auth');
      const config = getAuthConfig();

      expect(config.AUTH_DISABLE_EMAIL_PASSWORD).toBe(passwordDisabled);
      expect(config.AUTH_DISABLE_EMAIL_SIGNUP).toBe(signupDisabled);
    },
  );
});
