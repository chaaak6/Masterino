import { TRPCError } from '@trpc/server';

import { trpc } from '@/libs/trpc/lambda/init';
import { hasRequiredPermission, isPlatformAdminRole } from '@/server/services/enterprise/permissionService';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getUserRole = (ctx: unknown): string | undefined => {
  if (!isRecord(ctx) || !isRecord(ctx.user)) return undefined;

  return typeof ctx.user.role === 'string' ? ctx.user.role : undefined;
};

const getPermissionGrants = (ctx: unknown): string[] => {
  if (!isRecord(ctx) || !Array.isArray(ctx.permissions)) return [];

  return ctx.permissions.filter((grant): grant is string => typeof grant === 'string');
};

const hasPermissionContext = (ctx: unknown): boolean =>
  isRecord(ctx) && Array.isArray(ctx.permissions);

export const isRbacStrictModeEnabled = (): boolean => {
  const value = process.env.MASTERLION_RBAC_STRICT?.toLowerCase();
  return value === '1' || value === 'true';
};

export const shouldEnforceRbacPermission = (
  ctx: unknown,
  strictMode = isRbacStrictModeEnabled(),
): boolean => hasPermissionContext(ctx) || strictMode;

const hasContextPermission = (ctx: unknown, code: string): boolean =>
  isPlatformAdminRole(getUserRole(ctx)) || hasRequiredPermission(getPermissionGrants(ctx), code);

const shouldAllowLegacyRbacBypass = (ctx: unknown): boolean => {
  if (shouldEnforceRbacPermission(ctx)) return false;

  // Phased compatibility: live tRPC context does not inject RBAC grants yet.
  return true;
};

const assertContextPermission = (ctx: unknown, code: string) => {
  if (!hasContextPermission(ctx, code)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Missing permission: ${code}`,
    });
  }
};

export const withRbacPermission = (code: string) =>
  trpc.middleware(async (opts) => {
    if (shouldAllowLegacyRbacBypass(opts.ctx)) return opts.next();

    assertContextPermission(opts.ctx, code);
    return opts.next();
  });

export const withAnyRbacPermission = (codes: string[]) =>
  trpc.middleware(async (opts) => {
    if (isPlatformAdminRole(getUserRole(opts.ctx))) return opts.next();
    if (shouldAllowLegacyRbacBypass(opts.ctx)) return opts.next();

    const grants = getPermissionGrants(opts.ctx);
    if (codes.some((code) => hasRequiredPermission(grants, code))) return opts.next();

    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Missing any permission: ${codes.join(', ')}`,
    });
  });

export const withAllRbacPermissions = (codes: string[]) =>
  trpc.middleware(async (opts) => {
    if (shouldAllowLegacyRbacBypass(opts.ctx)) return opts.next();

    for (const code of codes) {
      assertContextPermission(opts.ctx, code);
    }

    return opts.next();
  });

/**
 * Sugar for scoped RBAC gates. Enterprise role scope expansion is handled by
 * later repository-backed tasks; for now the action itself is the permission.
 */
export const withScopedPermission = (action: string) =>
  trpc.middleware(async (opts) => {
    if (shouldAllowLegacyRbacBypass(opts.ctx)) return opts.next();

    assertContextPermission(opts.ctx, action);
    return opts.next();
  });
