import { and, eq, inArray, sql } from 'drizzle-orm';

import {
  enterpriseAuditLogs,
  enterpriseDepartmentMembers,
  enterpriseDepartments,
  enterpriseUserProfiles,
} from '@/database/schemas';

export type DirectoryDepartmentSnapshot = {
  externalDepartmentId: string;
  name: string;
  order?: number;
  parentExternalDepartmentId?: string;
};

export type DirectoryMemberSnapshot = {
  departments: string[];
  employeeNumber: string;
  externalUserId: string;
  name: string;
  position?: string;
  primaryDepartmentExternalId?: string;
  userId: string;
};

export type DirectorySnapshot = {
  departments: DirectoryDepartmentSnapshot[];
  members: DirectoryMemberSnapshot[];
};

type DirectorySyncInput = {
  actorUserId?: string;
  db: DbLike;
  missingMemberPolicy?: 'ignore' | 'mark_inactive';
  provider: 'wecom';
  snapshot: DirectorySnapshot;
};

type DirectorySyncSummary = {
  inactiveMembers: number;
  status: 'completed';
  syncedDepartments: number;
  syncedMembers: number;
};

type DbLike = {
  insert: (table: unknown) => any;
  query?: {
    enterpriseDepartmentMembers?: {
      findMany?: (args?: unknown) => Promise<EnterpriseDepartmentMemberRow[]>;
    };
    enterpriseDepartments?: {
      findMany?: (args?: unknown) => Promise<EnterpriseDepartmentRow[]>;
    };
  };
  update: (table: unknown) => any;
};

type EnterpriseDepartmentRow = {
  externalDepartmentId: string;
  id: string;
  provider: string;
};

type EnterpriseDepartmentMemberRow = {
  departmentId: string;
  status?: null | string;
  userId: string;
};

const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const unique = <T>(items: T[]) => Array.from(new Set(items));

const createDepartmentRawProfile = (
  provider: 'wecom',
  department: DirectoryDepartmentSnapshot,
) => ({
  externalDepartmentId: department.externalDepartmentId,
  name: department.name,
  order: department.order ?? 0,
  parentExternalDepartmentId: department.parentExternalDepartmentId ?? null,
  provider,
});

const createMemberRawProfile = (member: DirectoryMemberSnapshot) => ({
  departments: member.departments,
  employeeNumber: member.employeeNumber,
  externalUserId: member.externalUserId,
  name: member.name,
  position: member.position ?? null,
  primaryDepartmentExternalId: member.primaryDepartmentExternalId ?? member.departments[0] ?? null,
  userId: member.userId,
});

const returningOrEmpty = async <T>(chain: any): Promise<T[]> => {
  if (chain && typeof chain.returning === 'function') {
    return chain.returning();
  }

  await chain;

  return [];
};

const applyWhere = async (chain: any, where: unknown) => {
  if (chain && typeof chain.where === 'function') {
    await chain.where(where);
    return;
  }

  await chain;
};

const upsertDepartments = async (
  db: DbLike,
  provider: 'wecom',
  departments: DirectoryDepartmentSnapshot[],
) => {
  const departmentByExternalId = new Map<string, EnterpriseDepartmentRow>();

  for (const department of departments) {
    const rawProfile = createDepartmentRawProfile(provider, department);
    const values = {
      externalDepartmentId: department.externalDepartmentId,
      name: department.name,
      order: department.order ?? 0,
      parentId: null,
      provider,
      rawProfile,
      status: 'active',
    };

    const [row] = await returningOrEmpty<EnterpriseDepartmentRow>(
      db
        .insert(enterpriseDepartments)
        .values(values)
        .onConflictDoUpdate({
          set: {
            name: department.name,
            order: department.order ?? 0,
            rawProfile,
            status: 'active',
          },
          target: [enterpriseDepartments.provider, enterpriseDepartments.externalDepartmentId],
        }),
    );

    if (row) {
      departmentByExternalId.set(row.externalDepartmentId, row);
    }
  }

  const departmentExternalIds = unique(
    departments.flatMap((department) => [
      department.externalDepartmentId,
      ...(department.parentExternalDepartmentId ? [department.parentExternalDepartmentId] : []),
    ]),
  );

  if (
    departmentExternalIds.length > 0 &&
    typeof db.query?.enterpriseDepartments?.findMany === 'function'
  ) {
    const rows = await db.query.enterpriseDepartments.findMany({
      where: and(
        eq(enterpriseDepartments.provider, provider),
        inArray(enterpriseDepartments.externalDepartmentId, departmentExternalIds),
      ),
    });

    for (const row of rows) {
      if (row.provider === provider) {
        departmentByExternalId.set(row.externalDepartmentId, row);
      }
    }
  }

  for (const department of departments) {
    const parentId = department.parentExternalDepartmentId
      ? (departmentByExternalId.get(department.parentExternalDepartmentId)?.id ?? null)
      : null;

    await applyWhere(
      db.update(enterpriseDepartments).set({ parentId }),
      and(
        eq(enterpriseDepartments.provider, provider),
        eq(enterpriseDepartments.externalDepartmentId, department.externalDepartmentId),
      ),
    );
  }

  return departmentByExternalId;
};

const syncMembers = async (
  db: DbLike,
  provider: 'wecom',
  members: DirectoryMemberSnapshot[],
  departmentByExternalId: Map<string, EnterpriseDepartmentRow>,
  lastSyncedAt: Date,
) => {
  const activeMembershipKeys = new Set<string>();
  const activeUserIds = new Set<string>();

  for (const member of members) {
    const primaryDepartmentExternalId = member.primaryDepartmentExternalId ?? member.departments[0];
    const primaryDepartment = primaryDepartmentExternalId
      ? departmentByExternalId.get(primaryDepartmentExternalId)
      : undefined;
    const rawProfile = createMemberRawProfile(member);
    const profileValues = {
      employeeNumber: member.employeeNumber,
      employmentStatus: 'active',
      externalUserId: member.externalUserId,
      lastSyncedAt,
      position: member.position ?? null,
      primaryDepartmentId: primaryDepartment?.id ?? null,
      provider,
      rawProfile,
      userId: member.userId,
    };

    await returningOrEmpty(
      db
        .insert(enterpriseUserProfiles)
        .values(profileValues)
        .onConflictDoUpdate({
          set: {
            employeeNumber: member.employeeNumber,
            employmentStatus: 'active',
            externalUserId: member.externalUserId,
            lastSyncedAt,
            position: member.position ?? null,
            primaryDepartmentId: primaryDepartment?.id ?? null,
            provider,
            rawProfile,
          },
          target: enterpriseUserProfiles.userId,
        }),
    );

    activeUserIds.add(member.userId);

    const membershipValues = unique(member.departments)
      .map((externalDepartmentId) => {
        const department = departmentByExternalId.get(externalDepartmentId);

        if (!department) return;

        return {
          departmentId: department.id,
          isPrimary: externalDepartmentId === primaryDepartmentExternalId,
          status: 'active',
          userId: member.userId,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    for (const membership of membershipValues) {
      activeMembershipKeys.add(`${membership.departmentId}:${membership.userId}`);
    }

    if (membershipValues.length > 0) {
      await returningOrEmpty(
        db
          .insert(enterpriseDepartmentMembers)
          .values(membershipValues)
          .onConflictDoUpdate({
            set: {
              isPrimary: sql`excluded.is_primary`,
              status: 'active',
            },
            target: [
              enterpriseDepartmentMembers.departmentId,
              enterpriseDepartmentMembers.userId,
            ],
          }),
      );
    }
  }

  return { activeMembershipKeys, activeUserIds };
};

const markInactiveMembers = async (
  db: DbLike,
  activeMembershipKeys: Set<string>,
  activeUserIds: Set<string>,
  lastSyncedAt: Date,
) => {
  const existingMembers =
    typeof db.query?.enterpriseDepartmentMembers?.findMany === 'function'
      ? await db.query.enterpriseDepartmentMembers.findMany({
          where: eq(enterpriseDepartmentMembers.status, 'active'),
        })
      : [];
  const inactiveProfileUserIds = new Set<string>();
  let inactiveMembers = 0;

  for (const member of existingMembers) {
    const key = `${member.departmentId}:${member.userId}`;

    if (member.status === 'inactive' || activeMembershipKeys.has(key)) continue;

    await applyWhere(
      db.update(enterpriseDepartmentMembers).set({ status: 'inactive' }),
      and(
        eq(enterpriseDepartmentMembers.departmentId, member.departmentId),
        eq(enterpriseDepartmentMembers.userId, member.userId),
        eq(enterpriseDepartmentMembers.status, 'active'),
      ),
    );
    inactiveMembers += 1;

    if (!activeUserIds.has(member.userId)) {
      inactiveProfileUserIds.add(member.userId);
    }
  }

  for (const userId of inactiveProfileUserIds) {
    await applyWhere(
      db
        .update(enterpriseUserProfiles)
        .set({ employmentStatus: 'inactive', lastSyncedAt }),
      eq(enterpriseUserProfiles.userId, userId),
    );
  }

  return inactiveMembers;
};

const writeAuditLog = async (
  db: DbLike,
  input: {
    action: 'directory.sync.completed' | 'directory.sync.failed';
    actorUserId?: string;
    metadata: Record<string, unknown>;
    provider: 'wecom';
    result: 'failed' | 'success';
  },
) => {
  await returningOrEmpty(
    db.insert(enterpriseAuditLogs).values({
      action: input.action,
      actorUserId: input.actorUserId ?? null,
      metadata: input.metadata,
      result: input.result,
      targetId: input.provider,
      targetType: 'directory',
    }),
  );
};

const writeAuditLogBestEffort = async (
  db: DbLike,
  input: {
    action: 'directory.sync.completed' | 'directory.sync.failed';
    actorUserId?: string;
    metadata: Record<string, unknown>;
    provider: 'wecom';
    result: 'failed' | 'success';
  },
) => {
  try {
    await writeAuditLog(db, input);
  } catch {}
};

export async function applyEnterpriseDirectorySnapshot(
  input: DirectorySyncInput,
): Promise<DirectorySyncSummary> {
  const lastSyncedAt = new Date();

  try {
    const departmentByExternalId = await upsertDepartments(
      input.db,
      input.provider,
      input.snapshot.departments,
    );
    const { activeMembershipKeys, activeUserIds } = await syncMembers(
      input.db,
      input.provider,
      input.snapshot.members,
      departmentByExternalId,
      lastSyncedAt,
    );
    const inactiveMembers =
      input.missingMemberPolicy === 'mark_inactive'
        ? await markInactiveMembers(input.db, activeMembershipKeys, activeUserIds, lastSyncedAt)
        : 0;
    const summary: DirectorySyncSummary = {
      inactiveMembers,
      status: 'completed',
      syncedDepartments: input.snapshot.departments.length,
      syncedMembers: input.snapshot.members.length,
    };

    await writeAuditLogBestEffort(input.db, {
      action: 'directory.sync.completed',
      actorUserId: input.actorUserId,
      metadata: {
        inactiveMembers,
        provider: input.provider,
        syncedDepartments: input.snapshot.departments.length,
        syncedMembers: input.snapshot.members.length,
      },
      provider: input.provider,
      result: 'success',
    });

    return summary;
  } catch (error) {
    await writeAuditLogBestEffort(input.db, {
      action: 'directory.sync.failed',
      actorUserId: input.actorUserId,
      metadata: {
        error: getErrorMessage(error),
        provider: input.provider,
      },
      provider: input.provider,
      result: 'failed',
    });

    throw error;
  }
}
