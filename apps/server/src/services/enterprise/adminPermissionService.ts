import { TRPCError } from '@trpc/server';

import { RbacModel } from '@/database/models/rbac';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import type { EnterprisePermissionCode } from '@/database/utils/seedEnterpriseRoles';

type LegacyRole = string | undefined;
export type AdminRbacPermissionCode = Extract<
  EnterprisePermissionCode,
  | 'audit:read'
  | 'knowledge:manage'
  | 'mcp:manage'
  | 'org:manage'
  | 'role:manage'
  | 'skill:manage'
  | 'sso:manage'
  | 'user:manage'
>;

interface AuthorizedAdminUser {
  legacyRole?: string;
  userId: string;
}

const adminAccessLegacyRoles = new Set(['platform_admin', 'super_admin']);
const aihubManageLegacyRoles = new Set(['admin', 'platform_admin', 'super_admin']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getStringField = (value: unknown, key: string) => {
  if (!isRecord(value)) return;

  const field = value[key];

  return typeof field === 'string' ? field : undefined;
};

export const getAdminPermissionUserId = (ctx: unknown) => {
  const user = isRecord(ctx) ? ctx.user : undefined;

  return (
    getStringField(ctx, 'userId') ?? getStringField(user, 'id') ?? getStringField(user, 'userId')
  );
};

const getLegacyRoleFromContext = (ctx: unknown): LegacyRole => {
  const user = isRecord(ctx) ? ctx.user : undefined;
  const userRole = getStringField(user, 'role');

  return (
    userRole ??
    getStringField(ctx, 'platformRole') ??
    getStringField(ctx, 'platformAdminRole') ??
    getStringField(ctx, 'adminRole')
  );
};

const getServerDBFromContext = (ctx: unknown): LobeChatDatabase | undefined => {
  const serverDB = isRecord(ctx) ? ctx.serverDB : undefined;

  return serverDB as LobeChatDatabase | undefined;
};

const getLegacyRole = async (
  db: LobeChatDatabase | undefined,
  userId: string,
  ctx: unknown,
): Promise<LegacyRole> => {
  const role = getLegacyRoleFromContext(ctx);

  if (role || !db) return role;

  const user = await UserModel.findById(db, userId);

  return getStringField(user, 'role');
};

const hasAnyPermission = async (
  db: LobeChatDatabase | undefined,
  userId: string,
  permissions: string[],
) => {
  if (!db) return false;

  return new RbacModel(db, userId).hasAnyPermission(permissions);
};

const requireAdminPermission = async (
  ctx: unknown,
  options: {
    forbiddenMessage?: string;
    legacyRoles: ReadonlySet<string>;
    permissions: string[];
  },
): Promise<AuthorizedAdminUser> => {
  const userId = getAdminPermissionUserId(ctx);

  if (!userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  const db = getServerDBFromContext(ctx);
  const legacyRole = await getLegacyRole(db, userId, ctx);

  if (legacyRole && options.legacyRoles.has(legacyRole)) {
    return { legacyRole, userId };
  }

  if (await hasAnyPermission(db, userId, options.permissions)) {
    return legacyRole ? { legacyRole, userId } : { userId };
  }

  throw new TRPCError({
    code: 'FORBIDDEN',
    ...(options.forbiddenMessage ? { message: options.forbiddenMessage } : {}),
  });
};

export const requireAdminAccess = (ctx: unknown) =>
  requireAdminPermission(ctx, {
    legacyRoles: adminAccessLegacyRoles,
    permissions: ['admin:access'],
  });

export const requireAdminRbacPermission = (ctx: unknown, permission: AdminRbacPermissionCode) =>
  requireAdminPermission(ctx, {
    legacyRoles: adminAccessLegacyRoles,
    permissions: [permission],
  });

export const requireAihubManage = (ctx: unknown) =>
  requireAdminPermission(ctx, {
    forbiddenMessage: 'Only administrators can manage Aihub bindings',
    legacyRoles: aihubManageLegacyRoles,
    permissions: ['aihub:manage'],
  });
