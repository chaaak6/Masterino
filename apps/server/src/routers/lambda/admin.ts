import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, ilike, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';

import { provisionWecomLoginAccount } from '@/libs/better-auth/wecom-login-provisioning';
import {
  type PrincipalType,
  ResourceAclRepository,
  type ResourcePermission,
  type ResourceType,
} from '@/database/repositories/enterprise/resourceAclRepository';
import {
  enterpriseAuditLogs,
  enterpriseDepartmentMembers,
  enterpriseDepartments,
  enterpriseUserProfiles,
  externalIdentities,
  knowledgeBaseFiles,
  knowledgeBases,
  newApiBindings,
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
  workspaces,
} from '@/database/schemas';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  type AdminRbacPermissionCode,
  requireAdminAccess,
  requireAdminRbacPermission,
} from '@/server/services/enterprise/adminPermissionService';
import { applyEnterpriseDirectorySnapshot } from '@/server/services/enterprise/directorySyncService';
import { resolveResourceAclScope } from '@/server/services/enterprise/resourceAclService';
import {
  getWecomSsoConfig,
  upsertWecomSsoConfig,
  wecomSsoUpdateInputSchema,
} from '@/server/services/enterprise/wecomSsoService';

type PlatformAdminRole = 'platform_admin' | 'super_admin';

interface AdminAuditLogItem {
  action: string;
  actor: string;
  id: string;
  resource: string;
  result: string;
  time: string;
}

interface AdminKnowledgeBaseItem {
  id: string;
  name: string;
  resources: number;
  updatedAt: string;
  visibility: string;
  workspace: string;
  workspaceId?: null | string;
}

interface AdminMcpConnectorItem {
  id: string;
  name: string;
  policy: string;
  toolCount: number;
  type: string;
  workspace: string;
}

interface AdminRoleItem {
  description: string;
  id: string;
  isActive?: boolean;
  isSystem?: boolean;
  name: string;
  permissions: string[];
  workspaceId?: null | string;
}

interface AdminSkillPolicyItem {
  id: string;
  name: string;
  policy: string;
  scope: string;
  source: string;
}

interface AdminUserListItem {
  email: string;
  id: string;
  name: string;
  role: string;
  status: string;
}

interface AdminUserAihubBinding {
  errorMessage: null | string;
  isBound: boolean;
  lastSyncedAt: null | string;
  managedTokenId: null | number;
  newApiUserId?: number;
  status: 'active' | 'error' | 'missing' | 'pending';
}

interface AdminUserDetail {
  aihubBinding: AdminUserAihubBinding;
  auditLogs: AdminAuditLogItem[];
  enterpriseProfile: null | {
    employeeNumber: null | string;
    employmentStatus: null | string;
    externalUserId: null | string;
    lastSyncedAt: null | string;
    position: null | string;
    primaryDepartmentId: null | string;
    provider: null | string;
  };
  externalIdentity: null | {
    email: null | string;
    externalUserId: string;
    provider: string;
    unionId: null | string;
  };
  user: AdminUserListItem & {
    createdAt: string;
    updatedAt: string;
  };
}

interface AdminResourceGrantItem {
  createdBy?: null | string;
  id: string;
  permission: ResourcePermission;
  principalId: string;
  principalType: PrincipalType;
  resourceId: string;
  resourceType: ResourceType;
  updatedAt: string;
  workspaceId?: null | string;
}

interface AdminWorkspaceItem {
  createdAt: string;
  id: string;
  memberCount: number;
  name: string;
  resourceCount: number;
}

interface AdminOrgDepartmentNode {
  children: AdminOrgDepartmentNode[];
  externalDepartmentId: null | string;
  id: string;
  memberCount: number;
  name: string;
  parentId: null | string;
  provider: string;
  status: string;
}

interface AdminOrgMemberItem {
  departmentId: string;
  email: string;
  employeeNumber: null | string;
  employmentStatus: null | string;
  isPrimary: boolean;
  name: string;
  position: null | string;
  status: string;
  userId: string;
}

interface AdminOrgMembershipRow {
  departmentId: string;
  isPrimary?: boolean | null;
  status?: null | string;
  userId: string;
}

interface AdminOrgUserProfileRow {
  employeeNumber?: null | string;
  employmentStatus?: null | string;
  position?: null | string;
  primaryDepartmentId?: null | string;
  userId: string;
}

interface AdminOrgUserRow {
  banned?: boolean | null;
  email?: null | string;
  fullName?: null | string;
  id: string;
  username?: null | string;
}

const paginationInput = z.object({
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(100).default(20),
  q: z.string().optional(),
});

const departmentMembersInput = z.object({
  departmentId: z.string(),
});

const departmentUpsertInput = z.object({
  externalDepartmentId: z.string(),
  id: z.string().optional(),
  name: z.string(),
  order: z.number().optional(),
  parentId: z.string().nullable().optional(),
  provider: z.string(),
  status: z.string().optional(),
});

const memberMoveInput = z.object({
  departmentId: z.string(),
  isPrimary: z.boolean().optional(),
  userId: z.string(),
});

const directoryDepartmentSnapshotInput = z.object({
  externalDepartmentId: z.string().min(1),
  name: z.string().min(1),
  order: z.number().optional(),
  parentExternalDepartmentId: z.string().min(1).optional(),
  rawProfile: z.record(z.unknown()).optional(),
  status: z.string().optional(),
});

const directoryMemberSnapshotInput = z.object({
  departments: z.array(z.string().min(1)).default([]),
  employeeNumber: z.string().min(1),
  externalUserId: z.string().min(1),
  name: z.string().min(1),
  position: z.string().optional(),
  primaryDepartmentExternalId: z.string().min(1).optional(),
  rawProfile: z.record(z.unknown()).optional(),
  userId: z.string().min(1),
});

const directorySyncRunInput = z.object({
  missingMemberPolicy: z.enum(['ignore', 'mark_inactive']).default('ignore'),
  provider: z.literal('wecom'),
  snapshot: z.object({
    departments: z.array(directoryDepartmentSnapshotInput).default([]),
    members: z.array(directoryMemberSnapshotInput).default([]),
  }),
});

const userIdInput = z.object({
  userId: z.string().min(1),
});

const updateUserStatusInput = userIdInput.extend({
  banned: z.boolean(),
  reason: z.string().trim().optional(),
});

const assignUserRolesInput = userIdInput.extend({
  roleIds: z.array(z.string().min(1)).default([]),
});

const createRoleInput = z.object({
  description: z.string().trim().optional(),
  displayName: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(100),
});

const updateRoleInput = z
  .object({
    description: z.string().trim().optional(),
    displayName: z.string().trim().min(1).max(100).optional(),
    roleId: z.string().min(1),
  })
  .refine((input) => input.description !== undefined || input.displayName !== undefined, {
    message: 'At least one role field must be provided',
  });

const updateRoleStatusInput = z.object({
  isActive: z.boolean(),
  roleId: z.string().min(1),
});

const updateRolePermissionsInput = z.object({
  permissionCodes: z.array(z.string().min(1)).default([]),
  roleId: z.string().min(1),
});

const resourceTypes = [
  'knowledge_base',
  'folder',
  'document',
  'file',
  'skill',
  'connector',
] as const satisfies readonly [ResourceType, ...ResourceType[]];
const principalTypes = ['user', 'role', 'workspace', 'department'] as const satisfies readonly [
  PrincipalType,
  ...PrincipalType[],
];
const resourcePermissions = ['read', 'write', 'manage'] as const satisfies readonly [
  ResourcePermission,
  ...ResourcePermission[],
];

const resourceInputSchema = z.object({
  resourceId: z.string(),
  resourceType: z.enum(resourceTypes),
});

const grantResourceInputSchema = resourceInputSchema.extend({
  permission: z.enum(resourcePermissions),
  principalId: z.string(),
  principalType: z.enum(principalTypes),
});

const adminRoles: AdminRoleItem[] = [
  {
    description: '平台级管理后台访问与审计权限',
    id: 'platform_admin',
    name: '平台管理员',
    permissions: ['users:*', 'workspace:*', 'knowledge:*', 'mcp:*', 'system:*'],
  },
  {
    description: '系统最高权限，保留给紧急运维和平台所有者',
    id: 'super_admin',
    name: '超级管理员',
    permissions: ['users:*', 'workspace:*', 'knowledge:*', 'mcp:*', 'system:*'],
  },
];

const defaultSystemConfig = {
  knowledge: {
    defaultVisibility: 'workspace',
    enabled: true,
    maxResourcesPerBase: 0,
  },
  skillMcp: {
    defaultMcpPolicy: 'review_required',
    defaultSkillPolicy: 'review_required',
    mcpEnabled: true,
    skillsEnabled: true,
  },
  upload: {
    allowedTypes: [] as string[],
    maxFileSizeMb: 0,
    retentionDays: 0,
  },
};

const emptyList = <T>() => ({ items: [] as T[], total: 0 });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getServerDBFromContext = (ctx: unknown) => {
  const serverDB = isRecord(ctx) ? ctx.serverDB : undefined;

  if (!serverDB) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Server DB is not available' });
  }

  return serverDB as never;
};

const toIsoString = (value: unknown) =>
  value instanceof Date ? value.toISOString() : value ? String(value) : '';

const countRows = async (db: any, table: any, where?: any, fallback = 0) => {
  if (typeof db.select !== 'function') return fallback;

  try {
    const [row] = await db.select({ total: count() }).from(table).where(where);

    return Number(row?.total ?? fallback);
  } catch {
    return fallback;
  }
};

const mapAdminUser = (user: any): AdminUserListItem => ({
  email: user.email ?? '',
  id: user.id,
  name: user.fullName || user.username || user.email || user.id,
  role: user.role || 'user',
  status: user.banned ? '禁用' : '正常',
});

const asPositiveNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

const mapAdminAihubBinding = (binding: any): AdminUserAihubBinding => {
  if (!binding) {
    return {
      errorMessage: null,
      isBound: false,
      lastSyncedAt: null,
      managedTokenId: null,
      status: 'missing',
    };
  }

  const newApiUserId = asPositiveNumber(binding.newApiUserId);
  const base = {
    errorMessage: binding.errorMessage ?? null,
    lastSyncedAt: binding.lastSyncedAt ? toIsoString(binding.lastSyncedAt) : null,
    managedTokenId: binding.managedTokenId ?? null,
  };

  if (binding.status === 'error') {
    return {
      ...base,
      ...(newApiUserId ? { newApiUserId } : {}),
      isBound: false,
      status: 'error',
    };
  }

  if (!newApiUserId) {
    return {
      ...base,
      isBound: false,
      status: binding.status === 'pending' ? 'pending' : 'missing',
    };
  }

  return {
    ...base,
    isBound: true,
    newApiUserId,
    status: binding.status ?? 'active',
  };
};

const mapEnterpriseProfile = (profile: any): AdminUserDetail['enterpriseProfile'] =>
  profile
    ? {
        employeeNumber: profile.employeeNumber ?? null,
        employmentStatus: profile.employmentStatus ?? null,
        externalUserId: profile.externalUserId ?? null,
        lastSyncedAt: profile.lastSyncedAt ? toIsoString(profile.lastSyncedAt) : null,
        position: profile.position ?? null,
        primaryDepartmentId: profile.primaryDepartmentId ?? null,
        provider: profile.provider ?? null,
      }
    : null;

const mapExternalIdentity = (identity: any): AdminUserDetail['externalIdentity'] =>
  identity
    ? {
        email: identity.email ?? null,
        externalUserId: identity.externalUserId,
        provider: identity.provider,
        unionId: identity.unionId ?? null,
      }
    : null;

const mapAuditLog = (row: any): AdminAuditLogItem => ({
  action: row.action,
  actor: row.actorUserId ?? 'system',
  id: row.id,
  resource: row.targetId ? `${row.targetType}:${row.targetId}` : row.targetType,
  result: row.result,
  time: toIsoString(row.createdAt),
});

const writeEnterpriseAuditLog = async (
  db: any,
  input: {
    action: string;
    actorUserId?: null | string;
    metadata?: Record<string, unknown>;
    result: string;
    targetId?: null | string;
    targetType: string;
  },
) => {
  if (typeof db.insert !== 'function') return;

  await db.insert(enterpriseAuditLogs).values({
    action: input.action,
    actorUserId: input.actorUserId ?? null,
    metadata: input.metadata ?? {},
    result: input.result,
    targetId: input.targetId ?? null,
    targetType: input.targetType,
  });
};

const getAdminUserDetail = async (
  ctx: unknown,
  input: z.infer<typeof userIdInput>,
): Promise<AdminUserDetail> => {
  const db = getServerDBFromContext(ctx) as any;

  if (typeof db.query?.users?.findFirst !== 'function') {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'User detail query is not available',
    });
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, input.userId),
  });

  if (!user) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
  }

  const [profile, identity, binding, auditRows] = await Promise.all([
    typeof db.query?.enterpriseUserProfiles?.findFirst === 'function'
      ? db.query.enterpriseUserProfiles.findFirst({
          where: eq(enterpriseUserProfiles.userId, input.userId),
        })
      : undefined,
    typeof db.query?.externalIdentities?.findFirst === 'function'
      ? db.query.externalIdentities.findFirst({
          where: and(
            eq(externalIdentities.userId, input.userId),
            eq(externalIdentities.provider, 'wecom'),
          ),
        })
      : undefined,
    typeof db.query?.newApiBindings?.findFirst === 'function'
      ? db.query.newApiBindings.findFirst({
          where: eq(newApiBindings.userId, input.userId),
        })
      : undefined,
    typeof db.query?.enterpriseAuditLogs?.findMany === 'function'
      ? db.query.enterpriseAuditLogs.findMany({
          limit: 10,
          orderBy: [desc(enterpriseAuditLogs.createdAt)],
          where: and(
            eq(enterpriseAuditLogs.targetType, 'user'),
            eq(enterpriseAuditLogs.targetId, input.userId),
          ),
        })
      : [],
  ]);
  const mappedUser = mapAdminUser(user);

  return {
    aihubBinding: mapAdminAihubBinding(binding),
    auditLogs: (auditRows ?? []).map(mapAuditLog),
    enterpriseProfile: mapEnterpriseProfile(profile),
    externalIdentity: mapExternalIdentity(identity),
    user: {
      ...mappedUser,
      createdAt: toIsoString(user.createdAt),
      updatedAt: toIsoString(user.updatedAt),
    },
  };
};

const retryEnterpriseUserProvisioning = async (
  ctx: unknown,
  input: z.infer<typeof userIdInput>,
  actorUserId: string,
) => {
  const db = getServerDBFromContext(ctx) as any;

  if (typeof db.query?.externalIdentities?.findFirst !== 'function') {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'External identity query is not available',
    });
  }

  const identity = await db.query.externalIdentities.findFirst({
    where: and(eq(externalIdentities.userId, input.userId), eq(externalIdentities.provider, 'wecom')),
  });

  if (!identity) {
    await writeEnterpriseAuditLog(db, {
      action: 'identity.provision.retry',
      actorUserId,
      metadata: { reason: 'wecom_identity_not_found' },
      result: 'failed',
      targetId: input.userId,
      targetType: 'user',
    });
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'WeCom identity not found for user',
    });
  }

  try {
    const result = await provisionWecomLoginAccount(
      {
        account: {
          accountId: identity.externalUserId,
          providerId: 'wecom',
          userId: input.userId,
        },
        context: {
          actorUserId,
          source: 'admin.retryProvisioning',
        },
      },
      { db },
    );
    const status = result === undefined ? 'skipped' : 'success';

    await writeEnterpriseAuditLog(db, {
      action: 'identity.provision.retry',
      actorUserId,
      metadata: {
        externalUserId: identity.externalUserId,
        provider: identity.provider,
        ...(status === 'skipped' ? { reason: 'provisioning_not_executed' } : {}),
      },
      result: status,
      targetId: input.userId,
      targetType: 'user',
    });

    return {
      ok: true,
      provisioned: status === 'success',
      result,
      status,
      userId: input.userId,
    };
  } catch (error) {
    await writeEnterpriseAuditLog(db, {
      action: 'identity.provision.retry',
      actorUserId,
      metadata: { error: error instanceof Error ? error.message : String(error) },
      result: 'failed',
      targetId: input.userId,
      targetType: 'user',
    });
    throw error;
  }
};

const updateAdminUserStatus = async (
  ctx: unknown,
  input: z.infer<typeof updateUserStatusInput>,
  actorUserId: string,
) => {
  const db = getServerDBFromContext(ctx) as any;
  const values = {
    banExpires: null,
    banReason: input.banned ? input.reason ?? null : null,
    banned: input.banned,
  };
  const updateResult = await db.update(users).set(values).where(eq(users.id, input.userId));
  const updatedUser = Array.isArray(updateResult)
    ? updateResult[0]
    : typeof db.query?.users?.findFirst === 'function'
      ? await db.query.users.findFirst({ where: eq(users.id, input.userId) })
      : undefined;

  if (!updatedUser) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
  }

  await writeEnterpriseAuditLog(db, {
    action: 'user.status.update',
    actorUserId,
    metadata: {
      banned: input.banned,
      reason: input.reason ?? null,
    },
    result: 'success',
    targetId: input.userId,
    targetType: 'user',
  });

  return mapAdminUser(updatedUser);
};

const assignAdminUserRoles = async (
  ctx: unknown,
  input: z.infer<typeof assignUserRolesInput>,
  actorUserId: string,
) => {
  const db = getServerDBFromContext(ctx) as any;
  const roleIds = [...new Set(input.roleIds)];

  if (roleIds.length > 0) {
    if (typeof db.query?.roles?.findMany !== 'function') {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Role query is not available',
      });
    }

    const roleRows = await db.query.roles.findMany({
      where: inArray(roles.id, roleIds),
    });
    const roleById = new Map<string, any>(roleRows.map((role: any) => [role.id, role]));
    const invalidRoleIds = roleIds.filter((roleId) => {
      const role = roleById.get(roleId);

      return !role || role.isActive !== true || role.workspaceId !== null;
    });

    if (invalidRoleIds.length > 0) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `Only active global roles can be assigned: ${invalidRoleIds.join(', ')}`,
      });
    }
  }

  const replaceGlobalRoles = async (tx: any) => {
    await tx
      .delete(userRoles)
      .where(and(eq(userRoles.userId, input.userId), isNull(userRoles.workspaceId)));

    if (roleIds.length === 0) return;

    const insertResult = tx.insert(userRoles).values(
      roleIds.map((roleId) => ({
        roleId,
        userId: input.userId,
        workspaceId: null,
      })),
    );

    if (typeof insertResult.onConflictDoNothing === 'function') {
      await insertResult.onConflictDoNothing();
    } else {
      await insertResult;
    }
  };

  if (typeof db.transaction === 'function') {
    await db.transaction(replaceGlobalRoles);
  } else {
    await replaceGlobalRoles(db);
  }

  await writeEnterpriseAuditLog(db, {
    action: 'user.roles.assign',
    actorUserId,
    metadata: { roleIds },
    result: 'success',
    targetId: input.userId,
    targetType: 'user',
  });

  return {
    roleIds,
    userId: input.userId,
  };
};

const toNullableText = (value: undefined | string) => {
  if (value === undefined) return null;

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
};

const mapAdminRole = (role: any, permissions: string[] = []): AdminRoleItem => ({
  description: role.description ?? '',
  id: role.id,
  ...(typeof role.isActive === 'boolean' ? { isActive: role.isActive } : {}),
  ...(typeof role.isSystem === 'boolean' ? { isSystem: role.isSystem } : {}),
  name: role.displayName || role.name,
  permissions,
  ...(role.workspaceId !== undefined ? { workspaceId: role.workspaceId ?? null } : {}),
});

const isUniqueConstraintError = (error: unknown) => {
  if (!isRecord(error)) return false;

  if (error.code === '23505') return true;

  return isUniqueConstraintError(error.cause);
};

const getAdminRoleById = async (db: any, roleId: string) => {
  if (typeof db.query?.roles?.findFirst !== 'function') {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Role query is not available',
    });
  }

  const role = await db.query.roles.findFirst({
    where: eq(roles.id, roleId),
  });

  if (!role) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Role not found' });
  }

  return role;
};

const assertGlobalCustomRole = (role: any, options: { requireActive: boolean }) => {
  if (role.isSystem === true || role.workspaceId !== null) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Only global custom roles can be updated',
    });
  }

  if (options.requireActive && role.isActive !== true) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Only active global custom roles can be updated',
    });
  }
};

const createAdminRole = async (
  ctx: unknown,
  input: z.infer<typeof createRoleInput>,
  actorUserId: string,
) => {
  const db = getServerDBFromContext(ctx) as any;
  const values = {
    description: toNullableText(input.description),
    displayName: input.displayName,
    isActive: true,
    isSystem: false,
    name: input.name,
    workspaceId: null,
  };

  const writeRole = async (tx: any) => {
    const [role] = await tx.insert(roles).values(values).returning();

    await writeEnterpriseAuditLog(tx, {
      action: 'role.create',
      actorUserId,
      metadata: {
        description: values.description,
        displayName: values.displayName,
        name: values.name,
      },
      result: 'success',
      targetId: role.id,
      targetType: 'role',
    });

    return role;
  };

  let role: any;

  try {
    role = typeof db.transaction === 'function' ? await db.transaction(writeRole) : await writeRole(db);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: `Role name "${input.name}" already exists`,
      });
    }

    throw error;
  }

  return mapAdminRole(role);
};

const updateAdminRole = async (
  ctx: unknown,
  input: z.infer<typeof updateRoleInput>,
  actorUserId: string,
) => {
  const db = getServerDBFromContext(ctx) as any;
  const role = await getAdminRoleById(db, input.roleId);

  assertGlobalCustomRole(role, { requireActive: true });

  const values = {
    ...(input.description !== undefined ? { description: toNullableText(input.description) } : {}),
    ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
    updatedAt: new Date(),
  };
  const updateRole = async (tx: any) => {
    const [updatedRole] = await tx
      .update(roles)
      .set(values)
      .where(
        and(
          eq(roles.id, input.roleId),
          eq(roles.isSystem, false),
          isNull(roles.workspaceId),
          eq(roles.isActive, true),
        ),
      )
      .returning();

    if (!updatedRole) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Role is no longer eligible for update',
      });
    }

    await writeEnterpriseAuditLog(tx, {
      action: 'role.update',
      actorUserId,
      metadata: {
        ...(input.description !== undefined
          ? { description: toNullableText(input.description) }
          : {}),
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        roleId: input.roleId,
      },
      result: 'success',
      targetId: input.roleId,
      targetType: 'role',
    });

    return updatedRole;
  };
  const updatedRole =
    typeof db.transaction === 'function' ? await db.transaction(updateRole) : await updateRole(db);

  return mapAdminRole(updatedRole);
};

const updateAdminRoleStatus = async (
  ctx: unknown,
  input: z.infer<typeof updateRoleStatusInput>,
  actorUserId: string,
) => {
  const db = getServerDBFromContext(ctx) as any;
  const role = await getAdminRoleById(db, input.roleId);

  assertGlobalCustomRole(role, { requireActive: false });

  const updateRoleStatus = async (tx: any) => {
    const [updatedRole] = await tx
      .update(roles)
      .set({ isActive: input.isActive, updatedAt: new Date() })
      .where(
        and(eq(roles.id, input.roleId), eq(roles.isSystem, false), isNull(roles.workspaceId)),
      )
      .returning();

    if (!updatedRole) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Role is no longer eligible for status update',
      });
    }

    await writeEnterpriseAuditLog(tx, {
      action: 'role.status.update',
      actorUserId,
      metadata: { isActive: input.isActive },
      result: 'success',
      targetId: input.roleId,
      targetType: 'role',
    });

    return updatedRole;
  };
  const updatedRole =
    typeof db.transaction === 'function'
      ? await db.transaction(updateRoleStatus)
      : await updateRoleStatus(db);

  return mapAdminRole(updatedRole);
};

const updateAdminRolePermissions = async (
  ctx: unknown,
  input: z.infer<typeof updateRolePermissionsInput>,
  actorUserId: string,
) => {
  const db = getServerDBFromContext(ctx) as any;
  const permissionCodes = [...new Set(input.permissionCodes)];

  if (typeof db.query?.roles?.findFirst !== 'function') {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Role query is not available',
    });
  }

  const role = await db.query.roles.findFirst({
    where: eq(roles.id, input.roleId),
  });

  if (!role) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Role not found' });
  }

  if (role.isActive !== true || role.workspaceId !== null) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Only active global roles can be updated',
    });
  }

  let permissionRows: any[] = [];

  if (permissionCodes.length > 0) {
    if (typeof db.query?.permissions?.findMany !== 'function') {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Permission query is not available',
      });
    }

    permissionRows = await db.query.permissions.findMany({
      where: inArray(permissions.code, permissionCodes),
    });
    const permissionByCode = new Map<string, any>(
      permissionRows.map((permission: any) => [permission.code, permission]),
    );
    const invalidPermissionCodes = permissionCodes.filter((code) => {
      const permission = permissionByCode.get(code);

      return !permission || permission.isActive !== true;
    });

    if (invalidPermissionCodes.length > 0) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `Only active permissions can be assigned: ${invalidPermissionCodes.join(', ')}`,
      });
    }
  }

  const permissionIdByCode = new Map<string, string>(
    permissionRows.map((permission: any) => [permission.code, permission.id]),
  );
  const replaceRolePermissions = async (tx: any) => {
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, input.roleId));

    if (permissionCodes.length === 0) return;

    const insertResult = tx.insert(rolePermissions).values(
      permissionCodes.map((code) => ({
        permissionId: permissionIdByCode.get(code),
        roleId: input.roleId,
      })),
    );

    if (typeof insertResult.onConflictDoNothing === 'function') {
      await insertResult.onConflictDoNothing();
    } else {
      await insertResult;
    }
  };

  if (typeof db.transaction === 'function') {
    await db.transaction(replaceRolePermissions);
  } else {
    await replaceRolePermissions(db);
  }

  await writeEnterpriseAuditLog(db, {
    action: 'role.permissions.update',
    actorUserId,
    metadata: { permissionCodes },
    result: 'success',
    targetId: input.roleId,
    targetType: 'role',
  });

  return {
    permissionCodes,
    roleId: input.roleId,
  };
};

const listEnterpriseDepartmentTree = async (ctx: unknown) => {
  const db = getServerDBFromContext(ctx) as any;

  if (
    typeof db.query?.enterpriseDepartments?.findMany !== 'function' ||
    typeof db.query?.enterpriseDepartmentMembers?.findMany !== 'function'
  ) {
    return { items: [] as AdminOrgDepartmentNode[] };
  }

  const [departments, members] = await Promise.all([
    db.query.enterpriseDepartments.findMany(),
    db.query.enterpriseDepartmentMembers.findMany(),
  ]);
  const memberCountByDepartmentId = new Map<string, number>();

  for (const member of members) {
    memberCountByDepartmentId.set(
      member.departmentId,
      (memberCountByDepartmentId.get(member.departmentId) ?? 0) + 1,
    );
  }

  const nodes = new Map<string, AdminOrgDepartmentNode>();
  const orderById = new Map<string, number>();

  for (const department of departments) {
    nodes.set(department.id, {
      children: [],
      externalDepartmentId: department.externalDepartmentId ?? null,
      id: department.id,
      memberCount: memberCountByDepartmentId.get(department.id) ?? 0,
      name: department.name,
      parentId: department.parentId ?? null,
      provider: department.provider,
      status: department.status,
    });
    orderById.set(department.id, department.order ?? 0);
  }

  const roots: AdminOrgDepartmentNode[] = [];

  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (items: AdminOrgDepartmentNode[]) => {
    items.sort((a, b) => {
      const orderDelta = (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0);

      return orderDelta || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    });

    for (const item of items) sortNodes(item.children);
  };

  sortNodes(roots);

  return { items: roots };
};

const upsertEnterpriseDepartment = async (
  ctx: unknown,
  input: z.infer<typeof departmentUpsertInput>,
  actorUserId: string,
) => {
  const db = getServerDBFromContext(ctx) as any;
  const values = {
    ...(input.id ? { id: input.id } : {}),
    externalDepartmentId: input.externalDepartmentId,
    name: input.name,
    order: input.order ?? 0,
    parentId: input.parentId ?? null,
    provider: input.provider,
    status: input.status ?? 'active',
  };
  const [department] = await db
    .insert(enterpriseDepartments)
    .values(values)
    .onConflictDoUpdate({
      set: {
        externalDepartmentId: values.externalDepartmentId,
        name: values.name,
        order: values.order,
        parentId: values.parentId,
        provider: values.provider,
        status: values.status,
      },
      target: [enterpriseDepartments.provider, enterpriseDepartments.externalDepartmentId],
    })
    .returning();

  await writeEnterpriseAuditLog(db, {
    action: 'org.department.upsert',
    actorUserId,
    result: 'success',
    targetId: department.id,
    targetType: 'department',
  });

  return {
    externalDepartmentId: department.externalDepartmentId,
    id: department.id,
    name: department.name,
    order: department.order,
    parentId: department.parentId ?? null,
    provider: department.provider,
    status: department.status,
  };
};

const listEnterpriseDepartmentMembers = async (
  ctx: unknown,
  input: z.infer<typeof departmentMembersInput>,
) => {
  const db = getServerDBFromContext(ctx) as any;

  if (
    typeof db.query?.enterpriseDepartmentMembers?.findMany !== 'function' ||
    typeof db.query?.enterpriseUserProfiles?.findMany !== 'function' ||
    typeof db.query?.users?.findMany !== 'function'
  ) {
    return emptyList<AdminOrgMemberItem>();
  }

  const memberships = (await db.query.enterpriseDepartmentMembers.findMany({
    where: eq(enterpriseDepartmentMembers.departmentId, input.departmentId),
  })) as AdminOrgMembershipRow[];
  const userIds = [...new Set(memberships.map((membership: any) => membership.userId))] as string[];

  if (userIds.length === 0) return emptyList<AdminOrgMemberItem>();

  const [profiles, userRows] = (await Promise.all([
    db.query.enterpriseUserProfiles.findMany({
      where: inArray(enterpriseUserProfiles.userId, userIds),
    }),
    db.query.users.findMany({
      where: inArray(users.id, userIds),
    }),
  ])) as [AdminOrgUserProfileRow[], AdminOrgUserRow[]];
  const profileByUserId = new Map<string, AdminOrgUserProfileRow>(
    profiles.map((profile) => [profile.userId, profile]),
  );
  const userById = new Map<string, AdminOrgUserRow>(userRows.map((user) => [user.id, user]));
  const items = memberships.map((membership): AdminOrgMemberItem => {
    const profile = profileByUserId.get(membership.userId);
    const user = userById.get(membership.userId);

    return {
      departmentId: membership.departmentId,
      email: user?.email ?? '',
      employeeNumber: profile?.employeeNumber ?? null,
      employmentStatus: profile?.employmentStatus ?? null,
      isPrimary: Boolean(membership.isPrimary),
      name: user?.fullName || user?.username || user?.email || membership.userId,
      position: profile?.position ?? null,
      status: user?.banned ? '\u7981\u7528' : '\u6b63\u5e38',
      userId: membership.userId,
    };
  });
  items.sort((a, b) => {
    const primaryDelta = Number(b.isPrimary) - Number(a.isPrimary);

    return primaryDelta || a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId);
  });

  return {
    items,
    total: items.length,
  };
};

const moveEnterpriseDepartmentMember = async (
  ctx: unknown,
  input: z.infer<typeof memberMoveInput>,
  actorUserId: string,
) => {
  const db = getServerDBFromContext(ctx) as any;
  const values = {
    departmentId: input.departmentId,
    isPrimary: input.isPrimary ?? false,
    status: 'active',
    userId: input.userId,
  };
  const [membership] = await db
    .insert(enterpriseDepartmentMembers)
    .values(values)
    .onConflictDoUpdate({
      set: {
        isPrimary: values.isPrimary,
        status: values.status,
      },
      target: [enterpriseDepartmentMembers.departmentId, enterpriseDepartmentMembers.userId],
    })
    .returning();

  if (values.isPrimary) {
    await db
      .update(enterpriseUserProfiles)
      .set({ primaryDepartmentId: values.departmentId })
      .where(eq(enterpriseUserProfiles.userId, values.userId));
  }

  await writeEnterpriseAuditLog(db, {
    action: 'org.member.move',
    actorUserId,
    result: 'success',
    targetId: `${values.departmentId}:${values.userId}`,
    targetType: 'department_member',
  });

  return {
    departmentId: membership.departmentId,
    isPrimary: Boolean(membership.isPrimary),
    status: membership.status,
    userId: membership.userId,
  };
};

const runEnterpriseDirectorySync = async (
  ctx: unknown,
  input: z.infer<typeof directorySyncRunInput>,
  actorUserId: string,
) => {
  const db = getServerDBFromContext(ctx) as any;

  return applyEnterpriseDirectorySnapshot({
    actorUserId,
    db,
    missingMemberPolicy: input.missingMemberPolicy,
    provider: input.provider,
    snapshot: input.snapshot,
  });
};

const listRolePermissionRows = async (db: any, roleIds: string[]) => {
  if (roleIds.length === 0) return [];

  if (typeof db.query?.rolePermissions?.findMany === 'function') {
    try {
      const rows = await db.query.rolePermissions.findMany({
        where: inArray(rolePermissions.roleId, roleIds),
      });

      if (rows.some((row: any) => row.permissionCode || row.code || row.permission?.code)) {
        return rows;
      }
    } catch {
      // Fall through to the production join below.
    }
  }

  if (typeof db.select !== 'function') return [];

  try {
    return await db
      .select({
        code: permissions.code,
        roleId: rolePermissions.roleId,
      })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(inArray(rolePermissions.roleId, roleIds));
  } catch {
    return [];
  }
};

const resolveKnowledgeBaseResourceCount = async (db: any, knowledgeBaseId: string) => {
  if (typeof db.select !== 'function') return 0;

  try {
    const [row] = await db
      .select({ total: count() })
      .from(knowledgeBaseFiles)
      .where(eq(knowledgeBaseFiles.knowledgeBaseId, knowledgeBaseId));

    return Number(row?.total ?? 0);
  } catch {
    return 0;
  }
};

const listKnowledgeBasesForAdmin = async (ctx: unknown, input: z.infer<typeof paginationInput>) => {
  const db = getServerDBFromContext(ctx) as any;

  if (typeof db.query?.knowledgeBases?.findMany !== 'function') {
    return emptyList<AdminKnowledgeBaseItem>();
  }

  const where = input.q ? ilike(knowledgeBases.name, `%${input.q}%`) : undefined;
  const items = await db.query.knowledgeBases.findMany({
    limit: input.pageSize,
    offset: (input.page - 1) * input.pageSize,
    orderBy: [desc(knowledgeBases.updatedAt)],
    where,
  });

  const workspaceIds = [
    ...new Set(items.map((item: any) => item.workspaceId).filter(Boolean)),
  ] as string[];
  const workspaceRows =
    workspaceIds.length > 0 && typeof db.query?.workspaces?.findMany === 'function'
      ? await db.query.workspaces.findMany({
          where: inArray(workspaces.id, workspaceIds),
        })
      : [];
  const workspaceNameById = new Map(
    workspaceRows.map((workspace: any) => [workspace.id, workspace.name]),
  );

  const total =
    typeof db.select === 'function'
      ? await (async () => {
          try {
            const [row] = await db.select({ total: count() }).from(knowledgeBases).where(where);

            return Number(row?.total ?? items.length);
          } catch {
            return items.length;
          }
        })()
      : items.length;

  return {
    items: await Promise.all(
      items.map(
        async (item: any): Promise<AdminKnowledgeBaseItem> => ({
          id: item.id,
          name: item.name,
          resources: await resolveKnowledgeBaseResourceCount(db, item.id),
          updatedAt: toIsoString(item.updatedAt),
          visibility: item.isPublic ? '公开' : item.workspaceId ? '工作区' : '私有',
          workspace: item.workspaceId
            ? (workspaceNameById.get(item.workspaceId) ?? item.workspaceId)
            : '个人空间',
          workspaceId: item.workspaceId ?? null,
        }),
      ),
    ),
    total,
  };
};

const mapResourceGrant = (row: any): AdminResourceGrantItem => ({
  createdBy: row.createdBy ?? null,
  id: row.id,
  permission: row.permission,
  principalId: row.principalId,
  principalType: row.principalType,
  resourceId: row.resourceId,
  resourceType: row.resourceType,
  updatedAt: toIsoString(row.updatedAt),
  workspaceId: row.workspaceId ?? null,
});

const requirePlatformAdmin = requireAdminAccess;
const requireAuditRead = (ctx: unknown) => requireAdminRbacPermission(ctx, 'audit:read');
const requireKnowledgeManage = (ctx: unknown) =>
  requireAdminRbacPermission(ctx, 'knowledge:manage');
const requireMcpManage = (ctx: unknown) => requireAdminRbacPermission(ctx, 'mcp:manage');
const requireOrgManage = (ctx: unknown) => requireAdminRbacPermission(ctx, 'org:manage');
const requireRoleManage = (ctx: unknown) => requireAdminRbacPermission(ctx, 'role:manage');
const requireSkillManage = (ctx: unknown) => requireAdminRbacPermission(ctx, 'skill:manage');
const requireSsoManage = (ctx: unknown) => requireAdminRbacPermission(ctx, 'sso:manage');
const requireUserManage = (ctx: unknown) => requireAdminRbacPermission(ctx, 'user:manage');
const resourceAclManagePermissionByType = {
  connector: 'mcp:manage',
  document: 'knowledge:manage',
  file: 'knowledge:manage',
  folder: 'knowledge:manage',
  knowledge_base: 'knowledge:manage',
  skill: 'skill:manage',
} as const satisfies Record<ResourceType, AdminRbacPermissionCode>;
const requireResourceAclManage = (ctx: unknown, resourceType: ResourceType) =>
  requireAdminRbacPermission(ctx, resourceAclManagePermissionByType[resourceType]);

const adminProcedure = authedProcedure.use(serverDatabase);

export const adminRouter = router({
  listUsers: adminProcedure.input(paginationInput).query(async ({ ctx, input }) => {
    await requireUserManage(ctx);

    const db = getServerDBFromContext(ctx) as any;

    if (typeof db.query?.users?.findMany !== 'function') {
      return emptyList<AdminUserListItem>();
    }

    const where = input.q
      ? or(
          ilike(users.fullName, `%${input.q}%`),
          ilike(users.email, `%${input.q}%`),
          ilike(users.username, `%${input.q}%`),
          ilike(users.id, `%${input.q}%`),
        )
      : undefined;

    const rows = await db.query.users.findMany({
      limit: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
      orderBy: [desc(users.createdAt)],
      where,
    });
    const items = rows.map(mapAdminUser);

    return {
      items,
      total: await countRows(db, users, where, items.length),
    };
  }),

  getUserDetail: adminProcedure.input(userIdInput).query(async ({ ctx, input }) => {
    await requireUserManage(ctx);

    return getAdminUserDetail(ctx, input);
  }),

  retryUserProvisioning: adminProcedure.input(userIdInput).mutation(async ({ ctx, input }) => {
    const admin = await requireUserManage(ctx);

    return retryEnterpriseUserProvisioning(ctx, input, admin.userId);
  }),

  updateUserStatus: adminProcedure
    .input(updateUserStatusInput)
    .mutation(async ({ ctx, input }) => {
      const admin = await requireUserManage(ctx);

      return updateAdminUserStatus(ctx, input, admin.userId);
    }),

  assignUserRoles: adminProcedure
    .input(assignUserRolesInput)
    .mutation(async ({ ctx, input }) => {
      const admin = await requireRoleManage(ctx);

      return assignAdminUserRoles(ctx, input, admin.userId);
    }),

  createRole: adminProcedure.input(createRoleInput).mutation(async ({ ctx, input }) => {
    const admin = await requireRoleManage(ctx);

    return createAdminRole(ctx, input, admin.userId);
  }),

  updateRole: adminProcedure.input(updateRoleInput).mutation(async ({ ctx, input }) => {
    const admin = await requireRoleManage(ctx);

    return updateAdminRole(ctx, input, admin.userId);
  }),

  updateRoleStatus: adminProcedure
    .input(updateRoleStatusInput)
    .mutation(async ({ ctx, input }) => {
      const admin = await requireRoleManage(ctx);

      return updateAdminRoleStatus(ctx, input, admin.userId);
    }),

  updateRolePermissions: adminProcedure
    .input(updateRolePermissionsInput)
    .mutation(async ({ ctx, input }) => {
      const admin = await requireRoleManage(ctx);

      return updateAdminRolePermissions(ctx, input, admin.userId);
    }),

  listWorkspaces: adminProcedure.input(paginationInput).query(async ({ ctx }) => {
    await requirePlatformAdmin(ctx);

    return emptyList<AdminWorkspaceItem>();
  }),

  listRoles: adminProcedure.query(async ({ ctx }) => {
    await requireRoleManage(ctx);

    const db = getServerDBFromContext(ctx) as any;

    if (typeof db.query?.roles?.findMany !== 'function') {
      return { items: adminRoles };
    }

    try {
      const roleRows = await db.query.roles.findMany();
      const permissionRows = await listRolePermissionRows(
        db,
        roleRows.map((role: any) => role.id),
      );
      const permissionCodesByRoleId = new Map<string, string[]>();

      for (const row of permissionRows) {
        const code = row.permissionCode ?? row.code ?? row.permission?.code;
        if (!row.roleId || !code) continue;

        const codes = permissionCodesByRoleId.get(row.roleId) ?? [];
        codes.push(code);
        permissionCodesByRoleId.set(row.roleId, codes);
      }

      return {
        items: roleRows.map((role: any): AdminRoleItem =>
          mapAdminRole(role, permissionCodesByRoleId.get(role.id) ?? []),
        ),
      };
    } catch {
      return { items: adminRoles };
    }
  }),

  getSsoConfig: adminProcedure.query(async ({ ctx }) => {
    await requireSsoManage(ctx);

    return getWecomSsoConfig(getServerDBFromContext(ctx));
  }),

  updateSsoConfig: adminProcedure
    .input(wecomSsoUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const admin = await requireSsoManage(ctx);

      return upsertWecomSsoConfig(
        getServerDBFromContext(ctx),
        {
          config: input.config,
          corpSecret: input.corpSecret,
        },
        admin.userId,
      );
    }),

  getSystemConfig: adminProcedure.query(async ({ ctx }) => {
    await requirePlatformAdmin(ctx);

    return defaultSystemConfig;
  }),

  listAuditLogs: adminProcedure.input(paginationInput).query(async ({ ctx, input }) => {
    await requireAuditRead(ctx);

    const db = getServerDBFromContext(ctx) as any;

    if (typeof db.query?.enterpriseAuditLogs?.findMany !== 'function') {
      return emptyList<AdminAuditLogItem>();
    }

    const rows = await db.query.enterpriseAuditLogs.findMany({
      limit: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
      orderBy: [desc(enterpriseAuditLogs.createdAt)],
    });
    const items = rows.map(mapAuditLog);

    return {
      items,
      total: await countRows(db, enterpriseAuditLogs, undefined, items.length),
    };
  }),

  listKnowledgeBases: adminProcedure.input(paginationInput).query(async ({ ctx, input }) => {
    await requireKnowledgeManage(ctx);

    return listKnowledgeBasesForAdmin(ctx, input);
  }),

  listResourceGrants: adminProcedure.input(resourceInputSchema).query(async ({ ctx, input }) => {
    await requireResourceAclManage(ctx, input.resourceType);

    const db = getServerDBFromContext(ctx) as any;
    const scope = await resolveResourceAclScope(db, input);

    if (!scope.exists) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Resource not found' });
    }

    const repository = new ResourceAclRepository(db);
    const rows = await repository.listForResource({
      resourceId: scope.resource.resourceId,
      resourceType: scope.resource.resourceType,
      workspaceId: scope.ownerWorkspaceId ?? null,
    });

    return { items: rows.map(mapResourceGrant) };
  }),

  grantResourcePermission: adminProcedure
    .input(grantResourceInputSchema)
    .mutation(async ({ ctx, input }) => {
      const admin = await requireResourceAclManage(ctx, input.resourceType);

      const db = getServerDBFromContext(ctx) as any;
      const scope = await resolveResourceAclScope(db, input);

      if (!scope.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Resource not found' });
      }

      const repository = new ResourceAclRepository(db);
      const row = await repository.grant({
        createdBy: admin.userId,
        permission: input.permission,
        principalId: input.principalId,
        principalType: input.principalType,
        resourceId: scope.resource.resourceId,
        resourceType: scope.resource.resourceType,
        workspaceId: scope.ownerWorkspaceId ?? null,
      });

      return mapResourceGrant(row);
    }),

  listSkillPolicies: adminProcedure.input(paginationInput).query(async ({ ctx }) => {
    await requireSkillManage(ctx);

    return emptyList<AdminSkillPolicyItem>();
  }),

  listMcpConnectors: adminProcedure.input(paginationInput).query(async ({ ctx }) => {
    await requireMcpManage(ctx);

    return emptyList<AdminMcpConnectorItem>();
  }),

  org: router({
    departments: router({
      tree: adminProcedure.query(async ({ ctx }) => {
        await requireOrgManage(ctx);

        return listEnterpriseDepartmentTree(ctx);
      }),
      upsert: adminProcedure.input(departmentUpsertInput).mutation(async ({ ctx, input }) => {
        const admin = await requireOrgManage(ctx);

        return upsertEnterpriseDepartment(ctx, input, admin.userId);
      }),
    }),
    members: router({
      list: adminProcedure.input(departmentMembersInput).query(async ({ ctx, input }) => {
        await requireOrgManage(ctx);

        return listEnterpriseDepartmentMembers(ctx, input);
      }),
      move: adminProcedure.input(memberMoveInput).mutation(async ({ ctx, input }) => {
        const admin = await requireOrgManage(ctx);

        return moveEnterpriseDepartmentMember(ctx, input, admin.userId);
      }),
    }),
    sync: router({
      run: adminProcedure.input(directorySyncRunInput).mutation(async ({ ctx, input }) => {
        const admin = await requireOrgManage(ctx);

        return runEnterpriseDirectorySync(ctx, input, admin.userId);
      }),
    }),
  }),

  me: adminProcedure.query(async ({ ctx }) => {
    const admin = await requirePlatformAdmin(ctx);

    return { isPlatformAdmin: true, userId: admin.userId };
  }),

  overview: adminProcedure.query(async ({ ctx }) => {
    await requirePlatformAdmin(ctx);

    const db = getServerDBFromContext(ctx) as any;
    const usersCount = await countRows(db, users);
    const workspacesCount = await countRows(db, workspaces);
    const knowledgeBasesCount = await countRows(db, knowledgeBases);

    return {
      knowledgeBases: knowledgeBasesCount,
      mcpConnectors: 0,
      users: usersCount,
      workspaces: workspacesCount,
    };
  }),
});
