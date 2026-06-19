type AccountLike = {
  accountId: string;
  providerId: string;
  userId: string;
};

type WecomProfile = Record<string, unknown>;

type WecomIdentityMapping = {
  departmentField: string;
  emailField: string;
  employeeNumberField: string;
  nameField: string;
  positionField: string;
};

type WecomSsoConfigLike = {
  config: {
    aihubProvisioning?: Record<string, unknown>;
    autoProvision: boolean;
    defaultRole?: 'admin' | 'member' | 'owner' | 'viewer';
    defaultWorkspaceId?: string;
    departmentSync?: {
      enabled?: boolean;
      mode?: 'login' | 'manual' | 'scheduled';
    };
    identityMapping: WecomIdentityMapping;
  };
  enabled: boolean;
};

type RoleAssigner = {
  assignDefaultRole: (input: { roleName: string; userId: string }) => Promise<void>;
};

type WorkspaceAssigner = {
  assignDefaultWorkspace: (input: {
    role: 'member';
    userId: string;
    workspaceId: string;
  }) => Promise<void>;
};

type ProvisionWecomLoginDeps = {
  db?: unknown;
  getWecomSsoConfig?: (db: unknown) => Promise<WecomSsoConfigLike>;
  provisionFromSsoProfile?: (input: Record<string, unknown>) => Promise<unknown>;
  resolveWecomProfile?: (accountId: string) => Promise<WecomProfile>;
  roleAssigner?: RoleAssigner;
  workspaceAssigner?: WorkspaceAssigner;
};

export type ProvisionWecomLoginAccountInput = {
  account: AccountLike;
  context?: unknown;
};

const WECOM_PROVIDER_ID = 'wecom';
const WECOM_TOKEN_URL = 'https://qyapi.weixin.qq.com/cgi-bin/gettoken';
const WECOM_USER_DETAIL_URL = 'https://qyapi.weixin.qq.com/cgi-bin/user/get';

const roleIdKeyByDefaultRole = {
  admin: 'enterpriseAdminRoleId',
  member: 'enterpriseMemberRoleId',
  owner: 'platformAdminRoleId',
  viewer: 'enterpriseViewerRoleId',
} as const;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asTrimmedString = (value: unknown) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
};

const getMappedString = (profile: WecomProfile, field: string) => asTrimmedString(profile[field]);

const getDepartmentExternalIds = (profile: WecomProfile, field: string) => {
  const value = profile[field];
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];

  return values.map(asTrimmedString).filter((item): item is string => Boolean(item));
};

const createDefaultRoleAssigner = (db: unknown): RoleAssigner => ({
  assignDefaultRole: async ({ roleName, userId }) => {
    const [{ seedEnterpriseRoles }, { userRoles }] = await Promise.all([
      import('@lobechat/database'),
      import('@lobechat/database/schemas'),
    ]);

    const seededRoles = await seedEnterpriseRoles(db as never);
    const roleIdKey = roleIdKeyByDefaultRole[roleName as keyof typeof roleIdKeyByDefaultRole];
    if (!roleIdKey) {
      throw new Error(`Unsupported default enterprise role: ${roleName}`);
    }

    await (db as any)
      .insert(userRoles)
      .values({
        roleId: seededRoles[roleIdKey],
        userId,
      })
      .onConflictDoNothing();
  },
});

export const createDefaultWorkspaceAssigner = (db: unknown): WorkspaceAssigner => ({
  assignDefaultWorkspace: async ({ role, userId, workspaceId }) => {
    const [
      { assignWorkspaceRoleToUser, seedWorkspaceRoles },
      { WORKSPACE_SYSTEM_ROLES },
      { WorkspaceMemberModel },
    ] = await Promise.all([
      import('@lobechat/database'),
      import('@lobechat/const/rbac'),
      import('@/database/models/workspaceMember'),
    ]);

    const workspaceMemberModel = new WorkspaceMemberModel(db as never, userId);
    const existingMember = await workspaceMemberModel.getMember(workspaceId, userId);
    if (!existingMember) {
      await workspaceMemberModel.addMember({
        role,
        userId,
        workspaceId,
      });
    }
    await seedWorkspaceRoles(db as never, workspaceId);
    await assignWorkspaceRoleToUser(db as never, {
      roleName: WORKSPACE_SYSTEM_ROLES.MEMBER,
      userId,
      workspaceId,
    });
  },
});

const resolveDefaultDependencies = async (deps: ProvisionWecomLoginDeps) => {
  const db = deps.db ?? (await import('@lobechat/database')).serverDB;
  const getWecomSsoConfig =
    deps.getWecomSsoConfig ??
    (await import('@/server/services/enterprise/wecomSsoService')).getWecomSsoConfig;
  const provisionFromSsoProfile =
    deps.provisionFromSsoProfile ??
    (await import('@/server/services/enterprise/identityProvisioningService'))
      .provisionFromSsoProfile;

  return {
    db,
    getWecomSsoConfig: getWecomSsoConfig as (db: unknown) => Promise<WecomSsoConfigLike>,
    provisionFromSsoProfile: provisionFromSsoProfile as (
      input: Record<string, unknown>,
    ) => Promise<unknown>,
    resolveWecomProfile: deps.resolveWecomProfile ?? resolveWecomProfile,
    roleAssigner: deps.roleAssigner ?? createDefaultRoleAssigner(db),
    workspaceAssigner: deps.workspaceAssigner ?? createDefaultWorkspaceAssigner(db),
  };
};

export const resolveWecomProfile = async (accountId: string): Promise<WecomProfile> => {
  try {
    const { getWecomSsoRuntimeConfig } = await import(
      '@/server/services/enterprise/wecomSsoService'
    );
    const runtimeConfig = await getWecomSsoRuntimeConfig();
    const tokenUrl = new URL(WECOM_TOKEN_URL);
    tokenUrl.searchParams.set('corpid', runtimeConfig.corpId);
    tokenUrl.searchParams.set('corpsecret', runtimeConfig.corpSecret);

    const tokenResponse = await fetch(tokenUrl, { cache: 'no-store' });
    const tokenData = asRecord(await tokenResponse.json());
    const accessToken = asTrimmedString(tokenData.access_token);

    if (!tokenResponse.ok || !accessToken || tokenData.errcode) {
      return { userid: accountId };
    }

    const detailUrl = new URL(WECOM_USER_DETAIL_URL);
    detailUrl.searchParams.set('access_token', accessToken);
    detailUrl.searchParams.set('userid', accountId);

    const detailResponse = await fetch(detailUrl, { cache: 'no-store' });
    const profile = asRecord(await detailResponse.json());

    if (!detailResponse.ok || profile.errcode) {
      return { userid: accountId };
    }

    return {
      userid: accountId,
      ...profile,
    };
  } catch {
    return { userid: accountId };
  }
};

export const provisionWecomLoginAccount = async (
  input: ProvisionWecomLoginAccountInput,
  deps: ProvisionWecomLoginDeps = {},
) => {
  const { account } = input;
  if (account.providerId !== WECOM_PROVIDER_ID) return;

  const {
    db,
    getWecomSsoConfig,
    provisionFromSsoProfile,
    resolveWecomProfile: resolveProfile,
    roleAssigner,
    workspaceAssigner,
  } = await resolveDefaultDependencies(deps);
  const ssoConfig = await getWecomSsoConfig(db);

  if (!ssoConfig.enabled || !ssoConfig.config.autoProvision) return;

  const rawProfile = await resolveProfile(account.accountId);
  const mapping = ssoConfig.config.identityMapping;

  return provisionFromSsoProfile({
    db,
    departmentExternalIds: getDepartmentExternalIds(rawProfile, mapping.departmentField),
    email: getMappedString(rawProfile, mapping.emailField),
    employeeNumber: getMappedString(rawProfile, mapping.employeeNumberField) ?? account.accountId,
    externalUserId: account.accountId,
    name: getMappedString(rawProfile, mapping.nameField),
    policy: {
      aihubProvisioning: ssoConfig.config.aihubProvisioning,
      departmentSync: ssoConfig.config.departmentSync,
      defaultRole: ssoConfig.config.defaultRole,
      defaultWorkspaceId: ssoConfig.config.defaultWorkspaceId,
    },
    position: getMappedString(rawProfile, mapping.positionField),
    provider: WECOM_PROVIDER_ID,
    rawProfile,
    roleAssigner,
    unionId: asTrimmedString(rawProfile.unionid) ?? asTrimmedString(rawProfile.UnionId),
    userId: account.userId,
    workspaceAssigner,
  });
};
