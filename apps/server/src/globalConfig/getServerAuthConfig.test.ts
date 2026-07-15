import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authEnv: {
    AUTH_DISABLE_EMAIL_PASSWORD: false,
    AUTH_DISABLE_EMAIL_SIGNUP: false,
    AUTH_EMAIL_VERIFICATION: false,
    AUTH_ENABLE_MAGIC_LINK: false,
    AUTH_SSO_PROVIDERS: '',
  },
}));

vi.mock('@lobechat/business-const', () => ({ ENABLE_BUSINESS_FEATURES: false }));
vi.mock('@/envs/app', () => ({ appEnv: {} }));
vi.mock('@/envs/auth', () => ({ authEnv: mocks.authEnv }));
vi.mock('@/libs/better-auth/utils/server', () => ({ parseSSOProviders: vi.fn(() => []) }));

describe('getServerAuthConfig', () => {
  beforeEach(() => {
    mocks.authEnv.AUTH_DISABLE_EMAIL_PASSWORD = false;
    mocks.authEnv.AUTH_DISABLE_EMAIL_SIGNUP = false;
  });

  it('keeps email login enabled while disabling new email signups', async () => {
    mocks.authEnv.AUTH_DISABLE_EMAIL_SIGNUP = true;

    const { getServerAuthConfig } = await import('./getServerAuthConfig');

    expect(getServerAuthConfig()).toMatchObject({
      disableEmailPassword: false,
      disableEmailSignup: true,
    });
  });

  it('treats full email/password disablement as signup disablement', async () => {
    mocks.authEnv.AUTH_DISABLE_EMAIL_PASSWORD = true;

    const { getServerAuthConfig } = await import('./getServerAuthConfig');

    expect(getServerAuthConfig()).toMatchObject({
      disableEmailPassword: true,
      disableEmailSignup: true,
    });
  });
});
