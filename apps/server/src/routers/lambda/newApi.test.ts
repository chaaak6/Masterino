// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { createContextInner } from '@/libs/trpc/lambda/context';

import { newApiRouter } from './newApi';

const {
  mockFindUserById,
  mockGetServerDB,
  mockHasAnyPermission,
  mockImportBindings,
  mockInitWithEnvKey,
  mockNewApiServiceConstructor,
  mockValidateBinding,
} = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockGetServerDB: vi.fn(),
  mockHasAnyPermission: vi.fn(),
  mockImportBindings: vi.fn(),
  mockInitWithEnvKey: vi.fn(),
  mockNewApiServiceConstructor: vi.fn(),
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
      getBindingStatus: vi.fn(),
      getUsageSummary: vi.fn(),
      importBindings: mockImportBindings,
      syncModels: vi.fn(),
      validateBinding: mockValidateBinding,
    };
  }),
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
    mockValidateBinding.mockResolvedValue({
      lobeUserId: 'lobe-user',
      newApiUserId: 7,
      ok: true,
      source: 'admin-api',
    });
  });

  it('allows importBindings through RBAC aihub:manage permission without legacy admin role', async () => {
    mockFindUserById.mockResolvedValue({ id: 'user-member', role: 'user' });
    mockHasAnyPermission.mockResolvedValue(true);
    const caller = await createCallerForUser('user-member');

    await expect(
      caller.importBindings({ rows: [{ email: 'ada@example.com' }] }),
    ).resolves.toEqual([
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
});
