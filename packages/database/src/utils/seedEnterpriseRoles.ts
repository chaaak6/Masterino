import { and, eq, inArray, isNull } from 'drizzle-orm';

import { permissions, rolePermissions, roles } from '../schemas/rbac';
import type { LobeChatDatabase } from '../type';

export const ENTERPRISE_PERMISSION_CATALOG = [
  { code: 'admin:access', description: 'Access enterprise administration surfaces.' },
  { code: 'user:manage', description: 'Manage enterprise users.' },
  { code: 'org:manage', description: 'Manage enterprise organization settings.' },
  { code: 'role:manage', description: 'Manage enterprise roles and permissions.' },
  { code: 'sso:manage', description: 'Manage SSO configuration.' },
  { code: 'aihub:manage', description: 'Manage enterprise AI hub resources.' },
  { code: 'audit:read', description: 'Read enterprise audit logs.' },
  { code: 'knowledge:read', description: 'Read enterprise knowledge resources.' },
  { code: 'knowledge:manage', description: 'Manage enterprise knowledge resources.' },
  { code: 'skill:use', description: 'Use enterprise skills.' },
  { code: 'skill:manage', description: 'Manage enterprise skills.' },
  { code: 'mcp:connect', description: 'Connect to enterprise MCP services.' },
  { code: 'mcp:manage', description: 'Manage enterprise MCP services.' },
] as const;

export type EnterprisePermissionCode = (typeof ENTERPRISE_PERMISSION_CATALOG)[number]['code'];

export const ENTERPRISE_SYSTEM_ROLES = {
  ENTERPRISE_ADMIN: 'enterprise_admin',
  ENTERPRISE_MEMBER: 'enterprise_member',
  ENTERPRISE_VIEWER: 'enterprise_viewer',
  PLATFORM_ADMIN: 'platform_admin',
} as const;

export type EnterpriseSystemRoleName =
  (typeof ENTERPRISE_SYSTEM_ROLES)[keyof typeof ENTERPRISE_SYSTEM_ROLES];

const ENTERPRISE_ROLE_DEFINITIONS: Record<
  EnterpriseSystemRoleName,
  {
    description: string;
    displayName: string;
    permissions: readonly EnterprisePermissionCode[];
  }
> = {
  [ENTERPRISE_SYSTEM_ROLES.PLATFORM_ADMIN]: {
    description: 'Full access to all enterprise governance capabilities.',
    displayName: 'Platform Admin',
    permissions: ENTERPRISE_PERMISSION_CATALOG.map((permission) => permission.code),
  },
  [ENTERPRISE_SYSTEM_ROLES.ENTERPRISE_ADMIN]: {
    description: 'Administrative access to enterprise governance capabilities.',
    displayName: 'Enterprise Admin',
    permissions: [
      'admin:access',
      'user:manage',
      'org:manage',
      'role:manage',
      'sso:manage',
      'aihub:manage',
      'audit:read',
      'knowledge:manage',
      'skill:manage',
      'mcp:manage',
    ],
  },
  [ENTERPRISE_SYSTEM_ROLES.ENTERPRISE_MEMBER]: {
    description: 'Standard enterprise access for shared knowledge, skills, and MCP connections.',
    displayName: 'Enterprise Member',
    permissions: ['knowledge:read', 'skill:use', 'mcp:connect'],
  },
  [ENTERPRISE_SYSTEM_ROLES.ENTERPRISE_VIEWER]: {
    description: 'Read-only access to enterprise knowledge resources.',
    displayName: 'Enterprise Viewer',
    permissions: ['knowledge:read'],
  },
};

const codeToCategory = (code: string): string => code.split(':')[0];

const codeToName = (code: string): string =>
  code
    .split(':')
    .map((segment) =>
      segment
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' '),
    )
    .join(' ');

const ensurePermissionsExist = async (db: LobeChatDatabase): Promise<Map<string, string>> => {
  const codeList = ENTERPRISE_PERMISSION_CATALOG.map((permission) => permission.code);

  const existing = await db
    .select({ code: permissions.code, id: permissions.id })
    .from(permissions)
    .where(inArray(permissions.code, codeList));

  const existingCodes = new Set(existing.map((permission) => permission.code));
  const missing = ENTERPRISE_PERMISSION_CATALOG.filter(
    (permission) => !existingCodes.has(permission.code),
  );

  if (missing.length > 0) {
    await db
      .insert(permissions)
      .values(
        missing.map((permission) => ({
          category: codeToCategory(permission.code),
          code: permission.code,
          description: permission.description,
          isActive: true,
          name: codeToName(permission.code),
        })),
      )
      .onConflictDoNothing({ target: permissions.code });
  }

  const all = await db
    .select({ code: permissions.code, id: permissions.id })
    .from(permissions)
    .where(inArray(permissions.code, codeList));

  return new Map(all.map((permission) => [permission.code, permission.id] as const));
};

const upsertEnterpriseRole = async (
  db: LobeChatDatabase,
  roleName: EnterpriseSystemRoleName,
  permissionIdByCode: Map<string, string>,
): Promise<string> => {
  const definition = ENTERPRISE_ROLE_DEFINITIONS[roleName];

  await db
    .insert(roles)
    .values({
      description: definition.description,
      displayName: definition.displayName,
      isActive: true,
      isSystem: true,
      name: roleName,
      workspaceId: null,
    })
    .onConflictDoNothing();

  const [normalized] = await db
    .update(roles)
    .set({
      description: definition.description,
      displayName: definition.displayName,
      isActive: true,
      isSystem: true,
    })
    .where(and(eq(roles.name, roleName), isNull(roles.workspaceId)))
    .returning({ id: roles.id });

  if (!normalized) {
    throw new Error(`Enterprise role ${roleName} was not created or found.`);
  }

  const roleId = normalized.id;

  const targetIds = definition.permissions
    .map((code) => permissionIdByCode.get(code))
    .filter((id): id is string => !!id);

  if (targetIds.length === 0) return roleId;

  await db
    .insert(rolePermissions)
    .values(targetIds.map((permissionId) => ({ permissionId, roleId })))
    .onConflictDoNothing();

  return roleId;
};

export interface SeededEnterpriseRoles {
  enterpriseAdminRoleId: string;
  enterpriseMemberRoleId: string;
  enterpriseViewerRoleId: string;
  platformAdminRoleId: string;
}

export const seedEnterpriseRoles = async (
  db: LobeChatDatabase,
): Promise<SeededEnterpriseRoles> => {
  const permissionIdByCode = await ensurePermissionsExist(db);
  const platformAdminRoleId = await upsertEnterpriseRole(
    db,
    ENTERPRISE_SYSTEM_ROLES.PLATFORM_ADMIN,
    permissionIdByCode,
  );
  const enterpriseAdminRoleId = await upsertEnterpriseRole(
    db,
    ENTERPRISE_SYSTEM_ROLES.ENTERPRISE_ADMIN,
    permissionIdByCode,
  );
  const enterpriseMemberRoleId = await upsertEnterpriseRole(
    db,
    ENTERPRISE_SYSTEM_ROLES.ENTERPRISE_MEMBER,
    permissionIdByCode,
  );
  const enterpriseViewerRoleId = await upsertEnterpriseRole(
    db,
    ENTERPRISE_SYSTEM_ROLES.ENTERPRISE_VIEWER,
    permissionIdByCode,
  );

  return {
    enterpriseAdminRoleId,
    enterpriseMemberRoleId,
    enterpriseViewerRoleId,
    platformAdminRoleId,
  };
};
