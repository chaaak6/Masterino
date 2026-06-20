import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
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

  beforeEach(() => {
    getWecomSsoConfig.mockReset();
    provisionFromSsoProfile.mockReset();
    resolveWecomProfile.mockReset();
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
