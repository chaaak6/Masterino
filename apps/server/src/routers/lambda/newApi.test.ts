// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { createContextInner } from '@/libs/trpc/lambda/context';

import { newApiRouter } from './newApi';

const {
  mockFindUserById,
  mockGetServerDB,
  mockGetSubscriptionSummary,
  mockHasAnyPermission,
  mockImportBindings,
  mockInitWithEnvKey,
  mockNewApiServiceConstructor,
  mockReadinessEnsure,
  mockReadinessGet,
  mockRebindCurrentUser,
  mockValidateBinding,
} = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockGetServerDB: vi.fn(),
  mockGetSubscriptionSummary: vi.fn(),
  mockHasAnyPermission: vi.fn(),
  mockImportBindings: vi.fn(),
  mockInitWithEnvKey: vi.fn(),
  mockNewApiServiceConstructor: vi.fn(),
  mockReadinessEnsure: vi.fn(),
  mockReadinessGet: vi.fn(),
  mockRebindCurrentUser: vi.fn(),
  mockValidateBinding: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: mockGetServerDB,
}));

vi.mock('@/database/models/user', () => ({
  UserModel: {
    findById: mockFindUserById,
  },
}));

vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = (...args: any[]) => mockHasAnyPermission(...args);
  },
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: mockInitWithEnvKey,
  },
}));

vi.mock('@/server/services/newApi', () => ({
  NewApiService: vi.fn().mockImplementation((options) => {
    mockNewApiServiceConstructor(options);

    return {
      getAccountSummary: vi.fn(),
      getSubscriptionSummary: mockGetSubscriptionSummary,
      getBindingStatus: vi.fn(),
      getUsageSummary: vi.fn(),
      importBindings: mockImportBindings,
      rebindCurrentUser: mockRebindCurrentUser,
      syncModels: vi.fn(),
      validateBinding: mockValidateBinding,
    };
  }),
}));

vi.mock('@/server/services/newApi/readiness/production', () => ({
  createAihubReadiness: vi.fn(() => ({
    ensure: mockReadinessEnsure,
    get: mockReadinessGet,
  })),
}));

const createCaller = createCallerFactory(newApiRouter);
const mockServerDB = { kind: 'server-db' };
const mockGateKeeper = { kind: 'gate-keeper' };

const createCallerForUser = async (userId = 'user-member') =>
  createCaller(await createContextInner({ userId }));

describe('newApiRouter admin permission guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerDB.mockResolvedValue(mockServerDB);
    mockInitWithEnvKey.mockResolvedValue(mockGateKeeper);
    mockHasAnyPermission.mockResolvedValue(false);
    mockImportBindings.mockResolvedValue([
      { lobeUserId: 'lobe-user', newApiUserId: 7, ok: true, source: 'admin-api' },
    ]);
    mockRebindCurrentUser.mockResolvedValue({ repaired: true, status: 'active' });
    mockReadinessEnsure.mockResolvedValue({
      iamOAuthBinding: { status: 'active' },
      isBound: true,
      oauthBinding: { status: 'active' },
      status: 'active',
    });
    mockReadinessGet.mockResolvedValue({ isBound: false, status: 'missing' });
    mockValidateBinding.mockResolvedValue({
      lobeUserId: 'lobe-user',
      newApiUserId: 7,
      ok: true,
      source: 'admin-api',
    });
  });

  it('reads subscription data using the authenticated user context', async () => {
    mockGetSubscriptionSummary.mockResolvedValue({
      billingPreference: 'subscription_first',
      subscriptions: [],
    });
    const caller = await createCallerForUser('user-member');
    await expect(caller.getSubscriptionSummary()).resolves.toEqual({
      billingPreference: 'subscription_first',
      subscriptions: [],
    });
    expect(mockNewApiServiceConstructor).toHaveBeenCalledWith({
      db: mockServerDB,
      gateKeeper: mockGateKeeper,
      userId: 'user-member',
    });
    expect(mockReadinessEnsure).not.toHaveBeenCalled();
  });

  it('rejects anonymous subscription reads', async () => {
    const caller = createCaller(await createContextInner({}));
    await expect(caller.getSubscriptionSummary()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(mockGetSubscriptionSummary).not.toHaveBeenCalled();
  });

  it('allows importBindings through RBAC aihub:manage permission without legacy admin role', async () => {
    mockFindUserById.mockResolvedValue({ id: 'user-member', role: 'user' });
    mockHasAnyPermission.mockResolvedValue(true);
    const caller = await createCallerForUser('user-member');

    await expect(caller.importBindings({ rows: [{ email: 'ada@example.com' }] })).resolves.toEqual([
      { lobeUserId: 'lobe-user', newApiUserId: 7, ok: true, source: 'admin-api' },
    ]);
    expect(mockHasAnyPermission.mock.calls[0]?.[0]).toEqual(['aihub:manage']);
    expect(mockImportBindings).toHaveBeenCalledWith([{ email: 'ada@example.com' }]);
  });

  it('keeps validateBinding compatible with legacy users.role admin', async () => {
    mockFindUserById.mockResolvedValue({ id: 'legacy-admin', role: 'admin' });
    const caller = await createCallerForUser('legacy-admin');

    await expect(caller.validateBinding({ email: 'ada@example.com' })).resolves.toEqual({
      lobeUserId: 'lobe-user',
      newApiUserId: 7,
      ok: true,
      source: 'admin-api',
    });
    expect(mockValidateBinding).toHaveBeenCalledWith({ email: 'ada@example.com' });
    expect(mockNewApiServiceConstructor).toHaveBeenCalledWith({
      db: mockServerDB,
      gateKeeper: mockGateKeeper,
      userId: 'legacy-admin',
    });
  });

  it('rejects importBindings when neither legacy admin nor RBAC aihub:manage is present', async () => {
    mockFindUserById.mockResolvedValue({ id: 'user-member', role: 'user' });
    mockHasAnyPermission.mockResolvedValue(false);
    const caller = await createCallerForUser('user-member');

    await expect(
      caller.importBindings({ rows: [{ email: 'ada@example.com' }] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mockHasAnyPermission.mock.calls[0]?.[0]).toEqual(['aihub:manage']);
    expect(mockImportBindings).not.toHaveBeenCalled();
  });

  it('allows an authenticated user to rebind only the current account without admin permission', async () => {
    const caller = await createCallerForUser('user-member');

    await expect(caller.rebindCurrentUser()).resolves.toEqual({
      repaired: true,
      status: 'active',
    });
    expect(mockReadinessEnsure).toHaveBeenCalledWith('user-member', {
      force: true,
      trigger: 'manual_retry',
    });
    expect(mockRebindCurrentUser).not.toHaveBeenCalled();
    expect(mockHasAnyPermission).not.toHaveBeenCalled();
  });

  it('accepts the legacy repair flag but uses the unified idempotent readiness workflow', async () => {
    const caller = await createCallerForUser('user-member');

    await caller.ensureReadiness({ repairIamBinding: true });

    expect(mockReadinessEnsure).toHaveBeenCalledWith('user-member', {
      force: true,
      trigger: 'manual_retry',
    });
  });
});
