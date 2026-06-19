// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isRbacStrictModeEnabled,
  shouldEnforceRbacPermission,
  withAnyRbacPermission,
  withRbacPermission,
} from '@/business/server/trpc-middlewares/rbacPermission';

const runMiddleware = async (middlewareBuilder: unknown, ctx: unknown) => {
  const middleware = (middlewareBuilder as { _middlewares: Array<(opts: any) => Promise<unknown>> })
    ._middlewares[0];
  const next = vi.fn().mockResolvedValue({ data: 'ok', marker: 'middlewareMarker', ok: true });

  const result = await middleware({
    batchIndex: 0,
    ctx,
    getRawInput: async () => undefined,
    input: undefined,
    meta: undefined,
    next,
    path: 'test',
    signal: undefined,
    type: 'query',
  });

  return { next, result };
};

describe('rbacPermission middleware compatibility', () => {
  const originalStrictMode = process.env.MASTERLION_RBAC_STRICT;

  afterEach(() => {
    if (originalStrictMode === undefined) {
      delete process.env.MASTERLION_RBAC_STRICT;
      return;
    }

    process.env.MASTERLION_RBAC_STRICT = originalStrictMode;
  });

  it('does not enforce when permissions are missing and strict mode is disabled', () => {
    expect(shouldEnforceRbacPermission({ userId: 'user-1' }, false)).toBe(false);
  });

  it('enforces when permissions are present as an empty array', () => {
    expect(shouldEnforceRbacPermission({ permissions: [] }, false)).toBe(true);
  });

  it('enforces when permissions are present with grants', () => {
    expect(shouldEnforceRbacPermission({ permissions: ['admin:user:read'] }, false)).toBe(true);
  });

  it('enforces when strict mode is enabled and permissions are missing', () => {
    expect(shouldEnforceRbacPermission({ userId: 'user-1' }, true)).toBe(true);
  });

  it('treats MASTERLION_RBAC_STRICT=1 as strict mode', () => {
    process.env.MASTERLION_RBAC_STRICT = '1';

    expect(isRbacStrictModeEnabled()).toBe(true);
  });

  it('treats MASTERLION_RBAC_STRICT=true as strict mode', () => {
    process.env.MASTERLION_RBAC_STRICT = 'true';

    expect(isRbacStrictModeEnabled()).toBe(true);
  });

  it('withRbacPermission allows an exact permission grant', async () => {
    const { next, result } = await runMiddleware(withRbacPermission('admin:user:read'), {
      permissions: ['admin:user:read'],
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true });
  });

  it('withRbacPermission denies an empty permissions array', async () => {
    await expect(
      runMiddleware(withRbacPermission('admin:user:read'), { permissions: [] }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Missing permission: admin:user:read',
    });
  });

  it('withRbacPermission allows legacy missing permissions when strict mode is disabled', async () => {
    const { next, result } = await runMiddleware(withRbacPermission('admin:user:read'), {
      userId: 'user-1',
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true });
  });

  it('withRbacPermission denies missing permissions when strict mode is enabled', async () => {
    process.env.MASTERLION_RBAC_STRICT = '1';

    await expect(
      runMiddleware(withRbacPermission('admin:user:read'), { userId: 'user-1' }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Missing permission: admin:user:read',
    });
  });

  it('withRbacPermission allows platform_admin without permissions', async () => {
    const { next, result } = await runMiddleware(withRbacPermission('admin:user:read'), {
      user: { role: 'platform_admin' },
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true });
  });

  it('withAnyRbacPermission allows when any requested permission matches', async () => {
    const { next, result } = await runMiddleware(
      withAnyRbacPermission(['admin:user:read', 'admin:user:update']),
      { permissions: ['admin:user:update'] },
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true });
  });
});
