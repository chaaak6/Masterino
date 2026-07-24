import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDefaultWecomUserNamingSyncer,
  createDefaultWorkspaceAssigner,
  provisionWecomLoginAccount,
} from './wecom-login-provisioning';

const defaultWorkspaceAssignerMocks = vi.hoisted(() => ({
  assignWorkspaceRoleToUser: vi.fn(),
  seedWorkspaceRoles: vi.fn(),
  workspaceMemberAddMember: vi.fn(),
  workspaceMemberGetMember: vi.fn(),
}));

vi.mock('@lobechat/database', () => ({
  assignWorkspaceRoleToUser: defaultWorkspaceAssignerMocks.assignWorkspaceRoleToUser,
  seedWorkspaceRoles: defaultWorkspaceAssignerMocks.seedWorkspaceRoles,
  serverDB: { id: 'mock-server-db' },
}));

vi.mock('@lobechat/const/rbac', () => ({
  WORKSPACE_SYSTEM_ROLES: {
    MEMBER: 'workspace_member',
  },
}));

vi.mock('@/database/models/workspaceMember', () => ({
  WorkspaceMemberModel: vi.fn().mockImplementation(() => ({
    addMember: defaultWorkspaceAssignerMocks.workspaceMemberAddMember,
    getMember: defaultWorkspaceAssignerMocks.workspaceMemberGetMember,
  })),
}));

const userModelMocks = vi.hoisted(() => ({
  findById: vi.fn(),
  findByUsername: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: Object.assign(
    vi.fn().mockImplementation(() => ({ updateUser: userModelMocks.update })),
    {
      findById: userModelMocks.findById,
      findByUsername: userModelMocks.findByUsername,
    },
  ),
}));

const account = {
  accountId: 'E001',
  providerId: 'wecom',
  userId: 'user_001',
};

const db = { id: 'server-db' };

const aihubProvisioning = {
  autoCreateUser: true,
  enabled: true,
  initialQuota: 100,
  lookupField: 'employeeNumber',
  managedTokenName: 'masterlion-managed',
  managedTokenQuota: 200,
  managedTokenUnlimitedQuota: false,
};

const createConfig = (overrides: { autoProvision?: boolean; enabled?: boolean } = {}) => ({
  config: {
    agentId: 'agent',
    aihubProvisioning,
    autoProvision: overrides.autoProvision ?? true,
    corpId: 'corp',
    defaultRole: 'member' as const,
    defaultWorkspaceId: 'workspace_001',
    departmentSync: {
      enabled: true,
      mode: 'login' as const,
    },
    enabled: overrides.enabled ?? true,
    enabledModes: ['web_qr' as const],
    identityMapping: {
      departmentField: 'department',
      emailField: 'email',
      employeeNumberField: 'userid',
      mobileField: 'mobile',
      nameField: 'name',
      positionField: 'position',
    },
    redirectUri: 'https://example.com/api/auth/oauth2/callback/wecom',
    trustedDomains: [],
  },
  corpSecretConfigured: true,
  displayName: 'WeCom',
  enabled: overrides.enabled ?? true,
  provider: 'wecom' as const,
});

describe('provisionWecomLoginAccount', () => {
  const getWecomSsoConfig = vi.fn();
  const provisionFromSsoProfile = vi.fn();
  const resolveWecomProfile = vi.fn();
  const userNamingSyncer = { syncNaming: vi.fn().mockResolvedValue(undefined) };

  beforeEach(() => {
    getWecomSsoConfig.mockReset();
    provisionFromSsoProfile.mockReset();
    resolveWecomProfile.mockReset();
    userNamingSyncer.syncNaming.mockReset();
    userNamingSyncer.syncNaming.mockResolvedValue(undefined);
    defaultWorkspaceAssignerMocks.assignWorkspaceRoleToUser.mockReset();
    defaultWorkspaceAssignerMocks.seedWorkspaceRoles.mockReset();
    defaultWorkspaceAssignerMocks.workspaceMemberAddMember.mockReset();
    defaultWorkspaceAssignerMocks.workspaceMemberGetMember.mockReset();
  });

  it('provisions a WeCom account with mapped profile, policy, and default role assigner', async () => {
    const rawProfile = {
      department: [10, '20'],
      email: 'e001@example.com',
      mobile: '13800000000',
      name: 'Employee One',
      position: 'Engineer',
      unionid: 'union_001',
      userid: 'E001',
    };
    getWecomSsoConfig.mockResolvedValue(createConfig());
    resolveWecomProfile.mockResolvedValue(rawProfile);
    provisionFromSsoProfile.mockResolvedValue({ userId: account.userId });

    await provisionWecomLoginAccount(
      { account },
      {
        db,
        getWecomSsoConfig,
        provisionFromSsoProfile,
        resolveWecomProfile,
        userNamingSyncer,
      },
    );

    expect(getWecomSsoConfig).toHaveBeenCalledWith(db);
    expect(resolveWecomProfile).toHaveBeenCalledWith(account.accountId);
    expect(provisionFromSsoProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        db,
        departmentExternalIds: ['10', '20'],
        email: 'e001@example.com',
        employeeNumber: 'E001',
        externalUserId: account.accountId,
        name: 'Employee One',
        policy: expect.objectContaining({
          aihubProvisioning,
          departmentSync: {
            enabled: true,
            mode: 'login',
          },
          defaultRole: 'member',
          defaultWorkspaceId: 'workspace_001',
        }),
        position: 'Engineer',
        provider: 'wecom',
        rawProfile,
        roleAssigner: expect.objectContaining({
          assignDefaultRole: expect.any(Function),
        }),
        unionId: 'union_001',
        userId: account.userId,
        workspaceAssigner: expect.objectContaining({
          assignDefaultWorkspace: expect.any(Function),
        }),
      }),
    );
  });

  it('syncs fullName (姓名) and username (工号) from the WeCom profile before provisioning', async () => {
    // Bug 3: every WeCom login must re-sync `users.fullName` ← 姓名 and
    // `users.username` ← 工号 so first-registration fallbacks self-heal.
    const rawProfile = {
      email: 'e001@example.com',
      name: '张三',
      userid: '10003923',
    };
    getWecomSsoConfig.mockResolvedValue(createConfig());
    resolveWecomProfile.mockResolvedValue(rawProfile);
    provisionFromSsoProfile.mockResolvedValue({ userId: account.userId });

    await provisionWecomLoginAccount(
      { account },
      {
        db,
        getWecomSsoConfig,
        provisionFromSsoProfile,
        resolveWecomProfile,
        userNamingSyncer,
      },
    );

    expect(userNamingSyncer.syncNaming).toHaveBeenCalledWith({
      fullName: '张三',
      userId: account.userId,
      username: '10003923',
    });
    // provisioning still runs after the sync
    expect(provisionFromSsoProfile).toHaveBeenCalledTimes(1);
  });

  it('falls back to accountId for username when the profile lacks the mapped employee field', async () => {
    const rawProfile = { email: 'e001@example.com', name: 'Employee One' };
    getWecomSsoConfig.mockResolvedValue(createConfig());
    resolveWecomProfile.mockResolvedValue(rawProfile);
    provisionFromSsoProfile.mockResolvedValue({ userId: account.userId });

    await provisionWecomLoginAccount(
      { account },
      {
        db,
        getWecomSsoConfig,
        provisionFromSsoProfile,
        resolveWecomProfile,
        userNamingSyncer,
      },
    );

    expect(userNamingSyncer.syncNaming).toHaveBeenCalledWith({
      fullName: 'Employee One',
      userId: account.userId,
      username: account.accountId,
    });
  });

  it.each([
    { autoProvision: true, enabled: false },
    { autoProvision: false, enabled: true },
  ])(
    'skips provisioning when enabled=$enabled and autoProvision=$autoProvision',
    async (overrides) => {
      getWecomSsoConfig.mockResolvedValue(createConfig(overrides));

      await provisionWecomLoginAccount(
        { account },
        {
          db,
          getWecomSsoConfig,
          provisionFromSsoProfile,
          resolveWecomProfile,
        },
      );

      expect(resolveWecomProfile).not.toHaveBeenCalled();
      expect(provisionFromSsoProfile).not.toHaveBeenCalled();
    },
  );

  it('ignores non-WeCom account providers', async () => {
    await provisionWecomLoginAccount(
      {
        account: {
          ...account,
          providerId: 'github',
        },
      },
      {
        db,
        getWecomSsoConfig,
        provisionFromSsoProfile,
        resolveWecomProfile,
      },
    );

    expect(getWecomSsoConfig).not.toHaveBeenCalled();
    expect(resolveWecomProfile).not.toHaveBeenCalled();
    expect(provisionFromSsoProfile).not.toHaveBeenCalled();
  });

  it('does not overwrite an existing active workspace member role when assigning the default workspace', async () => {
    defaultWorkspaceAssignerMocks.workspaceMemberGetMember.mockResolvedValue({
      role: 'owner',
      userId: account.userId,
      workspaceId: 'workspace_001',
    });

    await createDefaultWorkspaceAssigner(db).assignDefaultWorkspace({
      role: 'member',
      userId: account.userId,
      workspaceId: 'workspace_001',
    });

    expect(defaultWorkspaceAssignerMocks.workspaceMemberGetMember).toHaveBeenCalledWith(
      'workspace_001',
      account.userId,
    );
    expect(defaultWorkspaceAssignerMocks.workspaceMemberAddMember).not.toHaveBeenCalled();
    expect(defaultWorkspaceAssignerMocks.seedWorkspaceRoles).toHaveBeenCalledWith(
      db,
      'workspace_001',
    );
    expect(defaultWorkspaceAssignerMocks.assignWorkspaceRoleToUser).toHaveBeenCalledWith(db, {
      roleName: 'workspace_member',
      userId: account.userId,
      workspaceId: 'workspace_001',
    });
  });
});

describe('createDefaultWecomUserNamingSyncer', () => {
  const syncer = createDefaultWecomUserNamingSyncer(db);

  beforeEach(() => {
    userModelMocks.findById.mockReset();
    userModelMocks.findByUsername.mockReset();
    userModelMocks.update.mockReset();
  });

  it('updates fullName and username when they differ and the username is free', async () => {
    userModelMocks.findById.mockResolvedValue({ fullName: 'Old', id: 'user_001', username: 'old' });
    userModelMocks.findByUsername.mockResolvedValue(undefined);

    await syncer.syncNaming({ fullName: '张三', userId: 'user_001', username: '10003923' });

    expect(userModelMocks.findById).toHaveBeenCalledWith(db, 'user_001');
    expect(userModelMocks.findByUsername).toHaveBeenCalledWith(db, '10003923');
    expect(userModelMocks.update).toHaveBeenCalledWith({
      fullName: '张三',
      username: '10003923',
    });
  });

  it('skips the username update when another user already owns that username', async () => {
    userModelMocks.findById.mockResolvedValue({ fullName: '', id: 'user_001', username: 'old' });
    userModelMocks.findByUsername.mockResolvedValue({ id: 'user_002', username: '10003923' });

    await syncer.syncNaming({ fullName: '张三', userId: 'user_001', username: '10003923' });

    expect(userModelMocks.update).toHaveBeenCalledWith({ fullName: '张三' });
  });

  it('does nothing when the user already has the desired values', async () => {
    userModelMocks.findById.mockResolvedValue({
      fullName: '张三',
      id: 'user_001',
      username: '10003923',
    });

    await syncer.syncNaming({ fullName: '张三', userId: 'user_001', username: '10003923' });

    expect(userModelMocks.findByUsername).not.toHaveBeenCalled();
    expect(userModelMocks.update).not.toHaveBeenCalled();
  });

  it('skips silently when the user no longer exists', async () => {
    userModelMocks.findById.mockResolvedValue(undefined);

    await syncer.syncNaming({ fullName: '张三', userId: 'gone', username: '10003923' });

    expect(userModelMocks.update).not.toHaveBeenCalled();
  });
});
