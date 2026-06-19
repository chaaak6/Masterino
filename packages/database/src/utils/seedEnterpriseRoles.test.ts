// @vitest-environment node
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../core/getTestDB';
import { RbacModel } from '../models/rbac';
import { permissions, rolePermissions, roles, userRoles, users } from '../schemas';
import type { LobeChatDatabase } from '../type';
import {
  ENTERPRISE_PERMISSION_CATALOG,
  ENTERPRISE_SYSTEM_ROLES,
  seedEnterpriseRoles,
} from './seedEnterpriseRoles';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'enterprise-rbac-seed-test-user-id';

const p0PermissionCodes = [
  'admin:access',
  'user:manage',
  'org:manage',
  'role:manage',
  'sso:manage',
  'aihub:manage',
  'audit:read',
  'knowledge:read',
  'knowledge:manage',
  'skill:use',
  'skill:manage',
  'mcp:connect',
  'mcp:manage',
] as const;

const enterpriseSystemRoleNames = [
  'platform_admin',
  'enterprise_admin',
  'enterprise_member',
  'enterprise_viewer',
] as const;

const enterpriseAdminPermissionCodes = [
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
] as const;

const enterpriseMemberPermissionCodes = ['knowledge:read', 'skill:use', 'mcp:connect'] as const;
const enterpriseViewerPermissionCodes = ['knowledge:read'] as const;

const cleanup = async () => {
  await serverDB.delete(userRoles);
  await serverDB.delete(rolePermissions);
  await serverDB.delete(roles);
  await serverDB.delete(permissions);
  await serverDB.delete(users);
};

const sorted = (values: Iterable<string>) => [...values].sort((a, b) => a.localeCompare(b));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const extractPermissionCodes = (catalog: unknown): string[] => {
  const codes = new Set<string>();

  if (Array.isArray(catalog)) {
    for (const entry of catalog) {
      if (typeof entry === 'string') codes.add(entry);
      if (isRecord(entry) && typeof entry.code === 'string') codes.add(entry.code);
    }
  }

  if (isRecord(catalog)) {
    for (const [key, value] of Object.entries(catalog)) {
      if (key.includes(':')) codes.add(key);
      if (typeof value === 'string') codes.add(value);
      if (isRecord(value) && typeof value.code === 'string') codes.add(value.code);
    }
  }

  return sorted(codes);
};

const extractSystemRoleNames = (roleExport: unknown): string[] => {
  const names = new Set<string>();
  const expectedNames = new Set<string>(enterpriseSystemRoleNames);
  const addRoleName = (value: unknown) => {
    if (typeof value === 'string') names.add(value);
    if (isRecord(value)) {
      for (const key of ['id', 'key', 'name', 'role', 'roleName']) {
        if (typeof value[key] === 'string') names.add(value[key]);
      }
    }
  };

  if (Array.isArray(roleExport)) {
    for (const entry of roleExport) addRoleName(entry);
  }

  if (isRecord(roleExport)) {
    for (const [key, value] of Object.entries(roleExport)) {
      if (expectedNames.has(key)) names.add(key);
      addRoleName(value);
    }
  }

  return sorted(names);
};

const getRolePermissionCodesByRoleName = async () => {
  const rows = await serverDB
    .select({
      permissionCode: permissions.code,
      roleName: roles.name,
    })
    .from(roles)
    .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(and(inArray(roles.name, [...enterpriseSystemRoleNames]), isNull(roles.workspaceId)));

  const permissionCodesByRole = new Map<string, string[]>(
    enterpriseSystemRoleNames.map((roleName) => [roleName, []]),
  );

  for (const row of rows) {
    permissionCodesByRole.get(row.roleName)?.push(row.permissionCode);
  }

  return permissionCodesByRole;
};

const countSeededRows = async () => {
  const seededPermissions = await serverDB
    .select({ code: permissions.code, id: permissions.id })
    .from(permissions)
    .where(inArray(permissions.code, [...p0PermissionCodes]));

  const seededRoles = await serverDB
    .select({ id: roles.id, name: roles.name })
    .from(roles)
    .where(and(inArray(roles.name, [...enterpriseSystemRoleNames]), isNull(roles.workspaceId)));

  const seededRolePermissions =
    seededRoles.length === 0
      ? []
      : await serverDB
          .select({
            permissionId: rolePermissions.permissionId,
            roleId: rolePermissions.roleId,
          })
          .from(rolePermissions)
          .where(inArray(rolePermissions.roleId, seededRoles.map((role) => role.id)));

  return {
    permissionCodes: sorted(seededPermissions.map((permission) => permission.code)),
    permissions: seededPermissions.length,
    roleNames: sorted(seededRoles.map((role) => role.name)),
    rolePermissionPairs: sorted(
      seededRolePermissions.map((row) => `${row.roleId}:${row.permissionId}`),
    ),
    rolePermissions: seededRolePermissions.length,
    roles: seededRoles.length,
  };
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await cleanup();
});

describe('seedEnterpriseRoles', () => {
  it('exports the enterprise permission catalog, system roles, and seed util', () => {
    expect(extractPermissionCodes(ENTERPRISE_PERMISSION_CATALOG)).toEqual(
      expect.arrayContaining([...p0PermissionCodes]),
    );
    expect(extractSystemRoleNames(ENTERPRISE_SYSTEM_ROLES)).toEqual(
      expect.arrayContaining([...enterpriseSystemRoleNames]),
    );
    expect(seedEnterpriseRoles).toEqual(expect.any(Function));
  });

  it('idempotently creates the P0 enterprise governance permission catalog', async () => {
    await seedEnterpriseRoles(serverDB);

    const seededPermissions = await serverDB
      .select({
        category: permissions.category,
        code: permissions.code,
        isActive: permissions.isActive,
        name: permissions.name,
      })
      .from(permissions)
      .where(inArray(permissions.code, [...p0PermissionCodes]));

    expect(sorted(seededPermissions.map((permission) => permission.code))).toEqual(
      sorted(p0PermissionCodes),
    );

    for (const permission of seededPermissions) {
      expect(permission.category).toBe(permission.code.split(':')[0]);
      expect(permission.isActive).toBe(true);
      expect(permission.name.length).toBeGreaterThan(0);
    }
  });

  it('creates the four global enterprise system roles with workspaceId set to null', async () => {
    await seedEnterpriseRoles(serverDB);

    const seededRoles = await serverDB.query.roles.findMany({
      where: and(inArray(roles.name, [...enterpriseSystemRoleNames]), isNull(roles.workspaceId)),
    });

    expect(sorted(seededRoles.map((role) => role.name))).toEqual(sorted(enterpriseSystemRoleNames));

    for (const role of seededRoles) {
      expect(role.workspaceId).toBeNull();
      expect(role.isSystem).toBe(true);
      expect(role.isActive).toBe(true);
      expect(role.displayName.length).toBeGreaterThan(0);
    }
  });

  it('normalizes a pre-existing global platform_admin role before granting permissions', async () => {
    await serverDB.insert(roles).values({
      description: 'Legacy description',
      displayName: 'Legacy Platform Admin',
      isActive: false,
      isSystem: false,
      name: 'platform_admin',
      workspaceId: null,
    });

    await seedEnterpriseRoles(serverDB);

    const platformAdminRole = await serverDB.query.roles.findFirst({
      where: and(eq(roles.name, 'platform_admin'), isNull(roles.workspaceId)),
    });

    expect(platformAdminRole).toBeTruthy();
    expect(platformAdminRole!.isSystem).toBe(true);
    expect(platformAdminRole!.isActive).toBe(true);
    expect(platformAdminRole!.displayName).toBe('Platform Admin');
    expect(platformAdminRole!.description).toBe(
      'Full access to all enterprise governance capabilities.',
    );

    await serverDB.insert(userRoles).values({
      roleId: platformAdminRole!.id,
      userId,
      workspaceId: null,
    });

    const rbac = new RbacModel(serverDB, userId);

    expect(await rbac.hasAnyPermission(['admin:access'])).toBe(true);
  });

  it('links the expected enterprise permissions to each global system role', async () => {
    await seedEnterpriseRoles(serverDB);

    const permissionCodesByRole = await getRolePermissionCodesByRoleName();

    expect(sorted(permissionCodesByRole.get('platform_admin') ?? [])).toEqual(
      sorted(p0PermissionCodes),
    );
    expect(permissionCodesByRole.get('enterprise_admin')).toEqual(
      expect.arrayContaining([...enterpriseAdminPermissionCodes]),
    );
    expect(permissionCodesByRole.get('enterprise_member')).toEqual(
      expect.arrayContaining([...enterpriseMemberPermissionCodes]),
    );
    expect(permissionCodesByRole.get('enterprise_viewer')).toEqual(
      expect.arrayContaining([...enterpriseViewerPermissionCodes]),
    );
  });

  it('does not create duplicate permissions, roles, or role-permission links when run repeatedly', async () => {
    await seedEnterpriseRoles(serverDB);
    const firstSeedCounts = await countSeededRows();

    await seedEnterpriseRoles(serverDB);
    const secondSeedCounts = await countSeededRows();

    expect(secondSeedCounts).toEqual(firstSeedCounts);
    expect(secondSeedCounts.permissions).toBe(p0PermissionCodes.length);
    expect(secondSeedCounts.roles).toBe(enterpriseSystemRoleNames.length);
    expect(secondSeedCounts.rolePermissionPairs).toHaveLength(secondSeedCounts.rolePermissions);
  });

  it('does not throw or duplicate seeded rows when seed calls run concurrently', async () => {
    await expect(Promise.all([seedEnterpriseRoles(serverDB), seedEnterpriseRoles(serverDB)]))
      .resolves.toHaveLength(2);

    const seedCounts = await countSeededRows();

    expect(seedCounts.permissions).toBe(p0PermissionCodes.length);
    expect(seedCounts.roles).toBe(enterpriseSystemRoleNames.length);
    expect(seedCounts.permissionCodes).toEqual(sorted(p0PermissionCodes));
    expect(seedCounts.roleNames).toEqual(sorted(enterpriseSystemRoleNames));
    expect(seedCounts.rolePermissionPairs).toHaveLength(seedCounts.rolePermissions);
  });

  it('lets RbacModel.hasAnyPermission resolve admin access through a global platform_admin grant', async () => {
    await seedEnterpriseRoles(serverDB);

    const platformAdminRole = await serverDB.query.roles.findFirst({
      where: and(eq(roles.name, 'platform_admin'), isNull(roles.workspaceId)),
    });

    expect(platformAdminRole).toBeTruthy();

    await serverDB.insert(userRoles).values({
      roleId: platformAdminRole!.id,
      userId,
      workspaceId: null,
    });

    const rbac = new RbacModel(serverDB, userId);

    expect(await rbac.hasAnyPermission(['admin:access'])).toBe(true);
    expect(await rbac.hasAnyPermission(['aihub:manage'])).toBe(true);
  });
});
