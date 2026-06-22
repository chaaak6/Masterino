// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { UserModel } from '@/database/models/user';
import { createCallerFactory } from '@/libs/trpc/lambda';
import { type AuthContext } from '@/libs/trpc/lambda/context';
import { createContextInner } from '@/libs/trpc/lambda/context';

import { adminRouter } from './admin';

const {
  mockApplyEnterpriseDirectorySnapshot,
  mockGetWecomSsoConfig,
  mockHasAnyPermission,
  mockProvisionWecomLoginAccount,
  mockUpsertWecomSsoConfig,
} = vi.hoisted(() => ({
  mockApplyEnterpriseDirectorySnapshot: vi.fn(),
  mockGetWecomSsoConfig: vi.fn(),
  mockHasAnyPermission: vi.fn(),
  mockProvisionWecomLoginAccount: vi.fn(),
  mockUpsertWecomSsoConfig: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: {
    findById: vi.fn(),
  },
}));

vi.mock('@/libs/better-auth/wecom-login-provisioning', () => ({
  provisionWecomLoginAccount: mockProvisionWecomLoginAccount,
}));

vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = (...args: any[]) => mockHasAnyPermission(...args);
  },
}));

vi.mock('@/server/services/enterprise/wecomSsoService', async () => {
  const actual = await vi.importActual<
    typeof import('@/server/services/enterprise/wecomSsoService')
  >('@/server/services/enterprise/wecomSsoService');

  return {
    ...actual,
    getWecomSsoConfig: mockGetWecomSsoConfig,
    upsertWecomSsoConfig: mockUpsertWecomSsoConfig,
  };
});

vi.mock('@/server/services/enterprise/directorySyncService', async () => {
  const actual = await vi.importActual<
    typeof import('@/server/services/enterprise/directorySyncService')
  >('@/server/services/enterprise/directorySyncService');

  return {
    ...actual,
    applyEnterpriseDirectorySnapshot: mockApplyEnterpriseDirectorySnapshot,
  };
});

const createCaller = createCallerFactory(adminRouter);
const mockServerDB = { query: {} };

const defaultEnterpriseWecomBlocks = {
  aihubProvisioning: {
    autoCreateUser: true,
    enabled: true,
    initialQuota: 50_000_000,
    lookupField: 'employeeNumber',
    managedTokenName: 'masterlion-managed',
    managedTokenQuota: 50_000_000,
    managedTokenUnlimitedQuota: false,
  },
  departmentSync: {
    enabled: false,
    mode: 'login',
  },
  identityMapping: {
    departmentField: 'department',
    emailField: 'email',
    employeeNumberField: 'userid',
    mobileField: 'mobile',
    nameField: 'name',
    positionField: 'position',
  },
};

const mockSsoConfig = {
  config: {
    agentId: '',
    autoProvision: true,
    corpId: '',
    defaultRole: 'member',
    defaultWorkspaceId: undefined,
    enabled: false,
    enabledModes: ['web_qr', 'workbench'] as string[],
    redirectUri: '',
    trustedDomains: [] as string[],
    ...defaultEnterpriseWecomBlocks,
  },
  corpSecretConfigured: false,
  displayName: '企业微信',
  enabled: false,
  provider: 'wecom',
};

const createWecomSsoUpdateInput = () => ({
  config: {
    agentId: '1000002',
    autoProvision: true,
    corpId: 'ww-corp',
    defaultRole: 'admin' as const,
    defaultWorkspaceId: 'workspace-1',
    enabled: true,
    enabledModes: ['web_qr'] as ('web_qr' | 'workbench')[],
    redirectUri: 'https://example.com/api/auth/oauth2/callback/wecom',
    trustedDomains: ['example.com'],
  },
  corpSecret: 'plain-secret',
  provider: 'wecom' as const,
});

const allowOnlyPermissions = (...allowedPermissions: string[]) => {
  const allowed = new Set(allowedPermissions);

  mockHasAnyPermission.mockImplementation(async (requestedPermissions: string[]) =>
    requestedPermissions.some((permission) => allowed.has(permission)),
  );
};

const settle = async <T>(promise: Promise<T>) => {
  try {
    return { status: 'fulfilled' as const, value: await promise };
  } catch (error) {
    return { error, status: 'rejected' as const };
  }
};

const expectPermissionCheck = (permission: string) => {
  const permissionChecks = mockHasAnyPermission.mock.calls.map(([requestedPermissions]) =>
    requestedPermissions,
  );

  expect(permissionChecks).toContainEqual([permission]);
  expect(permissionChecks).not.toContainEqual(['admin:access']);
};

const makeAclRow = (overrides: Record<string, unknown> = {}) => ({
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  createdBy: 'user-admin',
  id: 'acl-1',
  inheritedFromId: null,
  permission: 'read',
  principalId: 'user-member',
  principalType: 'user',
  resourceId: 'kb-1',
  resourceType: 'knowledge_base',
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  workspaceId: 'workspace-1',
  ...overrides,
});

const createKnowledgeDb = () => ({
  query: {
    knowledgeBases: {
      findMany: vi.fn(async () => [
        {
          id: 'kb-1',
          isPublic: false,
          name: '研发知识库',
          updatedAt: new Date('2026-01-02T00:00:00.000Z'),
          workspaceId: 'workspace-1',
        },
      ]),
    },
    workspaces: {
      findMany: vi.fn(async () => [{ id: 'workspace-1', name: '研发空间' }]),
    },
  },
  select: vi.fn((selection: Record<string, unknown>) => ({
    from: vi.fn(() => ({
      where: vi.fn(async () => ('total' in selection ? [{ total: 1 }] : [])),
    })),
  })),
});

const createAclDb = () => {
  const existingGrants = {
    connector: makeAclRow({
      id: 'acl-connector',
      resourceId: 'connector-1',
      resourceType: 'connector',
    }),
    knowledge_base: makeAclRow(),
    skill: makeAclRow({ id: 'acl-skill', resourceId: 'skill-1', resourceType: 'skill' }),
  };
  let selectedResourceType: keyof typeof existingGrants = 'knowledge_base';

  return {
    insert: vi.fn(() => ({
      values: vi.fn((values: any) => ({
        returning: vi.fn(async () => [
          makeAclRow({
            id: 'acl-2',
            permission: values.permission,
            principalId: values.principalId,
            resourceId: values.resourceId,
            resourceType: values.resourceType,
            workspaceId: values.workspaceId,
          }),
        ]),
      })),
    })),
    query: {
      agentSkills: {
        findFirst: vi.fn(async () => {
          selectedResourceType = 'skill';

          return {
            id: 'skill-1',
            userId: 'owner-1',
            workspaceId: 'workspace-1',
          };
        }),
      },
      knowledgeBases: {
        findFirst: vi.fn(async () => {
          selectedResourceType = 'knowledge_base';

          return {
            id: 'kb-1',
            userId: 'owner-1',
            workspaceId: 'workspace-1',
          };
        }),
      },
      resourceAccessControls: {
        findFirst: vi.fn(async () => undefined),
      },
      userConnectors: {
        findFirst: vi.fn(async () => {
          selectedResourceType = 'connector';

          return {
            id: 'connector-1',
            userId: 'owner-1',
            workspaceId: 'workspace-1',
          };
        }),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => [existingGrants[selectedResourceType]]),
      })),
    })),
    update: vi.fn(),
  };
};

const createAdminCoreReadDb = () => {
  const counts = [3, 2, 4, 2, 2];

  return {
    query: {
      rolePermissions: {
        findMany: vi.fn(async () => [
          { permissionCode: 'admin:access', roleId: 'role-admin' },
          { permissionCode: 'users:read', roleId: 'role-admin' },
          { permissionCode: 'knowledge:read', roleId: 'role-operator' },
        ]),
      },
      roles: {
        findMany: vi.fn(async () => [
          {
            description: 'Full access to the real admin console',
            displayName: 'Real Admin',
            id: 'role-admin',
            isActive: true,
            isSystem: true,
            name: 'real_admin',
            workspaceId: null,
          },
          {
            description: 'Can review content operations',
            displayName: 'Content Operator',
            id: 'role-operator',
            isActive: true,
            isSystem: false,
            name: 'content_operator',
            workspaceId: null,
          },
          {
            description: 'Temporarily disabled role',
            displayName: 'Disabled Operator',
            id: 'role-disabled-operator',
            isActive: false,
            isSystem: false,
            name: 'disabled_operator',
            workspaceId: null,
          },
        ]),
      },
      users: {
        findMany: vi.fn(async () => [
          {
            banned: false,
            email: 'ada@example.com',
            fullName: 'Ada Lovelace',
            id: 'user-ada',
            role: 'platform_admin',
            username: 'ada',
          },
          {
            banned: true,
            email: '',
            fullName: '',
            id: 'user-grace',
            role: 'user',
            username: 'grace',
          },
          {
            banned: false,
            email: '',
            fullName: '',
            id: 'user-id-fallback',
            role: 'user',
            username: '',
          },
        ]),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ total: counts.shift() ?? 0 }]),
      })),
    })),
  };
};

const createAdminOrgDb = () => ({
  query: {
    enterpriseDepartmentMembers: {
      findMany: vi.fn(async (query?: { where?: unknown }) => {
        const rows = [
          {
            departmentId: 'dept-root',
            isPrimary: true,
            status: 'active',
            userId: 'user-ada',
          },
          {
            departmentId: 'dept-child-a',
            isPrimary: false,
            status: 'active',
            userId: 'user-grace',
          },
          {
            departmentId: 'dept-child-a',
            isPrimary: true,
            status: 'active',
            userId: 'user-lin',
          },
        ];

        return query?.where ? rows.filter((row) => row.departmentId === 'dept-child-a') : rows;
      }),
    },
    enterpriseDepartments: {
      findMany: vi.fn(async () => [
        {
          externalDepartmentId: 'wx-root',
          id: 'dept-root',
          name: 'Headquarters',
          order: 10,
          parentId: null,
          provider: 'wecom',
          status: 'active',
        },
        {
          externalDepartmentId: 'wx-child-b',
          id: 'dept-child-b',
          name: 'Sales',
          order: 30,
          parentId: 'dept-root',
          provider: 'wecom',
          status: 'active',
        },
        {
          externalDepartmentId: 'wx-child-a',
          id: 'dept-child-a',
          name: 'Engineering',
          order: 20,
          parentId: 'dept-root',
          provider: 'wecom',
          status: 'active',
        },
      ]),
    },
    enterpriseUserProfiles: {
      findMany: vi.fn(async () => [
        {
          employeeNumber: 'E-001',
          employmentStatus: 'active',
          position: 'Principal Engineer',
          primaryDepartmentId: 'dept-child-a',
          userId: 'user-ada',
        },
        {
          employeeNumber: 'E-002',
          employmentStatus: 'active',
          position: 'Operations Lead',
          primaryDepartmentId: 'dept-root',
          userId: 'user-grace',
        },
        {
          employeeNumber: 'E-003',
          employmentStatus: 'inactive',
          position: 'Support Specialist',
          primaryDepartmentId: 'dept-child-a',
          userId: 'user-lin',
        },
      ]),
    },
    users: {
      findMany: vi.fn(async () => [
        {
          banned: false,
          email: 'ada@example.com',
          fullName: 'Ada Lovelace',
          id: 'user-ada',
          username: 'ada',
        },
        {
          banned: true,
          email: 'grace@example.com',
          fullName: '',
          id: 'user-grace',
          username: 'grace',
        },
        {
          banned: false,
          email: 'lin@example.com',
          fullName: '',
          id: 'user-lin',
          username: '',
        },
      ]),
    },
  },
});

const createAdminAuditDb = () => ({
  query: {
    enterpriseAuditLogs: {
      findMany: vi.fn(async () => [
        {
          action: 'org.department.upsert',
          actorUserId: 'user-admin',
          createdAt: new Date('2026-06-01T08:30:00.000Z'),
          id: 'audit-1',
          result: 'success',
          targetId: 'dept-child-a',
          targetType: 'department',
        },
        {
          action: 'org.sync.run',
          actorUserId: null,
          createdAt: new Date('2026-06-02T09:45:00.000Z'),
          id: 'audit-2',
          result: 'failed',
          targetId: null,
          targetType: 'wecom_sync',
        },
      ]),
    },
  },
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(async () => [{ total: 2 }]),
    })),
  })),
});

const createAdminUserProvisioningDb = (options: { hasWecomIdentity?: boolean } = {}) => {
  const auditValues: Record<string, unknown>[] = [];
  const hasWecomIdentity = options.hasWecomIdentity ?? true;

  return {
    auditValues,
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        auditValues.push(values);

        return {
          returning: vi.fn(async () => [{ ...values, id: 'audit-user-retry' }]),
        };
      }),
    })),
    query: {
      enterpriseAuditLogs: {
        findMany: vi.fn(async () => [
          {
            action: 'aihub.provisioning.failed',
            actorUserId: null,
            createdAt: new Date('2026-06-10T12:35:00.000Z'),
            id: 'audit-provisioning-error',
            result: 'failed',
            targetId: 'user-ada',
            targetType: 'user',
          },
        ]),
      },
      enterpriseUserProfiles: {
        findFirst: vi.fn(async () => ({
          employeeNumber: 'E-001',
          employmentStatus: 'active',
          externalUserId: 'wecom-ada',
          lastSyncedAt: new Date('2026-06-10T12:30:00.000Z'),
          position: 'Principal Engineer',
          primaryDepartmentId: 'dept-eng',
          provider: 'wecom',
          userId: 'user-ada',
        })),
      },
      externalIdentities: {
        findFirst: vi.fn(async () =>
          hasWecomIdentity
            ? {
                email: 'ada@example.com',
                externalUserId: 'wecom-ada',
                id: 'identity-wecom-ada',
                provider: 'wecom',
                unionId: 'union-ada',
                userId: 'user-ada',
              }
            : undefined,
        ),
      },
      newApiBindings: {
        findFirst: vi.fn(async () => ({
          errorMessage: 'AIHub provisioning failed: duplicate employee number',
          lastSyncedAt: new Date('2026-06-10T12:31:00.000Z'),
          managedTokenId: null,
          newApiUserId: null,
          status: 'error',
          userId: 'user-ada',
        })),
      },
      users: {
        findFirst: vi.fn(async () => ({
          banned: false,
          createdAt: new Date('2026-06-01T00:00:00.000Z'),
          email: 'ada@example.com',
          fullName: 'Ada Lovelace',
          id: 'user-ada',
          role: 'user',
          updatedAt: new Date('2026-06-11T00:00:00.000Z'),
          username: 'ada',
        })),
      },
    },
  };
};

const createAdminUserWriteDb = (
  options: {
    roleRows?: Array<{ id: string; isActive: boolean; workspaceId: null | string }>;
  } = {},
) => {
  const auditValues: Record<string, unknown>[] = [];
  const insertedUserRoles: Record<string, unknown>[] = [];
  const roleRows =
    options.roleRows ??
    [
      { id: 'role-enterprise-admin', isActive: true, workspaceId: null },
      { id: 'role-enterprise-member', isActive: true, workspaceId: null },
    ];
  const updatedUser = {
    banned: true,
    email: 'ada@example.com',
    fullName: 'Ada Lovelace',
    id: 'user-ada',
    role: 'user',
    username: 'ada',
  };
  const withReturningRows = (rows: Record<string, unknown>[]) =>
    Object.assign(Promise.resolve(rows), {
      returning: vi.fn(async () => rows),
    });
  const updateSet = vi.fn((values: Record<string, unknown>) => ({
    where: vi.fn(() =>
      withReturningRows([
        {
          ...updatedUser,
          banned: values.banned,
        },
      ]),
    ),
  }));
  const update = vi.fn(() => ({
    set: updateSet,
  }));
  const deleteWhereArgs: unknown[] = [];
  const deleteWhere = vi.fn((where: unknown) => {
    deleteWhereArgs.push(where);

    return withReturningRows([]);
  });
  const txDelete = vi.fn(() => ({
    where: deleteWhere,
  }));
  const txInsert = vi.fn(() => ({
    values: vi.fn((values: Record<string, unknown> | Record<string, unknown>[]) => {
      const rows = Array.isArray(values) ? values : [values];

      if (rows.every((row) => 'roleId' in row && 'userId' in row && !('action' in row))) {
        insertedUserRoles.push(...rows);
      } else {
        auditValues.push(...rows);
      }

      return {
        onConflictDoNothing: vi.fn(() => withReturningRows(rows)),
        returning: vi.fn(async () => rows),
      };
    }),
  }));
  const insert = vi.fn(() => ({
    values: vi.fn((values: Record<string, unknown>) => {
      auditValues.push(values);

      return {
        returning: vi.fn(async () => [{ ...values, id: 'audit-user-write' }]),
      };
    }),
  }));
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      delete: txDelete,
      insert: txInsert,
    }),
  );

  return {
    auditValues,
    deleteWhereArgs,
    deleteWhere,
    insert,
    insertedUserRoles,
    query: {
      roles: {
        findMany: vi.fn(async () => roleRows),
      },
    },
    transaction,
    txDelete,
    txInsert,
    update,
    updateSet,
  };
};

const createRolePermissionWriteDb = (
  options: {
    permissionRows?: Array<{ code: string; id: string; isActive: boolean }>;
    roleRow?: { id: string; isActive: boolean; workspaceId: null | string } | null;
  } = {},
) => {
  const auditValues: Record<string, unknown>[] = [];
  const deleteWhereArgs: unknown[] = [];
  const insertedRolePermissions: Record<string, unknown>[] = [];
  const operations: string[] = [];
  const roleRow =
    options.roleRow === undefined
      ? { id: 'role-content-operator', isActive: true, workspaceId: null }
      : options.roleRow;
  const permissionRows =
    options.permissionRows ??
    [
      { code: 'users:read', id: 'perm-users-read', isActive: true },
      { code: 'audit:read', id: 'perm-audit-read', isActive: true },
    ];
  const withReturningRows = (rows: Record<string, unknown>[]) =>
    Object.assign(Promise.resolve(rows), {
      returning: vi.fn(async () => rows),
    });
  const deleteWhere = vi.fn((where: unknown) => {
    operations.push('delete-role-permissions');
    deleteWhereArgs.push(where);

    return withReturningRows([]);
  });
  const txDelete = vi.fn(() => ({
    where: deleteWhere,
  }));
  const values = vi.fn((value: Record<string, unknown> | Record<string, unknown>[]) => {
    const rows = Array.isArray(value) ? value : [value];

    if (rows.every((row) => 'roleId' in row && 'permissionId' in row && !('action' in row))) {
      operations.push('insert-role-permissions');
      insertedRolePermissions.push(...rows);
    } else {
      auditValues.push(...rows);
    }

    return {
      onConflictDoNothing: vi.fn(() => withReturningRows(rows)),
      returning: vi.fn(async () => rows),
    };
  });
  const txInsert = vi.fn(() => ({
    values,
  }));
  const insert = vi.fn(() => ({
    values,
  }));
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      delete: txDelete,
      insert: txInsert,
    }),
  );

  return {
    auditValues,
    deleteWhereArgs,
    deleteWhere,
    insert,
    insertedRolePermissions,
    operations,
    query: {
      permissions: {
        findMany: vi.fn(async () => permissionRows),
      },
      roles: {
        findFirst: vi.fn(async () => roleRow ?? undefined),
        findMany: vi.fn(async () => (roleRow ? [roleRow] : [])),
      },
    },
    transaction,
    txDelete,
    txInsert,
  };
};

const createRoleLifecycleWriteDb = (
  options: {
    createRoleError?: Error;
    roleRow?:
      | {
          description?: null | string;
          displayName?: string;
          id: string;
          isActive: boolean;
          isSystem: boolean;
          name: string;
          workspaceId: null | string;
        }
      | null;
  } = {},
) => {
  const auditValues: Record<string, unknown>[] = [];
  const insertedRoles: Record<string, unknown>[] = [];
  const updateSetValues: Record<string, unknown>[] = [];
  const updateWhereArgs: unknown[] = [];
  const operations: string[] = [];
  const roleRow =
    options.roleRow === undefined
      ? {
          description: 'Can review enterprise operations',
          displayName: 'Operations Reviewer',
          id: 'role-operations-reviewer',
          isActive: true,
          isSystem: false,
          name: 'operations_reviewer',
          workspaceId: null,
        }
      : options.roleRow;
  const createdRole = {
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    description: 'Reviews audit trails',
    displayName: 'Audit Reviewer',
    id: 'role-audit-reviewer',
    isActive: true,
    isSystem: false,
    name: 'audit_reviewer',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    workspaceId: null,
  };
  const returningRows = (rows: Record<string, unknown>[]) => ({
    returning: vi.fn(async () => rows),
  });
  const insertValues = vi.fn((value: Record<string, unknown> | Record<string, unknown>[]) => {
    const rows = Array.isArray(value) ? value : [value];

    if (rows.every((row) => 'action' in row)) {
      operations.push('audit');
      auditValues.push(...rows);

      return returningRows(rows.map((row) => ({ ...row, id: 'audit-role-lifecycle' })));
    }

    operations.push('role-insert');
    insertedRoles.push(...rows);

    if (options.createRoleError) {
      return {
        returning: vi.fn(async () => {
          throw options.createRoleError;
        }),
      };
    }

    return returningRows(rows.map((row) => ({ ...createdRole, ...row })));
  });
  const insert = vi.fn(() => ({
    values: insertValues,
  }));
  const updateWhere = vi.fn((where: unknown) => {
    updateWhereArgs.push(where);

    return returningRows([
      {
        ...(roleRow ?? {}),
        ...updateSetValues[updateSetValues.length - 1],
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      } as Record<string, unknown>,
    ]);
  });
  const updateSet = vi.fn((values: Record<string, unknown>) => {
    operations.push('role-update');
    updateSetValues.push(values);

    return {
      where: updateWhere,
    };
  });
  const update = vi.fn(() => ({
    set: updateSet,
  }));
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      insert,
      query: {
        roles: {
          findFirst: vi.fn(async () => roleRow ?? undefined),
        },
      },
      update,
    }),
  );

  return {
    auditValues,
    insert,
    insertedRoles,
    insertValues,
    operations,
    query: {
      roles: {
        findFirst: vi.fn(async () => roleRow ?? undefined),
      },
    },
    transaction,
    update,
    updateSet,
    updateSetValues,
    updateWhere,
    updateWhereArgs,
  };
};

const collectInspectableTokens = (value: unknown, seen = new Set<object>()): string[] => {
  if (value === null || value === undefined) return [String(value)];
  if (['boolean', 'number', 'string'].includes(typeof value)) return [String(value)];
  if (typeof value === 'function') return [value.name];
  if (typeof value !== 'object') return [];
  if (seen.has(value)) return [];

  seen.add(value);

  const record = value as Record<PropertyKey, unknown>;
  const tokens = [value.constructor?.name ?? ''];

  for (const key of Reflect.ownKeys(record)) {
    tokens.push(String(key));
    tokens.push(...collectInspectableTokens(record[key], seen));
  }

  return tokens;
};

const createAdminOrgWriteDb = () => {
  const auditValues: Record<string, unknown>[] = [];
  const departmentRow = {
    externalDepartmentId: 'wx-rd',
    id: 'dept-rd',
    name: '\u7814\u53d1\u4e2d\u5fc3',
    order: 20,
    parentId: null,
    provider: 'wecom',
    status: 'active',
  };
  const membershipRow = {
    departmentId: 'dept-child-b',
    isPrimary: true,
    status: 'active',
    userId: 'user-grace',
  };
  const insert = vi.fn((table?: unknown) => ({
    values: vi.fn((values: Record<string, unknown>) => {
      if (String(table).includes('enterprise_audit_logs') || values.action) {
        auditValues.push(values);

        return {
          returning: vi.fn(async () => [{ ...values, id: 'audit-created' }]),
        };
      }

      return {
        onConflictDoUpdate: vi.fn(() => ({
          returning: vi.fn(async () =>
            values.userId && values.departmentId ? [membershipRow] : [departmentRow],
          ),
        })),
        returning: vi.fn(async () =>
          values.userId && values.departmentId ? [membershipRow] : [departmentRow],
        ),
      };
    }),
  }));
  const updateSet = vi.fn(() => ({
    where: vi.fn(async () => [{ userId: 'user-grace' }]),
  }));
  const update = vi.fn(() => ({
    set: updateSet,
  }));

  return {
    auditValues,
    insert,
    query: {},
    update,
    updateSet,
  };
};

const createAdminContext = async (role: string) =>
  ({
    ...(await createContextInner({ userId: 'user-admin' })),
    user: { id: 'user-admin', role },
  }) as never;

describe('adminRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerDB).mockResolvedValue(mockServerDB as never);
    mockHasAnyPermission.mockResolvedValue(false);
    mockProvisionWecomLoginAccount.mockResolvedValue(undefined);
    mockApplyEnterpriseDirectorySnapshot.mockResolvedValue({
      inactiveMembers: 0,
      status: 'completed',
      syncedDepartments: 0,
      syncedMembers: 0,
    });
    mockGetWecomSsoConfig.mockResolvedValue(mockSsoConfig);
    mockUpsertWecomSsoConfig.mockResolvedValue({
      ...mockSsoConfig,
      config: {
        ...mockSsoConfig.config,
        agentId: '1000002',
        corpId: 'ww-corp',
        enabled: true,
      },
      corpSecretConfigured: true,
      enabled: true,
    });
  });

  it('returns platform admin identity for platform admin users from context role', async () => {
    const caller = createCaller(await createAdminContext('platform_admin'));

    await expect(caller.me()).resolves.toEqual({
      isPlatformAdmin: true,
      userId: 'user-admin',
    });
  });

  it('returns platform admin identity for production userId-only context when database role is platform admin', async () => {
    vi.mocked(UserModel.findById).mockResolvedValue({
      id: 'user-admin',
      role: 'platform_admin',
    } as never);
    const caller = createCaller(await createContextInner({ userId: 'user-admin' }));

    await expect(caller.me()).resolves.toEqual({
      isPlatformAdmin: true,
      userId: 'user-admin',
    });
    expect(UserModel.findById).toHaveBeenCalledWith(mockServerDB, 'user-admin');
  });

  it('allows admin console access through RBAC admin:access permission without a legacy platform role', async () => {
    mockHasAnyPermission.mockResolvedValue(true);
    const caller = createCaller(await createAdminContext('user'));

    await expect(caller.me()).resolves.toEqual({
      isPlatformAdmin: true,
      userId: 'user-admin',
    });
    expect(mockHasAnyPermission.mock.calls[0]?.[0]).toEqual(['admin:access']);
  });

  it('returns stable default payloads for admin console read APIs', async () => {
    const caller = createCaller(await createAdminContext('platform_admin'));

    await expect(caller.listWorkspaces({ page: 1, pageSize: 20 })).resolves.toEqual({
      items: [],
      total: 0,
    });
    await expect(caller.listRoles()).resolves.toEqual({
      items: expect.arrayContaining([
        expect.objectContaining({
          id: 'platform_admin',
          permissions: expect.arrayContaining(['users:*', 'workspace:*', 'system:*']),
        }),
      ]),
    });
    await expect(caller.getSsoConfig()).resolves.toEqual(mockSsoConfig);
    expect(mockGetWecomSsoConfig).toHaveBeenCalledWith(mockServerDB);
    await expect(caller.getSystemConfig()).resolves.toMatchObject({
      knowledge: expect.any(Object),
      skillMcp: expect.any(Object),
      upload: expect.any(Object),
    });
    await expect(caller.listAuditLogs({ page: 1, pageSize: 20 })).resolves.toEqual({
      items: [],
      total: 0,
    });
    await expect(caller.listKnowledgeBases({ page: 1, pageSize: 20 })).resolves.toEqual({
      items: [],
      total: 0,
    });
    await expect(caller.listSkillPolicies({ page: 1, pageSize: 20 })).resolves.toEqual({
      items: [],
      total: 0,
    });
    await expect(caller.listMcpConnectors({ page: 1, pageSize: 20 })).resolves.toEqual({
      items: [],
      total: 0,
    });
  });

  it('updates WeCom SSO config through the enterprise SSO service', async () => {
    const caller = createCaller(await createAdminContext('platform_admin'));
    const input = {
      config: {
        agentId: '1000002',
        autoProvision: true,
        corpId: 'ww-corp',
        defaultRole: 'admin' as const,
        defaultWorkspaceId: 'workspace-1',
        enabled: true,
        enabledModes: ['web_qr'] as ('web_qr' | 'workbench')[],
        redirectUri: 'https://example.com/api/auth/oauth2/callback/wecom',
        trustedDomains: ['example.com'],
      },
      corpSecret: 'plain-secret',
      provider: 'wecom' as const,
    };

    await expect(caller.updateSsoConfig(input)).resolves.toMatchObject({
      config: {
        agentId: '1000002',
        corpId: 'ww-corp',
        enabled: true,
      },
      corpSecretConfigured: true,
      provider: 'wecom',
    });
    expect(mockUpsertWecomSsoConfig).toHaveBeenCalledWith(
      mockServerDB,
      {
        config: {
          ...input.config,
          ...defaultEnterpriseWecomBlocks,
        },
        corpSecret: 'plain-secret',
      },
      'user-admin',
    );
  });

  it('lists users from server DB for platform admins with frontend fields', async () => {
    const db = createAdminCoreReadDb();
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('platform_admin'));

    await expect(caller.listUsers({ page: 1, pageSize: 20 })).resolves.toEqual({
      items: [
        {
          email: 'ada@example.com',
          id: 'user-ada',
          name: 'Ada Lovelace',
          role: 'platform_admin',
          status: '正常',
        },
        {
          email: '',
          id: 'user-grace',
          name: 'grace',
          role: 'user',
          status: '禁用',
        },
        {
          email: '',
          id: 'user-id-fallback',
          name: 'user-id-fallback',
          role: 'user',
          status: '正常',
        },
      ],
      total: 3,
    });
    expect(db.query.users.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 20,
        offset: 0,
      }),
    );
  });

  it('returns user provisioning details for RBAC users with only user:manage', async () => {
    allowOnlyPermissions('user:manage');
    const db = createAdminUserProvisioningDb();
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('user')) as any;

    const result = await settle(
      Promise.resolve().then(() => caller.getUserDetail({ userId: 'user-ada' })),
    );

    expectPermissionCheck('user:manage');
    expect(result).toMatchObject({
      status: 'fulfilled',
      value: {
        aihubBinding: {
          errorMessage: 'AIHub provisioning failed: duplicate employee number',
          isBound: false,
          lastSyncedAt: '2026-06-10T12:31:00.000Z',
          managedTokenId: null,
          status: 'error',
        },
        enterpriseProfile: {
          employeeNumber: 'E-001',
          employmentStatus: 'active',
          externalUserId: 'wecom-ada',
          lastSyncedAt: '2026-06-10T12:30:00.000Z',
          position: 'Principal Engineer',
          primaryDepartmentId: 'dept-eng',
          provider: 'wecom',
        },
        externalIdentity: {
          email: 'ada@example.com',
          externalUserId: 'wecom-ada',
          provider: 'wecom',
          unionId: 'union-ada',
        },
        user: {
          createdAt: '2026-06-01T00:00:00.000Z',
          email: 'ada@example.com',
          id: 'user-ada',
          name: 'Ada Lovelace',
          role: 'user',
          updatedAt: '2026-06-11T00:00:00.000Z',
        },
      },
    });
    expect(db.query.users.findFirst).toHaveBeenCalled();
    expect(db.query.enterpriseUserProfiles.findFirst).toHaveBeenCalled();
    expect(db.query.externalIdentities.findFirst).toHaveBeenCalled();
    expect(db.query.newApiBindings.findFirst).toHaveBeenCalled();
  });

  it('retries WeCom provisioning for RBAC users with only user:manage and writes audit log', async () => {
    allowOnlyPermissions('user:manage');
    const db = createAdminUserProvisioningDb();
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    mockProvisionWecomLoginAccount.mockResolvedValueOnce({
      aihub: { newApiUserId: 10001, status: 'active' },
    });
    const caller = createCaller(await createAdminContext('user')) as any;

    const result = await settle(
      Promise.resolve().then(() => caller.retryUserProvisioning({ userId: 'user-ada' })),
    );

    expectPermissionCheck('user:manage');
    expect(result).toMatchObject({
      status: 'fulfilled',
      value: {
        ok: true,
        provisioned: true,
        status: 'success',
        userId: 'user-ada',
      },
    });
    expect(mockProvisionWecomLoginAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        account: {
          accountId: 'wecom-ada',
          providerId: 'wecom',
          userId: 'user-ada',
        },
      }),
      expect.objectContaining({ db }),
    );
    expect(db.auditValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'identity.provision.retry',
          actorUserId: 'user-admin',
          metadata: expect.objectContaining({
            externalUserId: 'wecom-ada',
            provider: 'wecom',
          }),
          result: 'success',
          targetId: 'user-ada',
          targetType: 'user',
        }),
      ]),
    );
  });

  it('marks retry provisioning as skipped when enterprise policy does not execute', async () => {
    allowOnlyPermissions('user:manage');
    const db = createAdminUserProvisioningDb();
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    mockProvisionWecomLoginAccount.mockResolvedValueOnce(undefined);
    const caller = createCaller(await createAdminContext('user')) as any;

    const result = await settle(
      Promise.resolve().then(() => caller.retryUserProvisioning({ userId: 'user-ada' })),
    );

    expect(result).toMatchObject({
      status: 'fulfilled',
      value: {
        ok: true,
        provisioned: false,
        status: 'skipped',
        userId: 'user-ada',
      },
    });
    expect(db.auditValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'identity.provision.retry',
          result: 'skipped',
          targetId: 'user-ada',
          targetType: 'user',
        }),
      ]),
    );
  });

  it('returns PRECONDITION_FAILED when retrying provisioning without a WeCom identity', async () => {
    allowOnlyPermissions('user:manage');
    const db = createAdminUserProvisioningDb({ hasWecomIdentity: false });
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('user')) as any;

    const result = await settle(
      Promise.resolve().then(() => caller.retryUserProvisioning({ userId: 'user-ada' })),
    );

    expectPermissionCheck('user:manage');
    expect(result).toMatchObject({
      error: expect.objectContaining({ code: 'PRECONDITION_FAILED' }),
      status: 'rejected',
    });
    expect(mockProvisionWecomLoginAccount).not.toHaveBeenCalled();
  });

  it('updates user status for RBAC users with only user:manage and writes audit log', async () => {
    allowOnlyPermissions('user:manage');
    const db = createAdminUserWriteDb();
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('user')) as any;

    const result = await settle(
      Promise.resolve().then(() =>
        caller.updateUserStatus({
          banned: true,
          reason: 'left company',
          userId: 'user-ada',
        }),
      ),
    );

    expectPermissionCheck('user:manage');
    expect(result).toMatchObject({
      status: 'fulfilled',
      value: {
        email: 'ada@example.com',
        id: 'user-ada',
        name: 'Ada Lovelace',
        role: 'user',
        status: '禁用',
      },
    });
    expect(db.updateSet).toHaveBeenCalledWith({
      banExpires: null,
      banReason: 'left company',
      banned: true,
    });
    expect(db.auditValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'user.status.update',
          actorUserId: 'user-admin',
          metadata: expect.objectContaining({
            banned: true,
            reason: 'left company',
          }),
          result: 'success',
          targetId: 'user-ada',
          targetType: 'user',
        }),
      ]),
    );
  });

  it('assigns global roles for RBAC users with only role:manage and writes audit log', async () => {
    allowOnlyPermissions('role:manage');
    const db = createAdminUserWriteDb();
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('user')) as any;

    const result = await settle(
      Promise.resolve().then(() =>
        caller.assignUserRoles({
          roleIds: ['role-enterprise-admin', 'role-enterprise-member'],
          userId: 'user-ada',
        }),
      ),
    );

    expectPermissionCheck('role:manage');
    expect(result).toMatchObject({
      status: 'fulfilled',
      value: {
        roleIds: ['role-enterprise-admin', 'role-enterprise-member'],
        userId: 'user-ada',
      },
    });
    expect(db.transaction).toHaveBeenCalled();
    expect(db.txDelete).toHaveBeenCalled();
    expect(db.deleteWhereArgs).toHaveLength(1);
    expect(collectInspectableTokens(db.deleteWhereArgs[0]).join(' ')).toContain('workspace_id');
    expect(collectInspectableTokens(db.deleteWhereArgs[0]).join(' ')).toContain('user_id');
    expect(db.insertedUserRoles).toEqual([
      { roleId: 'role-enterprise-admin', userId: 'user-ada', workspaceId: null },
      { roleId: 'role-enterprise-member', userId: 'user-ada', workspaceId: null },
    ]);
    expect(db.auditValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'user.roles.assign',
          actorUserId: 'user-admin',
          metadata: expect.objectContaining({
            roleIds: ['role-enterprise-admin', 'role-enterprise-member'],
          }),
          result: 'success',
          targetId: 'user-ada',
          targetType: 'user',
        }),
      ]),
    );
  });

  it('rejects workspace or inactive roles when assigning global user roles', async () => {
    allowOnlyPermissions('role:manage');
    const db = createAdminUserWriteDb({
      roleRows: [
        { id: 'role-enterprise-admin', isActive: true, workspaceId: null },
        { id: 'role-workspace-owner', isActive: true, workspaceId: 'workspace-1' },
      ],
    });
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('user')) as any;

    const result = await settle(
      Promise.resolve().then(() =>
        caller.assignUserRoles({
          roleIds: ['role-enterprise-admin', 'role-workspace-owner'],
          userId: 'user-ada',
        }),
      ),
    );

    expectPermissionCheck('role:manage');
    expect(result).toMatchObject({
      error: expect.objectContaining({ code: 'PRECONDITION_FAILED' }),
      status: 'rejected',
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects inactive global roles when assigning global user roles', async () => {
    allowOnlyPermissions('role:manage');
    const db = createAdminUserWriteDb({
      roleRows: [{ id: 'role-disabled-global', isActive: false, workspaceId: null }],
    });
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('user')) as any;

    const result = await settle(
      Promise.resolve().then(() =>
        caller.assignUserRoles({
          roleIds: ['role-disabled-global'],
          userId: 'user-ada',
        }),
      ),
    );

    expectPermissionCheck('role:manage');
    expect(result).toMatchObject({
      error: expect.objectContaining({ code: 'PRECONDITION_FAILED' }),
      status: 'rejected',
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('creates a global custom role for RBAC users with only role:manage and writes an audit log', async () => {
    allowOnlyPermissions('role:manage');
    const db = createRoleLifecycleWriteDb();
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('user')) as any;

    const result = await settle(
      Promise.resolve().then(() =>
        caller.createRole({
          description: ' Reviews audit trails ',
          displayName: ' Audit Reviewer ',
          name: ' audit_reviewer ',
        }),
      ),
    );

    expect(result).toMatchObject({
      status: 'fulfilled',
      value: {
        description: 'Reviews audit trails',
        id: 'role-audit-reviewer',
        name: 'Audit Reviewer',
        permissions: [],
      },
    });
    expectPermissionCheck('role:manage');
    expect(db.transaction).toHaveBeenCalled();
    expect(db.insertedRoles).toEqual([
      expect.objectContaining({
        description: 'Reviews audit trails',
        displayName: 'Audit Reviewer',
        isActive: true,
        isSystem: false,
        name: 'audit_reviewer',
        workspaceId: null,
      }),
    ]);
    expect(db.auditValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'role.create',
          actorUserId: 'user-admin',
          metadata: expect.objectContaining({
            displayName: 'Audit Reviewer',
            name: 'audit_reviewer',
          }),
          result: 'success',
          targetId: 'role-audit-reviewer',
          targetType: 'role',
        }),
      ]),
    );
  });

  it('returns a stable conflict error when creating a duplicate global custom role', async () => {
    allowOnlyPermissions('role:manage');
    const duplicateError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: 'rbac_roles_name_workspace_unique',
    });
    const db = createRoleLifecycleWriteDb({ createRoleError: duplicateError });
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('user')) as any;

    const result = await settle(
      Promise.resolve().then(() =>
        caller.createRole({
          displayName: 'Audit Reviewer',
          name: 'audit_reviewer',
        }),
      ),
    );

    expect(result).toMatchObject({
      error: expect.objectContaining({ code: 'CONFLICT' }),
      status: 'rejected',
    });
    expectPermissionCheck('role:manage');
    expect(db.auditValues).toEqual([]);
  });

  it('updates an active global custom role and writes an audit log', async () => {
    allowOnlyPermissions('role:manage');
    const db = createRoleLifecycleWriteDb();
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('user')) as any;

    const result = await settle(
      Promise.resolve().then(() =>
        caller.updateRole({
          description: ' Reviews enterprise operations ',
          displayName: ' Operations Reviewer ',
          roleId: 'role-operations-reviewer',
        }),
      ),
    );

    expect(result).toMatchObject({
      status: 'fulfilled',
      value: {
        description: 'Reviews enterprise operations',
        id: 'role-operations-reviewer',
        name: 'Operations Reviewer',
        permissions: [],
      },
    });
    expectPermissionCheck('role:manage');
    expect(db.transaction).toHaveBeenCalled();
    expect(db.updateSetValues).toEqual([
      expect.objectContaining({
        description: 'Reviews enterprise operations',
        displayName: 'Operations Reviewer',
      }),
    ]);
    const updateWhereTokens = collectInspectableTokens(db.updateWhereArgs[0]).join(' ');
    expect(updateWhereTokens).toContain('id');
    expect(updateWhereTokens).toContain('is_system');
    expect(updateWhereTokens).toContain('workspace_id');
    expect(updateWhereTokens).toContain('is_active');
    expect(db.auditValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'role.update',
          actorUserId: 'user-admin',
          metadata: expect.objectContaining({
            description: 'Reviews enterprise operations',
            displayName: 'Operations Reviewer',
            roleId: 'role-operations-reviewer',
          }),
          result: 'success',
          targetId: 'role-operations-reviewer',
          targetType: 'role',
        }),
      ]),
    );
  });

  it.each([
    [
      'system role',
      {
        id: 'role-admin',
        isActive: true,
        isSystem: true,
        name: 'admin',
        workspaceId: null,
      },
    ],
    [
      'workspace-scoped role',
      {
        id: 'role-workspace-owner',
        isActive: true,
        isSystem: false,
        name: 'workspace_owner',
        workspaceId: 'workspace-1',
      },
    ],
    [
      'inactive custom role',
      {
        id: 'role-disabled',
        isActive: false,
        isSystem: false,
        name: 'disabled',
        workspaceId: null,
      },
    ],
  ])('rejects updating a protected or ineligible %s', async (_label, roleRow) => {
    allowOnlyPermissions('role:manage');
    const db = createRoleLifecycleWriteDb({ roleRow });
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('user')) as any;

    const result = await settle(
      Promise.resolve().then(() =>
        caller.updateRole({
          displayName: 'Updated Role',
          roleId: roleRow.id,
        }),
      ),
    );

    expect(result).toMatchObject({
      error: expect.objectContaining({ code: 'PRECONDITION_FAILED' }),
      status: 'rejected',
    });
    expectPermissionCheck('role:manage');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when updating a missing custom role', async () => {
    allowOnlyPermissions('role:manage');
    const db = createRoleLifecycleWriteDb({ roleRow: null });
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('user')) as any;

    const result = await settle(
      Promise.resolve().then(() =>
        caller.updateRole({
          displayName: 'Missing Role',
          roleId: 'role-missing',
        }),
      ),
    );

    expect(result).toMatchObject({
      error: expect.objectContaining({ code: 'NOT_FOUND' }),
      status: 'rejected',
    });
    expectPermissionCheck('role:manage');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('updates global custom role status and writes an audit log', async () => {
    allowOnlyPermissions('role:manage');
    const db = createRoleLifecycleWriteDb();
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('user')) as any;

    const result = await settle(
      Promise.resolve().then(() =>
        caller.updateRoleStatus({
          isActive: false,
          roleId: 'role-operations-reviewer',
        }),
      ),
    );

    expect(result).toMatchObject({
      status: 'fulfilled',
      value: {
        id: 'role-operations-reviewer',
        name: 'Operations Reviewer',
        permissions: [],
      },
    });
    expectPermissionCheck('role:manage');
    expect(db.transaction).toHaveBeenCalled();
    expect(db.updateSetValues).toEqual([expect.objectContaining({ isActive: false })]);
    const statusWhereTokens = collectInspectableTokens(db.updateWhereArgs[0]).join(' ');
    expect(statusWhereTokens).toContain('id');
    expect(statusWhereTokens).toContain('is_system');
    expect(statusWhereTokens).toContain('workspace_id');
    expect(db.auditValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'role.status.update',
          actorUserId: 'user-admin',
          metadata: { isActive: false },
          result: 'success',
          targetId: 'role-operations-reviewer',
          targetType: 'role',
        }),
      ]),
    );
  });

  it('re-enables an inactive global custom role through role status updates', async () => {
    allowOnlyPermissions('role:manage');
    const db = createRoleLifecycleWriteDb({
      roleRow: {
        description: 'Temporarily disabled role',
        displayName: 'Operations Reviewer',
        id: 'role-operations-reviewer',
        isActive: false,
        isSystem: false,
        name: 'operations_reviewer',
        workspaceId: null,
      },
    });
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('user')) as any;

    const result = await settle(
      Promise.resolve().then(() =>
        caller.updateRoleStatus({
          isActive: true,
          roleId: 'role-operations-reviewer',
        }),
      ),
    );

    expect(result).toMatchObject({
      status: 'fulfilled',
      value: {
        id: 'role-operations-reviewer',
        isActive: true,
        name: 'Operations Reviewer',
        permissions: [],
      },
    });
    expectPermissionCheck('role:manage');
    expect(db.updateSetValues).toEqual([expect.objectContaining({ isActive: true })]);
    expect(db.auditValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'role.status.update',
          metadata: { isActive: true },
          result: 'success',
          targetId: 'role-operations-reviewer',
          targetType: 'role',
        }),
      ]),
    );
  });

  it('returns NOT_FOUND when updating status for a missing custom role', async () => {
    allowOnlyPermissions('role:manage');
    const db = createRoleLifecycleWriteDb({ roleRow: null });
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('user')) as any;

    const result = await settle(
      Promise.resolve().then(() =>
        caller.updateRoleStatus({
          isActive: false,
          roleId: 'role-missing',
        }),
      ),
    );

    expect(result).toMatchObject({
      error: expect.objectContaining({ code: 'NOT_FOUND' }),
      status: 'rejected',
    });
    expectPermissionCheck('role:manage');
    expect(db.update).not.toHaveBeenCalled();
  });

  it.each([
    [
      'system role',
      {
        id: 'role-admin',
        isActive: true,
        isSystem: true,
        name: 'admin',
        workspaceId: null,
      },
    ],
    [
      'workspace-scoped role',
      {
        id: 'role-workspace-owner',
        isActive: true,
        isSystem: false,
        name: 'workspace_owner',
        workspaceId: 'workspace-1',
      },
    ],
  ])('rejects status updates for a protected or ineligible %s', async (_label, roleRow) => {
    allowOnlyPermissions('role:manage');
    const db = createRoleLifecycleWriteDb({ roleRow });
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('user')) as any;

    const result = await settle(
      Promise.resolve().then(() =>
        caller.updateRoleStatus({
          isActive: false,
          roleId: roleRow.id,
        }),
      ),
    );

    expect(result).toMatchObject({
      error: expect.objectContaining({ code: 'PRECONDITION_FAILED' }),
      status: 'rejected',
    });
    expectPermissionCheck('role:manage');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('denies RBAC users with only user:manage from custom role lifecycle operations', async () => {
    allowOnlyPermissions('user:manage');
    const db = createRoleLifecycleWriteDb();
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('user')) as any;

    const createResult = await settle(
      Promise.resolve().then(() =>
        caller.createRole({
          displayName: 'Audit Reviewer',
          name: 'audit_reviewer',
        }),
      ),
    );
    const updateResult = await settle(
      Promise.resolve().then(() =>
        caller.updateRole({
          displayName: 'Operations Reviewer',
          roleId: 'role-operations-reviewer',
        }),
      ),
    );
    const statusResult = await settle(
      Promise.resolve().then(() =>
        caller.updateRoleStatus({
          isActive: false,
          roleId: 'role-operations-reviewer',
        }),
      ),
    );

    expect(createResult).toMatchObject({
      error: expect.objectContaining({ code: 'FORBIDDEN' }),
      status: 'rejected',
    });
    expect(updateResult).toMatchObject({
      error: expect.objectContaining({ code: 'FORBIDDEN' }),
      status: 'rejected',
    });
    expect(statusResult).toMatchObject({
      error: expect.objectContaining({ code: 'FORBIDDEN' }),
      status: 'rejected',
    });
    expectPermissionCheck('role:manage');
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('updates active global role permissions transactionally and writes an audit log', async () => {
    allowOnlyPermissions('role:manage');
    const db = createRolePermissionWriteDb();
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('user')) as any;

    const result = await settle(
      Promise.resolve().then(() =>
        caller.updateRolePermissions({
          permissionCodes: ['users:read', 'audit:read', 'users:read'],
          roleId: 'role-content-operator',
        }),
      ),
    );

    expect(result).toMatchObject({
      status: 'fulfilled',
      value: {
        permissionCodes: ['users:read', 'audit:read'],
        roleId: 'role-content-operator',
      },
    });
    expectPermissionCheck('role:manage');
    expect(db.transaction).toHaveBeenCalled();
    expect(db.txDelete).toHaveBeenCalled();
    expect(db.deleteWhereArgs).toHaveLength(1);
    expect(collectInspectableTokens(db.deleteWhereArgs[0]).join(' ')).toContain('role_id');
    expect(db.operations).toEqual(['delete-role-permissions', 'insert-role-permissions']);
    expect(db.insertedRolePermissions).toEqual([
      expect.objectContaining({
        permissionId: 'perm-users-read',
        roleId: 'role-content-operator',
      }),
      expect.objectContaining({
        permissionId: 'perm-audit-read',
        roleId: 'role-content-operator',
      }),
    ]);
    expect(db.auditValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'role.permissions.update',
          actorUserId: 'user-admin',
          metadata: expect.objectContaining({
            permissionCodes: ['users:read', 'audit:read'],
          }),
          result: 'success',
          targetId: 'role-content-operator',
          targetType: 'role',
        }),
      ]),
    );
  });

  it('clears a global role permission matrix when permissionCodes is empty', async () => {
    allowOnlyPermissions('role:manage');
    const db = createRolePermissionWriteDb();
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('user')) as any;

    const result = await settle(
      Promise.resolve().then(() =>
        caller.updateRolePermissions({
          permissionCodes: [],
          roleId: 'role-content-operator',
        }),
      ),
    );

    expect(result).toMatchObject({
      status: 'fulfilled',
      value: {
        permissionCodes: [],
        roleId: 'role-content-operator',
      },
    });
    expectPermissionCheck('role:manage');
    expect(db.transaction).toHaveBeenCalled();
    expect(db.txDelete).toHaveBeenCalled();
    expect(db.txInsert).not.toHaveBeenCalled();
    expect(db.auditValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'role.permissions.update',
          metadata: expect.objectContaining({ permissionCodes: [] }),
          result: 'success',
          targetId: 'role-content-operator',
          targetType: 'role',
        }),
      ]),
    );
  });

  it('rejects workspace-scoped roles when updating role permissions', async () => {
    allowOnlyPermissions('role:manage');
    const db = createRolePermissionWriteDb({
      roleRow: { id: 'role-workspace-owner', isActive: true, workspaceId: 'workspace-1' },
    });
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('user')) as any;

    const result = await settle(
      Promise.resolve().then(() =>
        caller.updateRolePermissions({
          permissionCodes: ['users:read'],
          roleId: 'role-workspace-owner',
        }),
      ),
    );

    expect(result).toMatchObject({
      error: expect.objectContaining({ code: 'PRECONDITION_FAILED' }),
      status: 'rejected',
    });
    expectPermissionCheck('role:manage');
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects inactive global roles when updating role permissions', async () => {
    allowOnlyPermissions('role:manage');
    const db = createRolePermissionWriteDb({
      roleRow: { id: 'role-disabled-global', isActive: false, workspaceId: null },
    });
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('user')) as any;

    const result = await settle(
      Promise.resolve().then(() =>
        caller.updateRolePermissions({
          permissionCodes: ['users:read'],
          roleId: 'role-disabled-global',
        }),
      ),
    );

    expect(result).toMatchObject({
      error: expect.objectContaining({ code: 'PRECONDITION_FAILED' }),
      status: 'rejected',
    });
    expectPermissionCheck('role:manage');
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when updating permissions for a missing role', async () => {
    allowOnlyPermissions('role:manage');
    const db = createRolePermissionWriteDb({ roleRow: null });
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('user')) as any;

    const result = await settle(
      Promise.resolve().then(() =>
        caller.updateRolePermissions({
          permissionCodes: ['users:read'],
          roleId: 'role-missing',
        }),
      ),
    );

    expect(result).toMatchObject({
      error: expect.objectContaining({ code: 'NOT_FOUND' }),
      status: 'rejected',
    });
    expectPermissionCheck('role:manage');
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects missing permission codes when updating role permissions', async () => {
    allowOnlyPermissions('role:manage');
    const db = createRolePermissionWriteDb({
      permissionRows: [{ code: 'users:read', id: 'perm-users-read', isActive: true }],
    });
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('user')) as any;

    const result = await settle(
      Promise.resolve().then(() =>
        caller.updateRolePermissions({
          permissionCodes: ['users:read', 'knowledge:read'],
          roleId: 'role-content-operator',
        }),
      ),
    );

    expect(result).toMatchObject({
      error: expect.objectContaining({ code: 'PRECONDITION_FAILED' }),
      status: 'rejected',
    });
    expectPermissionCheck('role:manage');
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects inactive permission codes when updating role permissions', async () => {
    allowOnlyPermissions('role:manage');
    const db = createRolePermissionWriteDb({
      permissionRows: [
        { code: 'users:read', id: 'perm-users-read', isActive: true },
        { code: 'audit:read', id: 'perm-audit-read', isActive: false },
      ],
    });
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('user')) as any;

    const result = await settle(
      Promise.resolve().then(() =>
        caller.updateRolePermissions({
          permissionCodes: ['users:read', 'audit:read'],
          roleId: 'role-content-operator',
        }),
      ),
    );

    expect(result).toMatchObject({
      error: expect.objectContaining({ code: 'PRECONDITION_FAILED' }),
      status: 'rejected',
    });
    expectPermissionCheck('role:manage');
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('denies RBAC users with only user:manage from updating role permissions', async () => {
    allowOnlyPermissions('user:manage');
    const db = createRolePermissionWriteDb();
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('user')) as any;

    const result = await settle(
      Promise.resolve().then(() =>
        caller.updateRolePermissions({
          permissionCodes: ['users:read'],
          roleId: 'role-content-operator',
        }),
      ),
    );

    expect(result).toMatchObject({
      error: expect.objectContaining({ code: 'FORBIDDEN' }),
      status: 'rejected',
    });
    expectPermissionCheck('role:manage');
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('keeps user status and role assignment permissions separate', async () => {
    const db = createAdminUserWriteDb();
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('user')) as any;

    allowOnlyPermissions('role:manage');
    const statusResult = await settle(
      Promise.resolve().then(() =>
        caller.updateUserStatus({
          banned: true,
          userId: 'user-ada',
        }),
      ),
    );

    allowOnlyPermissions('user:manage');
    const rolesResult = await settle(
      Promise.resolve().then(() =>
        caller.assignUserRoles({
          roleIds: ['role-enterprise-admin'],
          userId: 'user-ada',
        }),
      ),
    );

    expect(statusResult).toMatchObject({
      error: expect.objectContaining({ code: 'FORBIDDEN' }),
      status: 'rejected',
    });
    expect(rolesResult).toMatchObject({
      error: expect.objectContaining({ code: 'FORBIDDEN' }),
      status: 'rejected',
    });
  });

  it('lists RBAC roles and permission codes from server DB for platform admins', async () => {
    const db = createAdminCoreReadDb();
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('platform_admin'));

    await expect(caller.listRoles()).resolves.toEqual({
      items: [
        {
          description: 'Full access to the real admin console',
          id: 'role-admin',
          isActive: true,
          isSystem: true,
          name: 'Real Admin',
          permissions: ['admin:access', 'users:read'],
          workspaceId: null,
        },
        {
          description: 'Can review content operations',
          id: 'role-operator',
          isActive: true,
          isSystem: false,
          name: 'Content Operator',
          permissions: ['knowledge:read'],
          workspaceId: null,
        },
        {
          description: 'Temporarily disabled role',
          id: 'role-disabled-operator',
          isActive: false,
          isSystem: false,
          name: 'Disabled Operator',
          permissions: [],
          workspaceId: null,
        },
      ],
    });
    expect(db.query.roles.findMany).toHaveBeenCalled();
    const listRolesQuery = (db.query.roles.findMany as any).mock.calls[0]?.[0];

    expect(
      collectInspectableTokens(listRolesQuery?.where).join(' '),
    ).not.toContain('is_active');
    expect(db.query.rolePermissions.findMany).toHaveBeenCalled();
  });

  it('returns overview counts from server DB for platform admins', async () => {
    const db = createAdminCoreReadDb();
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('platform_admin'));

    await expect(caller.overview()).resolves.toEqual({
      knowledgeBases: 4,
      mcpConnectors: 0,
      users: 3,
      workspaces: 2,
    });
    expect(db.select).toHaveBeenCalledTimes(3);
  });

  it('exports enterprise organization schemas', async () => {
    const schemas = await import('@/database/schemas');

    expect(schemas.enterpriseDepartments).toBeDefined();
    expect(schemas.enterpriseDepartmentMembers).toBeDefined();
    expect(schemas.enterpriseUserProfiles).toBeDefined();
  });

  it('exports enterprise audit log schema', async () => {
    const schemas = await import('@/database/schemas');

    expect(schemas.enterpriseAuditLogs).toBeDefined();
  });

  it('lists enterprise audit logs from server DB for platform admins', async () => {
    const db = createAdminAuditDb();
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('platform_admin')) as any;

    await expect(caller.listAuditLogs({ page: 1, pageSize: 20 })).resolves.toEqual({
      items: [
        {
          action: 'org.department.upsert',
          actor: 'user-admin',
          id: 'audit-1',
          resource: 'department:dept-child-a',
          result: 'success',
          time: '2026-06-01T08:30:00.000Z',
        },
        {
          action: 'org.sync.run',
          actor: 'system',
          id: 'audit-2',
          resource: 'wecom_sync',
          result: 'failed',
          time: '2026-06-02T09:45:00.000Z',
        },
      ],
      total: 2,
    });
    expect(db.query.enterpriseAuditLogs.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 20,
        offset: 0,
      }),
    );
    expect(db.select).toHaveBeenCalled();
  });

  it('returns the enterprise department tree with direct member counts for platform admins', async () => {
    const db = createAdminOrgDb();
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('platform_admin')) as any;

    await expect(caller.org.departments.tree()).resolves.toEqual({
      items: [
        {
          children: [
            {
              children: [],
              externalDepartmentId: 'wx-child-a',
              id: 'dept-child-a',
              memberCount: 2,
              name: 'Engineering',
              parentId: 'dept-root',
              provider: 'wecom',
              status: 'active',
            },
            {
              children: [],
              externalDepartmentId: 'wx-child-b',
              id: 'dept-child-b',
              memberCount: 0,
              name: 'Sales',
              parentId: 'dept-root',
              provider: 'wecom',
              status: 'active',
            },
          ],
          externalDepartmentId: 'wx-root',
          id: 'dept-root',
          memberCount: 1,
          name: 'Headquarters',
          parentId: null,
          provider: 'wecom',
          status: 'active',
        },
      ],
    });
    expect(db.query.enterpriseDepartments.findMany).toHaveBeenCalled();
    expect(db.query.enterpriseDepartmentMembers.findMany).toHaveBeenCalled();
  });

  it('lists enterprise organization members for a department with profile and user fields', async () => {
    const db = createAdminOrgDb();
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('platform_admin')) as any;

    await expect(caller.org.members.list({ departmentId: 'dept-child-a' })).resolves.toEqual({
      items: [
        {
          departmentId: 'dept-child-a',
          email: 'lin@example.com',
          employeeNumber: 'E-003',
          employmentStatus: 'inactive',
          isPrimary: true,
          name: 'lin@example.com',
          position: 'Support Specialist',
          status: '\u6b63\u5e38',
          userId: 'user-lin',
        },
        {
          departmentId: 'dept-child-a',
          email: 'grace@example.com',
          employeeNumber: 'E-002',
          employmentStatus: 'active',
          isPrimary: false,
          name: 'grace',
          position: 'Operations Lead',
          status: '\u7981\u7528',
          userId: 'user-grace',
        },
      ],
      total: 2,
    });
    expect(db.query.enterpriseDepartmentMembers.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.anything(),
      }),
    );
    expect(db.query.enterpriseUserProfiles.findMany).toHaveBeenCalled();
    expect(db.query.users.findMany).toHaveBeenCalled();
  });

  it('upserts an enterprise department and writes an audit log for platform admins', async () => {
    const db = createAdminOrgWriteDb();
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('platform_admin')) as any;

    await expect(
      caller.org.departments.upsert({
        externalDepartmentId: 'wx-rd',
        name: '\u7814\u53d1\u4e2d\u5fc3',
        order: 20,
        parentId: null,
        provider: 'wecom',
        status: 'active',
      }),
    ).resolves.toEqual({
      externalDepartmentId: 'wx-rd',
      id: 'dept-rd',
      name: '\u7814\u53d1\u4e2d\u5fc3',
      order: 20,
      parentId: null,
      provider: 'wecom',
      status: 'active',
    });
    expect(db.auditValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'org.department.upsert',
          actorUserId: 'user-admin',
          targetId: 'dept-rd',
          targetType: 'department',
        }),
      ]),
    );
  });

  it('moves an enterprise member, updates primary department, and writes an audit log', async () => {
    const db = createAdminOrgWriteDb();
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('platform_admin')) as any;

    await expect(
      caller.org.members.move({
        departmentId: 'dept-child-b',
        isPrimary: true,
        userId: 'user-grace',
      }),
    ).resolves.toEqual({
      departmentId: 'dept-child-b',
      isPrimary: true,
      status: 'active',
      userId: 'user-grace',
    });
    expect(db.update).toHaveBeenCalled();
    expect(db.updateSet).toHaveBeenCalledWith({ primaryDepartmentId: 'dept-child-b' });
    expect(db.auditValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'org.member.move',
          actorUserId: 'user-admin',
          targetId: 'dept-child-b:user-grace',
          targetType: 'department_member',
        }),
      ]),
    );
  });

  it('runs WeCom directory snapshot sync from the enterprise organization API', async () => {
    const db = createAdminOrgWriteDb();
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    mockApplyEnterpriseDirectorySnapshot.mockResolvedValue({
      inactiveMembers: 1,
      status: 'completed',
      syncedDepartments: 2,
      syncedMembers: 1,
    });
    const caller = createCaller(await createAdminContext('platform_admin')) as any;
    const input = {
      missingMemberPolicy: 'mark_inactive' as const,
      provider: 'wecom' as const,
      snapshot: {
        departments: [
          { externalDepartmentId: '1', name: 'Headquarters', order: 1 },
          {
            externalDepartmentId: '2',
            name: 'Research',
            order: 2,
            parentExternalDepartmentId: '1',
          },
        ],
        members: [
          {
            departments: ['2'],
            employeeNumber: 'E1001',
            externalUserId: 'wecom-ada',
            name: 'Ada',
            position: 'Principal Engineer',
            userId: 'user-ada',
          },
        ],
      },
    };

    await expect(caller.org.sync.run(input)).resolves.toEqual({
      inactiveMembers: 1,
      status: 'completed',
      syncedDepartments: 2,
      syncedMembers: 1,
    });
    expect(mockApplyEnterpriseDirectorySnapshot).toHaveBeenCalledWith({
      actorUserId: 'user-admin',
      db,
      missingMemberPolicy: 'mark_inactive',
      provider: 'wecom',
      snapshot: input.snapshot,
    });
  });

  it('requires platform admin role for enterprise department tree', async () => {
    const ctx = {
      ...(await createContextInner({ userId: 'user-member' })),
      user: { id: 'user-member', role: 'user' },
    } as AuthContext;
    const caller = createCaller(ctx as never) as any;

    await expect(caller.org.departments.tree()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('requires platform admin role for enterprise department upsert', async () => {
    const ctx = {
      ...(await createContextInner({ userId: 'user-member' })),
      user: { id: 'user-member', role: 'user' },
    } as AuthContext;
    const caller = createCaller(ctx as never) as any;

    await expect(
      caller.org.departments.upsert({
        externalDepartmentId: 'wx-rd',
        name: '\u7814\u53d1\u4e2d\u5fc3',
        provider: 'wecom',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('lists knowledge bases with workspace labels for platform admins', async () => {
    const db = createKnowledgeDb();
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('platform_admin'));

    await expect(caller.listKnowledgeBases({ page: 1, pageSize: 20 })).resolves.toEqual({
      items: [
        {
          id: 'kb-1',
          name: '研发知识库',
          resources: 1,
          updatedAt: '2026-01-02T00:00:00.000Z',
          visibility: '工作区',
          workspace: '研发空间',
          workspaceId: 'workspace-1',
        },
      ],
      total: 1,
    });
  });

  it('lists and grants resource permissions for platform admins', async () => {
    const db = createAclDb();
    vi.mocked(getServerDB).mockResolvedValue(db as never);
    const caller = createCaller(await createAdminContext('platform_admin'));

    await expect(
      caller.listResourceGrants({ resourceId: 'kb-1', resourceType: 'knowledge_base' }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: 'acl-1',
          permission: 'read',
          principalId: 'user-member',
          principalType: 'user',
          resourceId: 'kb-1',
          resourceType: 'knowledge_base',
          workspaceId: 'workspace-1',
        }),
      ],
    });

    await expect(
      caller.grantResourcePermission({
        permission: 'write',
        principalId: 'user-2',
        principalType: 'user',
        resourceId: 'kb-1',
        resourceType: 'knowledge_base',
      }),
    ).resolves.toMatchObject({
      id: 'acl-2',
      permission: 'write',
      principalId: 'user-2',
      workspaceId: 'workspace-1',
    });
  });

  describe('fine-grained RBAC admin permissions', () => {
    it('allows RBAC users with only sso:manage to update WeCom SSO config', async () => {
      allowOnlyPermissions('sso:manage');
      const caller = createCaller(await createAdminContext('user'));

      const result = await settle(caller.updateSsoConfig(createWecomSsoUpdateInput()));

      expectPermissionCheck('sso:manage');
      expect(result).toMatchObject({
        status: 'fulfilled',
        value: {
          config: expect.objectContaining({
            agentId: '1000002',
            corpId: 'ww-corp',
            enabled: true,
          }),
          corpSecretConfigured: true,
          provider: 'wecom',
        },
      });
    });

    it('denies RBAC users with only admin:access from updating WeCom SSO config', async () => {
      allowOnlyPermissions('admin:access');
      const caller = createCaller(await createAdminContext('user'));

      const result = await settle(caller.updateSsoConfig(createWecomSsoUpdateInput()));

      expectPermissionCheck('sso:manage');
      expect(result).toMatchObject({
        error: expect.objectContaining({ code: 'FORBIDDEN' }),
        status: 'rejected',
      });
      expect(mockUpsertWecomSsoConfig).not.toHaveBeenCalled();
    });

    it('allows RBAC users with only audit:read to list audit logs', async () => {
      allowOnlyPermissions('audit:read');
      const db = createAdminAuditDb();
      vi.mocked(getServerDB).mockResolvedValue(db as never);
      const caller = createCaller(await createAdminContext('user')) as any;

      const result = await settle(caller.listAuditLogs({ page: 1, pageSize: 20 }));

      expectPermissionCheck('audit:read');
      expect(result).toMatchObject({
        status: 'fulfilled',
        value: {
          items: [
            expect.objectContaining({
              action: 'org.department.upsert',
              id: 'audit-1',
            }),
            expect.objectContaining({
              action: 'org.sync.run',
              id: 'audit-2',
            }),
          ],
          total: 2,
        },
      });
    });

    it('allows RBAC users with only org:manage to upsert enterprise departments', async () => {
      allowOnlyPermissions('org:manage');
      const db = createAdminOrgWriteDb();
      vi.mocked(getServerDB).mockResolvedValue(db as never);
      const caller = createCaller(await createAdminContext('user')) as any;

      const result = await settle(
        caller.org.departments.upsert({
          externalDepartmentId: 'wx-rd',
          name: '\u7814\u53d1\u4e2d\u5fc3',
          order: 20,
          parentId: null,
          provider: 'wecom',
          status: 'active',
        }),
      );

      expectPermissionCheck('org:manage');
      expect(result).toMatchObject({
        status: 'fulfilled',
        value: {
          externalDepartmentId: 'wx-rd',
          id: 'dept-rd',
          name: '\u7814\u53d1\u4e2d\u5fc3',
          provider: 'wecom',
        },
      });
    });

    it('allows RBAC users with only org:manage to run WeCom directory sync', async () => {
      allowOnlyPermissions('org:manage');
      const db = createAdminOrgWriteDb();
      vi.mocked(getServerDB).mockResolvedValue(db as never);
      mockApplyEnterpriseDirectorySnapshot.mockResolvedValue({
        inactiveMembers: 0,
        status: 'completed',
        syncedDepartments: 1,
        syncedMembers: 0,
      });
      const caller = createCaller(await createAdminContext('user')) as any;

      const result = await settle(
        caller.org.sync.run({
          provider: 'wecom',
          snapshot: {
            departments: [{ externalDepartmentId: '1', name: 'Headquarters' }],
            members: [],
          },
        }),
      );

      expectPermissionCheck('org:manage');
      expect(result).toMatchObject({
        status: 'fulfilled',
        value: {
          inactiveMembers: 0,
          status: 'completed',
          syncedDepartments: 1,
          syncedMembers: 0,
        },
      });
      expect(mockApplyEnterpriseDirectorySnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'user-admin',
          db,
          missingMemberPolicy: 'ignore',
          provider: 'wecom',
        }),
      );
    });

    it('allows RBAC users with only user:manage to list users', async () => {
      allowOnlyPermissions('user:manage');
      const db = createAdminCoreReadDb();
      vi.mocked(getServerDB).mockResolvedValue(db as never);
      const caller = createCaller(await createAdminContext('user'));

      const result = await settle(caller.listUsers({ page: 1, pageSize: 20 }));

      expectPermissionCheck('user:manage');
      expect(result).toMatchObject({
        status: 'fulfilled',
        value: {
          items: [
            expect.objectContaining({
              id: 'user-ada',
              role: 'platform_admin',
            }),
            expect.objectContaining({
              id: 'user-grace',
              role: 'user',
            }),
            expect.objectContaining({
              id: 'user-id-fallback',
              role: 'user',
            }),
          ],
          total: 3,
        },
      });
    });

    it('allows RBAC users with only role:manage to list roles', async () => {
      allowOnlyPermissions('role:manage');
      const db = createAdminCoreReadDb();
      vi.mocked(getServerDB).mockResolvedValue(db as never);
      const caller = createCaller(await createAdminContext('user'));

      const result = await settle(caller.listRoles());

      expectPermissionCheck('role:manage');
      expect(result).toMatchObject({
        status: 'fulfilled',
        value: {
          items: [
            expect.objectContaining({
              id: 'role-admin',
              permissions: ['admin:access', 'users:read'],
            }),
            expect.objectContaining({
              id: 'role-operator',
              permissions: ['knowledge:read'],
            }),
            expect.objectContaining({
              id: 'role-disabled-operator',
              isActive: false,
              isSystem: false,
              permissions: [],
              workspaceId: null,
            }),
          ],
        },
      });
    });

    it('allows RBAC users with only knowledge:manage to list and grant knowledge base permissions', async () => {
      allowOnlyPermissions('knowledge:manage');
      const db = createAclDb();
      vi.mocked(getServerDB).mockResolvedValue(db as never);
      const caller = createCaller(await createAdminContext('user'));

      const listResult = await settle(
        caller.listResourceGrants({ resourceId: 'kb-1', resourceType: 'knowledge_base' }),
      );
      const grantResult = await settle(
        caller.grantResourcePermission({
          permission: 'write',
          principalId: 'user-2',
          principalType: 'user',
          resourceId: 'kb-1',
          resourceType: 'knowledge_base',
        }),
      );

      expectPermissionCheck('knowledge:manage');
      expect(listResult).toMatchObject({
        status: 'fulfilled',
        value: {
          items: [
            expect.objectContaining({
              id: 'acl-1',
              resourceId: 'kb-1',
              resourceType: 'knowledge_base',
            }),
          ],
        },
      });
      expect(grantResult).toMatchObject({
        status: 'fulfilled',
        value: {
          id: 'acl-2',
          permission: 'write',
          principalId: 'user-2',
          resourceId: 'kb-1',
          resourceType: 'knowledge_base',
          workspaceId: 'workspace-1',
        },
      });
    });

    it('denies knowledge managers from listing or granting skill or connector permissions', async () => {
      allowOnlyPermissions('knowledge:manage');
      const db = createAclDb();
      vi.mocked(getServerDB).mockResolvedValue(db as never);
      const caller = createCaller(await createAdminContext('user'));

      const skillListResult = await settle(
        caller.listResourceGrants({ resourceId: 'skill-1', resourceType: 'skill' }),
      );
      const skillResult = await settle(
        caller.grantResourcePermission({
          permission: 'write',
          principalId: 'user-2',
          principalType: 'user',
          resourceId: 'skill-1',
          resourceType: 'skill',
        }),
      );
      const connectorListResult = await settle(
        caller.listResourceGrants({ resourceId: 'connector-1', resourceType: 'connector' }),
      );
      const connectorResult = await settle(
        caller.grantResourcePermission({
          permission: 'write',
          principalId: 'user-2',
          principalType: 'user',
          resourceId: 'connector-1',
          resourceType: 'connector',
        }),
      );

      expectPermissionCheck('skill:manage');
      expectPermissionCheck('mcp:manage');
      expect(skillResult).toMatchObject({
        error: expect.objectContaining({ code: 'FORBIDDEN' }),
        status: 'rejected',
      });
      expect(skillListResult).toMatchObject({
        error: expect.objectContaining({ code: 'FORBIDDEN' }),
        status: 'rejected',
      });
      expect(connectorResult).toMatchObject({
        error: expect.objectContaining({ code: 'FORBIDDEN' }),
        status: 'rejected',
      });
      expect(connectorListResult).toMatchObject({
        error: expect.objectContaining({ code: 'FORBIDDEN' }),
        status: 'rejected',
      });
    });

    it('allows RBAC users with only skill:manage to list and grant skill permissions', async () => {
      allowOnlyPermissions('skill:manage');
      const db = createAclDb();
      vi.mocked(getServerDB).mockResolvedValue(db as never);
      const caller = createCaller(await createAdminContext('user'));

      const listResult = await settle(
        caller.listResourceGrants({ resourceId: 'skill-1', resourceType: 'skill' }),
      );
      const grantResult = await settle(
        caller.grantResourcePermission({
          permission: 'write',
          principalId: 'user-2',
          principalType: 'user',
          resourceId: 'skill-1',
          resourceType: 'skill',
        }),
      );

      expectPermissionCheck('skill:manage');
      expect(listResult).toMatchObject({
        status: 'fulfilled',
        value: {
          items: [
            expect.objectContaining({
              id: 'acl-skill',
              resourceId: 'skill-1',
              resourceType: 'skill',
            }),
          ],
        },
      });
      expect(grantResult).toMatchObject({
        status: 'fulfilled',
        value: {
          id: 'acl-2',
          principalId: 'user-2',
          resourceId: 'skill-1',
          resourceType: 'skill',
          workspaceId: 'workspace-1',
        },
      });
    });

    it('allows RBAC users with only mcp:manage to list and grant connector permissions', async () => {
      allowOnlyPermissions('mcp:manage');
      const db = createAclDb();
      vi.mocked(getServerDB).mockResolvedValue(db as never);
      const caller = createCaller(await createAdminContext('user'));

      const listResult = await settle(
        caller.listResourceGrants({ resourceId: 'connector-1', resourceType: 'connector' }),
      );
      const grantResult = await settle(
        caller.grantResourcePermission({
          permission: 'write',
          principalId: 'user-2',
          principalType: 'user',
          resourceId: 'connector-1',
          resourceType: 'connector',
        }),
      );

      expectPermissionCheck('mcp:manage');
      expect(listResult).toMatchObject({
        status: 'fulfilled',
        value: {
          items: [
            expect.objectContaining({
              id: 'acl-connector',
              resourceId: 'connector-1',
              resourceType: 'connector',
            }),
          ],
        },
      });
      expect(grantResult).toMatchObject({
        status: 'fulfilled',
        value: {
          id: 'acl-2',
          principalId: 'user-2',
          resourceId: 'connector-1',
          resourceType: 'connector',
          workspaceId: 'workspace-1',
        },
      });
    });
  });

  it('rejects invalid SSO update input before calling the service', async () => {
    const caller = createCaller(await createAdminContext('platform_admin'));

    await expect(
      caller.updateSsoConfig({
        config: {
          enabled: false,
        },
        provider: 'wechat',
      } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await expect(
      caller.updateSsoConfig({
        config: {
          enabled: false,
          redirectUri: 'not-a-url',
        },
        provider: 'wecom',
      } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(mockUpsertWecomSsoConfig).not.toHaveBeenCalled();
  });

  it('requires platform admin role for admin console read APIs', async () => {
    const ctx = {
      ...(await createContextInner({ userId: 'user-member' })),
      user: { id: 'user-member', role: 'user' },
    } as AuthContext;
    const caller = createCaller(ctx as never);

    await expect(caller.listAuditLogs({ page: 1, pageSize: 20 })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('denies production userId-only context when database role is not platform admin', async () => {
    vi.mocked(UserModel.findById).mockResolvedValue({
      id: 'user-member',
      role: 'user',
    } as never);
    const caller = createCaller(await createContextInner({ userId: 'user-member' }));

    await expect(caller.me()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('denies logged-in non-admin users from context role', async () => {
    const ctx = {
      ...(await createContextInner({ userId: 'user-member' })),
      user: { id: 'user-member', role: 'user' },
    } as AuthContext;
    const caller = createCaller(ctx as never);

    await expect(caller.me()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mockHasAnyPermission.mock.calls[0]?.[0]).toEqual(['admin:access']);
  });

  it('denies empty unauthenticated context', async () => {
    const caller = createCaller(await createContextInner());

    await expect(caller.me()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});
