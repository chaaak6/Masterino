import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  betterAuth: vi.fn((options) => options),
  provisionWecomLoginAccount: vi.fn(),
  serverDB: {
    query: {
      account: {
        findFirst: vi.fn(),
      },
    },
  },
}));

vi.mock('@better-auth/expo', () => ({
  expo: vi.fn(() => ({ id: 'expo' })),
}));

vi.mock('@better-auth/passkey', () => ({
  passkey: vi.fn((options) => ({ id: 'passkey', options })),
}));

vi.mock('@lobechat/database', () => ({
  createNanoId: vi.fn(() => vi.fn(() => 'generated-id')),
  idGenerator: vi.fn(() => 'generated-user-id'),
  serverDB: mocks.serverDB,
}));

vi.mock('@lobechat/database/schemas', () => ({
  account: {
    accountId: 'account.accountId',
    providerId: 'account.providerId',
    userId: 'account.userId',
  },
}));

vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(),
  },
}));

vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: vi.fn(() => ({ id: 'drizzle-adapter' })),
}));

vi.mock('better-auth/crypto', () => ({
  verifyPassword: vi.fn(),
}));

vi.mock('better-auth/minimal', () => ({
  betterAuth: mocks.betterAuth,
}));

vi.mock('better-auth/plugins', () => ({
  admin: vi.fn(() => ({ id: 'admin' })),
  emailOTP: vi.fn(() => ({ id: 'email-otp' })),
  genericOAuth: vi.fn(() => ({ id: 'generic-oauth' })),
  magicLink: vi.fn(() => ({ id: 'magic-link' })),
}));

vi.mock('undici', () => ({
  ProxyAgent: vi.fn(),
  setGlobalDispatcher: vi.fn(),
}));

vi.mock('@/envs/app', () => ({
  appEnv: {
    APP_URL: 'https://example.com',
  },
}));

vi.mock('@/envs/auth', () => ({
  authEnv: {
    AUTH_DISABLE_EMAIL_PASSWORD: false,
    AUTH_EMAIL_VERIFICATION: true,
    AUTH_ENABLE_MAGIC_LINK: false,
    AUTH_SECRET: 'test-secret',
    AUTH_SSO_PROVIDERS: '',
  },
}));

vi.mock('@/libs/better-auth/email-templates', () => ({
  getChangeEmailVerificationTemplate: vi.fn(() => ({})),
  getMagicLinkEmailTemplate: vi.fn(() => ({})),
  getResetPasswordEmailTemplate: vi.fn(() => ({})),
  getVerificationEmailTemplate: vi.fn(() => ({})),
  getVerificationOTPEmailTemplate: vi.fn(() => ({})),
}));

vi.mock('@/libs/better-auth/plugins/email-whitelist', () => ({
  emailWhitelist: vi.fn(() => ({ id: 'email-whitelist' })),
}));

vi.mock('@/libs/better-auth/wecom-login-provisioning', () => ({
  provisionWecomLoginAccount: mocks.provisionWecomLoginAccount,
}));

vi.mock('@/libs/better-auth/sso', () => ({
  initBetterAuthSSOProviders: vi.fn(() => ({
    genericOAuthProviders: [],
    socialProviders: {},
  })),
}));

vi.mock('@/libs/better-auth/utils/config', () => ({
  createSecondaryStorage: vi.fn(() => ({ id: 'secondary-storage' })),
  getTrustedOrigins: vi.fn((_providers, extraOrigins?: string[]) => [
    'https://example.com',
    ...(extraOrigins || []),
  ]),
}));

vi.mock('@/libs/better-auth/utils/server', () => ({
  parseSSOProviders: vi.fn(() => []),
}));

vi.mock('@/server/services/email', () => ({
  EmailService: vi.fn(),
}));

vi.mock('@/server/services/user', () => ({
  UserService: vi.fn(),
}));

describe('defineConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.serverDB.query.account.findFirst.mockReset();
  });

  it('should revoke existing sessions after password reset by default', async () => {
    const { defineConfig } = await import('./define-config');

    defineConfig({ plugins: [] });

    expect(mocks.betterAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        emailAndPassword: expect.objectContaining({
          revokeSessionsOnPasswordReset: true,
        }),
      }),
    );
  });

  it('uses request base URL overrides for dynamic auth handlers', async () => {
    const { defineConfig } = await import('./define-config');

    defineConfig({
      baseURL: 'https://chat.example.com',
      plugins: [],
      trustedOrigins: ['https://chat.example.com'],
    });

    expect(mocks.betterAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://chat.example.com',
        trustedOrigins: ['https://example.com', 'https://chat.example.com'],
      }),
    );
    const options = mocks.betterAuth.mock.calls.at(-1)?.[0] as any;
    const passkeyPlugin = options.plugins.find(
      (plugin: { id?: string }) => plugin.id === 'passkey',
    );
    expect(passkeyPlugin).toMatchObject({
      options: expect.objectContaining({
        origin: ['https://chat.example.com'],
        rpID: 'chat.example.com',
      }),
    });
  });

  it('calls WeCom login provisioning after Better Auth creates a WeCom account', async () => {
    const { defineConfig } = await import('./define-config');
    const options = defineConfig({ plugins: [] }) as any;
    const account = {
      accountId: 'wecom-user-1001',
      providerId: 'wecom',
      userId: 'user-1001',
    };
    const context = { requestId: 'better-auth-context' };

    await options.databaseHooks.account.create.after(account, context);

    expect(mocks.provisionWecomLoginAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        account,
        context,
      }),
    );
  });

  it('does not call WeCom login provisioning for non-WeCom account providers', async () => {
    const { defineConfig } = await import('./define-config');
    const options = defineConfig({ plugins: [] }) as any;

    await options.databaseHooks.account.create.after(
      {
        accountId: 'google-user-1001',
        providerId: 'google',
        userId: 'user-1001',
      },
      { requestId: 'better-auth-context' },
    );

    expect(mocks.provisionWecomLoginAccount).not.toHaveBeenCalled();
  });

  it('calls WeCom login provisioning after Better Auth creates a session for an existing WeCom account', async () => {
    const { defineConfig } = await import('./define-config');
    const options = defineConfig({ plugins: [] }) as any;
    const session = {
      id: 'session-1001',
      userId: 'user-1001',
    };
    const account = {
      accountId: 'wecom-user-1001',
      providerId: 'wecom',
      userId: 'user-1001',
    };
    const context = { requestId: 'better-auth-context' };
    mocks.serverDB.query.account.findFirst.mockResolvedValue(account);

    await options.databaseHooks.session.create.after(session, context);

    expect(mocks.serverDB.query.account.findFirst).toHaveBeenCalledTimes(1);
    expect(mocks.provisionWecomLoginAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        account,
        context,
      }),
    );
  });

  it('does not call WeCom login provisioning after session creation when no WeCom account exists', async () => {
    const { defineConfig } = await import('./define-config');
    const options = defineConfig({ plugins: [] }) as any;
    mocks.serverDB.query.account.findFirst.mockResolvedValue(null);

    await options.databaseHooks.session.create.after(
      {
        id: 'session-1001',
        userId: 'user-1001',
      },
      { requestId: 'better-auth-context' },
    );

    expect(mocks.serverDB.query.account.findFirst).toHaveBeenCalledTimes(1);
    expect(mocks.provisionWecomLoginAccount).not.toHaveBeenCalled();
  });

  it('does not query WeCom accounts after session creation without a user id', async () => {
    const { defineConfig } = await import('./define-config');
    const options = defineConfig({ plugins: [] }) as any;

    await options.databaseHooks.session.create.after(
      {
        id: 'session-1001',
      },
      { requestId: 'better-auth-context' },
    );

    expect(mocks.serverDB.query.account.findFirst).not.toHaveBeenCalled();
    expect(mocks.provisionWecomLoginAccount).not.toHaveBeenCalled();
  });
});
