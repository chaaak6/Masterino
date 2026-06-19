// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  enterpriseAuditLogs,
  enterpriseDepartmentMembers,
  enterpriseDepartments,
  enterpriseUserProfiles,
} from '@/database/schemas';

import { applyEnterpriseDirectorySnapshot } from './directorySyncService';

type DepartmentRow = {
  externalDepartmentId: string;
  id: string;
  name: string;
  order?: number;
  parentId?: null | string;
  provider: string;
  rawProfile?: Record<string, unknown>;
  status?: string;
};

type MembershipRow = {
  departmentId: string;
  isPrimary?: boolean;
  status?: string;
  userId: string;
};

type ProfileRow = {
  employeeNumber?: null | string;
  employmentStatus?: string;
  externalUserId?: string;
  position?: null | string;
  primaryDepartmentId?: null | string;
  provider?: string;
  rawProfile?: Record<string, unknown>;
  userId: string;
};

type DbOperation = {
  conflict?: {
    set?: Record<string, unknown>;
    target?: unknown;
  };
  setValues?: Record<string, unknown>;
  table: unknown;
  type: 'insert' | 'update';
  values?: unknown;
  whereCalled?: boolean;
};

type DirectorySyncDbOptions = {
  departments?: DepartmentRow[];
  existingMembers?: MembershipRow[];
  failAudit?: boolean;
  profiles?: ProfileRow[];
};

const getRows = (values: unknown) => (Array.isArray(values) ? values : values ? [values] : []);

const createDirectorySyncDb = (options: DirectorySyncDbOptions = {}) => {
  const operations: DbOperation[] = [];
  const departments = new Map<string, DepartmentRow>();
  const memberships = new Map<string, MembershipRow>();
  const profiles = new Map<string, ProfileRow>();

  for (const department of options.departments ?? []) {
    departments.set(`${department.provider}:${department.externalDepartmentId}`, department);
  }

  for (const member of options.existingMembers ?? []) {
    memberships.set(`${member.departmentId}:${member.userId}`, {
      isPrimary: false,
      status: 'active',
      ...member,
    });
  }

  for (const profile of options.profiles ?? []) {
    profiles.set(profile.userId, profile);
  }

  const upsertedDepartments: Record<string, unknown>[] = [];
  const upsertedMembers: Record<string, unknown>[] = [];
  const updatedProfiles: Record<string, unknown>[] = [];
  const updatedMemberships: Record<string, unknown>[] = [];
  const auditEvents: Record<string, unknown>[] = [];

  const insert = vi.fn((table: unknown) => {
    const operation: DbOperation = { table, type: 'insert' };
    operations.push(operation);

    const chain = {
      onConflictDoUpdate: vi.fn((conflict: DbOperation['conflict']) => {
        operation.conflict = conflict;
        return chain;
      }),
      returning: vi.fn(async () => {
        const rows = getRows(operation.values) as Record<string, unknown>[];

        if (table === enterpriseDepartments) {
          return rows.map((row) => {
            const key = `${row.provider}:${row.externalDepartmentId}`;
            const existing = departments.get(key);
            const stored = {
              ...existing,
              ...row,
              id: existing?.id ?? `dept-${row.externalDepartmentId}`,
            } as DepartmentRow;

            departments.set(key, stored);
            upsertedDepartments.push(row);

            return stored;
          });
        }

        if (table === enterpriseDepartmentMembers) {
          return rows.map((row) => {
            const key = `${row.departmentId}:${row.userId}`;
            const stored = {
              ...memberships.get(key),
              ...row,
            } as MembershipRow;

            memberships.set(key, stored);
            upsertedMembers.push(row);

            return stored;
          });
        }

        if (table === enterpriseUserProfiles) {
          return rows.map((row) => {
            const stored = {
              ...profiles.get(String(row.userId)),
              ...row,
            } as ProfileRow;

            profiles.set(stored.userId, stored);
            updatedProfiles.push(row);

            return stored;
          });
        }

        if (table === enterpriseAuditLogs) {
          auditEvents.push(...rows);
          if (options.failAudit) {
            throw new Error('Audit insert failed');
          }

          return rows.map((row, index) => ({ id: `audit-${index}`, ...row }));
        }

        return rows;
      }),
      values: vi.fn((values: unknown) => {
        operation.values = values;
        return chain;
      }),
    };

    return chain;
  });

  const update = vi.fn((table: unknown) => {
    const operation: DbOperation = { table, type: 'update' };
    operations.push(operation);

    const chain = {
      set: vi.fn((values: Record<string, unknown>) => {
        operation.setValues = values;
        return chain;
      }),
      where: vi.fn(() => {
        operation.whereCalled = true;

        if (table === enterpriseDepartments && operation.setValues?.parentId !== undefined) {
          const target = Array.from(departments.values()).find(
            (department) => department.provider === 'wecom' && department.externalDepartmentId === '2',
          );
          if (target) target.parentId = operation.setValues.parentId as null | string;
        }

        if (table === enterpriseDepartmentMembers) {
          updatedMemberships.push(operation.setValues ?? {});
        }

        if (table === enterpriseUserProfiles) {
          updatedProfiles.push(operation.setValues ?? {});
        }

        return chain;
      }),
    };

    return chain;
  });

  return {
    auditEvents,
    db: {
      insert,
      query: {
        enterpriseDepartmentMembers: {
          findMany: vi.fn(async () => Array.from(memberships.values())),
        },
        enterpriseDepartments: {
          findMany: vi.fn(async () => Array.from(departments.values())),
        },
      },
      update,
    },
    departments,
    memberships,
    operations,
    profiles,
    updatedMemberships,
    updatedProfiles,
    upsertedDepartments,
    upsertedMembers,
  };
};

const findInsert = (operations: DbOperation[], table: unknown) => {
  const operation = operations.find((item) => item.type === 'insert' && item.table === table);

  expect(operation).toBeDefined();

  return operation as DbOperation;
};

const findUpdates = (operations: DbOperation[], table: unknown) =>
  operations.filter((item) => item.type === 'update' && item.table === table);

describe('applyEnterpriseDirectorySnapshot', () => {
  it('upserts WeCom departments with parent relationships idempotently', async () => {
    const db = createDirectorySyncDb();

    const snapshot = {
      departments: [
        { externalDepartmentId: '1', name: 'Headquarters', order: 1 },
        {
          externalDepartmentId: '2',
          name: 'Research',
          order: 2,
          parentExternalDepartmentId: '1',
        },
      ],
      members: [],
    };

    await applyEnterpriseDirectorySnapshot({
      actorUserId: 'admin-user',
      db: db.db,
      provider: 'wecom',
      snapshot,
    });

    const result = await applyEnterpriseDirectorySnapshot({
      actorUserId: 'admin-user',
      db: db.db,
      provider: 'wecom',
      snapshot,
    });

    expect(result).toMatchObject({
      inactiveMembers: 0,
      status: 'completed',
      syncedDepartments: 2,
      syncedMembers: 0,
    });
    expect(db.upsertedDepartments).toHaveLength(4);
    expect(db.upsertedDepartments.at(-1)).toMatchObject({
      externalDepartmentId: '2',
      provider: 'wecom',
      rawProfile: expect.objectContaining({
        parentExternalDepartmentId: '1',
      }),
    });

    const departmentInsert = findInsert(db.operations, enterpriseDepartments);
    expect(departmentInsert.conflict).toMatchObject({
      set: expect.objectContaining({
        name: expect.any(String),
        status: 'active',
      }),
      target: [enterpriseDepartments.provider, enterpriseDepartments.externalDepartmentId],
    });

    const parentUpdates = findUpdates(db.operations, enterpriseDepartments);
    expect(parentUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          setValues: expect.objectContaining({ parentId: 'dept-1' }),
          whereCalled: true,
        }),
      ]),
    );
    expect(db.departments.get('wecom:2')).toMatchObject({ parentId: 'dept-1' });
  });

  it('syncs members, primary departments, and profiles', async () => {
    const db = createDirectorySyncDb();

    const result = await applyEnterpriseDirectorySnapshot({
      actorUserId: 'admin-user',
      db: db.db,
      provider: 'wecom',
      snapshot: {
        departments: [
          { externalDepartmentId: '1', name: 'Headquarters' },
          { externalDepartmentId: '2', name: 'Research', parentExternalDepartmentId: '1' },
        ],
        members: [
          {
            departments: ['1', '2'],
            employeeNumber: 'E1001',
            externalUserId: 'wecom-ada',
            name: 'Ada',
            position: 'Principal Engineer',
            primaryDepartmentExternalId: '2',
            userId: 'user-ada',
          },
        ],
      },
    });

    expect(result).toMatchObject({
      inactiveMembers: 0,
      status: 'completed',
      syncedDepartments: 2,
      syncedMembers: 1,
    });
    expect(db.upsertedMembers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          departmentId: 'dept-2',
          isPrimary: true,
          status: 'active',
          userId: 'user-ada',
        }),
        expect.objectContaining({
          departmentId: 'dept-1',
          isPrimary: false,
          status: 'active',
          userId: 'user-ada',
        }),
      ]),
    );
    expect(db.updatedProfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          employeeNumber: 'E1001',
          employmentStatus: 'active',
          externalUserId: 'wecom-ada',
          lastSyncedAt: expect.any(Date),
          position: 'Principal Engineer',
          primaryDepartmentId: 'dept-2',
          provider: 'wecom',
          rawProfile: expect.objectContaining({
            departments: ['1', '2'],
            externalUserId: 'wecom-ada',
          }),
          userId: 'user-ada',
        }),
      ]),
    );

    const memberInsert = findInsert(db.operations, enterpriseDepartmentMembers);
    expect(memberInsert.conflict).toMatchObject({
      set: expect.objectContaining({
        isPrimary: expect.anything(),
        status: 'active',
      }),
      target: [enterpriseDepartmentMembers.departmentId, enterpriseDepartmentMembers.userId],
    });

    const profileInsert = findInsert(db.operations, enterpriseUserProfiles);
    expect(profileInsert.conflict).toMatchObject({
      set: expect.objectContaining({
        employmentStatus: 'active',
        lastSyncedAt: expect.any(Date),
        primaryDepartmentId: 'dept-2',
      }),
      target: enterpriseUserProfiles.userId,
    });
  });

  it('uses departments[0] as the primary department fallback and marks missing active members inactive', async () => {
    const db = createDirectorySyncDb({
      departments: [
        {
          externalDepartmentId: 'old',
          id: 'dept-old',
          name: 'Old Department',
          provider: 'wecom',
        },
      ],
      existingMembers: [{ departmentId: 'dept-old', userId: 'user-leaver' }],
      profiles: [{ employmentStatus: 'active', userId: 'user-leaver' }],
    });

    const result = await applyEnterpriseDirectorySnapshot({
      actorUserId: 'admin-user',
      db: db.db,
      missingMemberPolicy: 'mark_inactive',
      provider: 'wecom',
      snapshot: {
        departments: [{ externalDepartmentId: '2', name: 'Research' }],
        members: [
          {
            departments: ['2'],
            employeeNumber: 'E1001',
            externalUserId: 'wecom-ada',
            name: 'Ada',
            userId: 'user-ada',
          },
        ],
      },
    });

    expect(result).toMatchObject({
      inactiveMembers: 1,
      status: 'completed',
      syncedDepartments: 1,
      syncedMembers: 1,
    });
    expect(db.updatedProfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ employmentStatus: 'inactive' }),
        expect.objectContaining({
          employmentStatus: 'active',
          primaryDepartmentId: 'dept-2',
          userId: 'user-ada',
        }),
      ]),
    );
    expect(db.updatedMemberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'inactive',
        }),
      ]),
    );

    const profileUpdates = findUpdates(db.operations, enterpriseUserProfiles);
    expect(profileUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          setValues: expect.objectContaining({ employmentStatus: 'inactive' }),
          whereCalled: true,
        }),
      ]),
    );
    const membershipUpdates = findUpdates(db.operations, enterpriseDepartmentMembers);
    expect(membershipUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          setValues: expect.objectContaining({ status: 'inactive' }),
          whereCalled: true,
        }),
      ]),
    );
  });

  it('keeps sync completed when audit writes fail', async () => {
    const db = createDirectorySyncDb({ failAudit: true });

    await expect(
      applyEnterpriseDirectorySnapshot({
        actorUserId: 'admin-user',
        db: db.db,
        provider: 'wecom',
        snapshot: { departments: [], members: [] },
      }),
    ).resolves.toMatchObject({
      inactiveMembers: 0,
      status: 'completed',
      syncedDepartments: 0,
      syncedMembers: 0,
    });

    expect(db.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'directory.sync.completed',
          actorUserId: 'admin-user',
          result: 'success',
          targetType: 'directory',
        }),
      ]),
    );
  });

  it('writes a failed audit event before rethrowing sync errors', async () => {
    const db = createDirectorySyncDb();
    db.db.insert.mockImplementationOnce(() => {
      throw new Error('Department write failed');
    });

    await expect(
      applyEnterpriseDirectorySnapshot({
        actorUserId: 'admin-user',
        db: db.db,
        provider: 'wecom',
        snapshot: {
          departments: [{ externalDepartmentId: '1', name: 'Headquarters' }],
          members: [],
        },
      }),
    ).rejects.toThrow('Department write failed');

    expect(db.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'directory.sync.failed',
          actorUserId: 'admin-user',
          metadata: expect.objectContaining({ error: 'Department write failed' }),
          result: 'failed',
          targetType: 'directory',
        }),
      ]),
    );
  });
});
