import { and, eq, inArray } from 'drizzle-orm';

import {
  enterpriseAuditLogs,
  enterpriseDepartmentMembers,
  enterpriseDepartments,
  enterpriseUserProfiles,
  externalIdentities,
  newApiBindings,
  type NewApiBindingStatusType,
  users,
} from '@/database/schemas';

import {
  NewApiProvisioningAdapter,
  type ProvisionEnterpriseUserInput,
  type ProvisionEnterpriseUserResult,
  type ProvisioningPolicy,
} from '../newApi/provisioningAdapter';

type DbLike = {
  insert: (table: unknown) => any;
  query?: {
    enterpriseDepartments?: {
      findMany?: (args: unknown) => Promise<EnterpriseDepartmentRow[]>;
    };
    users?: {
      findFirst?: (args: unknown) => Promise<{ username?: string | null } | undefined>;
    };
  };
  select?: (fields: Record<string, unknown>) => { from: (table: unknown) => { where: (condition: unknown) => { limit: (n: number) => Promise<Array<{ username?: string | null }>> } } };
  update: (table: unknown) => any;
};

type AihubProvisioningAdapter = {
  provisionEnterpriseUser: (input: ProvisionEnterpriseUserInput) => Promise<ProvisionEnterpriseUserResult>;
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

type DepartmentSyncPolicy = {
  enabled?: boolean;
  mode?: string;
};

type EnterpriseDepartmentRow = {
  externalDepartmentId: string;
  id: string;
  name?: string;
  provider: string;
  rawProfile?: Record<string, unknown>;
  status?: string;
};

export type IdentityProvisioningInput = {
  departmentExternalIds?: string[];
  email?: string;
  employeeNumber?: string;
  externalDepartmentIds?: string[];
  externalUserId: string;
  name?: string;
  policy?: ProvisioningPolicy;
  position?: string;
  provider: string;
  rawProfile?: Record<string, unknown>;
  unionId?: string;
  userId: string;
};

type IdentityProvisioningServiceOptions = {
  aihubProvisioningAdapter?: AihubProvisioningAdapter;
  db: DbLike;
  roleAssigner?: RoleAssigner;
  workspaceAssigner?: WorkspaceAssigner;
};

type TopLevelProvisioningInput = IdentityProvisioningInput &
  Partial<IdentityProvisioningServiceOptions>;

const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const isValidNewApiUserId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

const normalizeSuccessfulBindingStatus = (
  status: unknown,
): Exclude<NewApiBindingStatusType, 'error'> => (status === 'pending' ? 'pending' : 'active');

const shouldSyncDepartmentsOnLogin = (policy: ProvisioningPolicy) => {
  const departmentSync = policy.departmentSync as DepartmentSyncPolicy | undefined;

  return departmentSync?.enabled === true && (departmentSync.mode ?? 'login') === 'login';
};

export class IdentityProvisioningService {
  private aihubProvisioningAdapter?: AihubProvisioningAdapter;
  private db: DbLike;
  private roleAssigner?: RoleAssigner;
  private workspaceAssigner?: WorkspaceAssigner;

  constructor({
    aihubProvisioningAdapter,
    db,
    roleAssigner,
    workspaceAssigner,
  }: IdentityProvisioningServiceOptions) {
    this.aihubProvisioningAdapter = aihubProvisioningAdapter;
    this.db = db;
    this.roleAssigner = roleAssigner;
    this.workspaceAssigner = workspaceAssigner;
  }

  async provisionFromSsoProfile(input: IdentityProvisioningInput) {
    const now = new Date();
    const policy = input.policy ?? {};
    const rawProfile = input.rawProfile ?? {};
    const departmentExternalIds = input.externalDepartmentIds ?? input.departmentExternalIds ?? [];

    const externalIdentityValues = {
      email: input.email ?? null,
      externalUserId: input.externalUserId,
      provider: input.provider,
      rawProfile,
      unionId: input.unionId ?? null,
      userId: input.userId,
    };
    const [externalIdentity] = await this.db
      .insert(externalIdentities)
      .values(externalIdentityValues)
      .onConflictDoUpdate({
        set: {
          email: externalIdentityValues.email,
          rawProfile,
          unionId: externalIdentityValues.unionId,
          userId: input.userId,
        },
        target: [externalIdentities.provider, externalIdentities.externalUserId],
      })
      .returning();

    const existingDepartments =
      departmentExternalIds.length > 0 &&
      typeof this.db.query?.enterpriseDepartments?.findMany === 'function'
        ? await this.db.query.enterpriseDepartments.findMany({
            where: and(
              eq(enterpriseDepartments.provider, input.provider),
              inArray(enterpriseDepartments.externalDepartmentId, departmentExternalIds),
            ),
          })
        : [];
    const existingDepartmentExternalIds = new Set(
      existingDepartments.map((department) => department.externalDepartmentId),
    );
    const missingDepartmentExternalIds = shouldSyncDepartmentsOnLogin(policy)
      ? Array.from(
          new Set(
            departmentExternalIds.filter(
              (externalDepartmentId) => !existingDepartmentExternalIds.has(externalDepartmentId),
            ),
          ),
        )
      : [];
    const createdDepartments =
      missingDepartmentExternalIds.length > 0
        ? await this.db
            .insert(enterpriseDepartments)
            .values(
              missingDepartmentExternalIds.map((externalDepartmentId) => ({
                externalDepartmentId,
                name: externalDepartmentId,
                order: 0,
                parentId: null,
                provider: input.provider,
                rawProfile: {
                  externalDepartmentId,
                  source: 'login',
                },
                status: 'active',
              })),
            )
            .onConflictDoUpdate({
              set: {
                rawProfile: {
                  source: 'login',
                },
                status: 'active',
              },
              target: [enterpriseDepartments.provider, enterpriseDepartments.externalDepartmentId],
            })
            .returning()
        : [];
    const departments = [...existingDepartments, ...createdDepartments];
    const departmentByExternalId = new Map(
      departments.map((department) => [department.externalDepartmentId, department]),
    );
    const orderedDepartments = departmentExternalIds
      .map((externalDepartmentId) => departmentByExternalId.get(externalDepartmentId))
      .filter((department): department is EnterpriseDepartmentRow => Boolean(department));
    const primaryDepartment = orderedDepartments[0];

    const enterpriseProfileValues = {
      employeeNumber: input.employeeNumber ?? null,
      externalUserId: input.externalUserId,
      lastSyncedAt: now,
      position: input.position ?? null,
      primaryDepartmentId: primaryDepartment?.id ?? null,
      provider: input.provider,
      rawProfile,
      userId: input.userId,
    };
    const [enterpriseProfile] = await this.db
      .insert(enterpriseUserProfiles)
      .values(enterpriseProfileValues)
      .onConflictDoUpdate({
        set: {
          employeeNumber: enterpriseProfileValues.employeeNumber,
          externalUserId: input.externalUserId,
          lastSyncedAt: now,
          position: enterpriseProfileValues.position,
          primaryDepartmentId: enterpriseProfileValues.primaryDepartmentId,
          provider: input.provider,
          rawProfile,
        },
        target: enterpriseUserProfiles.userId,
      })
      .returning();

    const membershipValues = orderedDepartments.map((department, index) => ({
      departmentId: department.id,
      isPrimary: index === 0,
      status: 'active',
      userId: input.userId,
    }));
    if (membershipValues.length > 0) {
      await this.db
        .insert(enterpriseDepartmentMembers)
        .values(membershipValues)
        .onConflictDoUpdate({
          set: {
            isPrimary: false,
            status: 'active',
          },
          target: [enterpriseDepartmentMembers.departmentId, enterpriseDepartmentMembers.userId],
        })
        .returning();

      await this.db
        .update(enterpriseDepartmentMembers)
        .set({
          isPrimary: true,
          status: 'active',
        })
        .where(
          and(
            eq(enterpriseDepartmentMembers.departmentId, primaryDepartment?.id),
            eq(enterpriseDepartmentMembers.userId, input.userId),
          ),
        );
    }

    if (policy.defaultRole && this.roleAssigner) {
      await this.roleAssigner.assignDefaultRole({
        roleName: policy.defaultRole,
        userId: input.userId,
      });
    }

    let workspace:
      | { error: string; status: 'error' }
      | { status: 'active'; workspaceId: string }
      | undefined;
    const defaultWorkspaceId =
      typeof policy.defaultWorkspaceId === 'string' && policy.defaultWorkspaceId.trim()
        ? policy.defaultWorkspaceId.trim()
        : undefined;
    if (defaultWorkspaceId && this.workspaceAssigner) {
      try {
        await this.workspaceAssigner.assignDefaultWorkspace({
          role: 'member',
          userId: input.userId,
          workspaceId: defaultWorkspaceId,
        });
        workspace = {
          status: 'active',
          workspaceId: defaultWorkspaceId,
        };
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        workspace = {
          error: errorMessage,
          status: 'error',
        };

        await this.writeAuditLogBestEffort({
          action: 'identity.provision.workspace_error',
          metadata: {
            error: errorMessage,
            provider: input.provider,
            workspaceId: defaultWorkspaceId,
          },
          result: 'failed',
          targetId: input.userId,
          targetType: 'user',
        });
      }
    }

    let aihub: ProvisionEnterpriseUserResult | { error: string; status: 'error' } | undefined;
    if (policy.aihubProvisioning?.enabled) {
      const skipReason = this.aihubProvisioningAdapter
        ? null
        : (() => {
            const adminToken = process.env.AIHUB_ADMIN_ACCESS_TOKEN?.trim();
            const adminUserId = Number(process.env.AIHUB_ADMIN_USER_ID);
            if (!adminToken || !Number.isInteger(adminUserId) || adminUserId <= 0) {
              return 'AIHUB_ADMIN_ACCESS_TOKEN and AIHUB_ADMIN_USER_ID must be configured to enable Aihub provisioning. Set these env vars or disable aihubProvisioning in WeCom SSO config.';
            }
            return null;
          })();

      if (skipReason) {
        console.warn(`[Aihub Provisioning] Skipped: ${skipReason}`);

        await this.writeAuditLogBestEffort({
          action: 'identity.provision.aihub_skipped',
          metadata: {
            reason: 'admin_credentials_not_configured',
            provider: input.provider,
          },
          result: 'success',
          targetId: input.userId,
          targetType: 'user',
        });
      } else
        try {
          const aihubProvisioningAdapter =
            this.aihubProvisioningAdapter ?? new NewApiProvisioningAdapter();

          // Fetch the MasterLion username for token naming (MasterLion_{username}).
          let masterLionUsername: string | undefined;
          if (typeof this.db.query?.users?.findFirst === 'function') {
            const userRow = await this.db.query.users.findFirst({
              columns: { username: true },
              where: eq(users.id, input.userId),
            });
            masterLionUsername = userRow?.username ?? undefined;
          }

          const provisioningResult = await aihubProvisioningAdapter.provisionEnterpriseUser({
            email: input.email,
            employeeNumber: input.employeeNumber,
            masterLionUsername,
            name: input.name,
            policy,
            userId: input.userId,
          });

          if (!isValidNewApiUserId(provisioningResult.newApiUserId)) {
            throw new Error('Aihub provisioning did not return a valid NewAPI user id');
          }

          const bindingStatus = normalizeSuccessfulBindingStatus(provisioningResult.status);
          aihub = {
            ...provisioningResult,
            newApiUserId: provisioningResult.newApiUserId,
            status: bindingStatus,
          };
          await this.db
            .insert(newApiBindings)
            .values({
              errorMessage: null,
              managedTokenId: provisioningResult.managedTokenId ?? null,
              newApiUserId: provisioningResult.newApiUserId,
              status: bindingStatus,
              userId: input.userId,
            })
            .onConflictDoUpdate({
              set: {
                errorMessage: null,
                managedTokenId: provisioningResult.managedTokenId ?? null,
                newApiUserId: provisioningResult.newApiUserId,
                status: bindingStatus,
              },
              target: newApiBindings.userId,
            })
            .returning();

          await this.writeAuditLogBestEffort({
            action: 'identity.provision.success',
            metadata: {
              departmentIds: orderedDepartments.map((department) => department.id),
              provider: input.provider,
            },
            result: 'success',
            targetId: input.userId,
            targetType: 'user',
          });
        } catch (error) {
          const errorMessage = getErrorMessage(error);
          aihub = {
            error: errorMessage,
            status: 'error',
          };

          await this.db
            .insert(newApiBindings)
            .values({
              errorMessage,
              newApiUserId: null,
              status: 'error',
              userId: input.userId,
            })
            .onConflictDoUpdate({
              set: {
                errorMessage,
                status: 'error',
              },
              target: newApiBindings.userId,
            })
            .returning();

          await this.writeAuditLogBestEffort({
            action: 'identity.provision.aihub_error',
            metadata: {
              error: errorMessage,
              provider: input.provider,
            },
            result: 'failed',
            targetId: input.userId,
            targetType: 'user',
          });
        }
    } else {
      await this.writeAuditLogBestEffort({
        action: 'identity.provision.success',
        metadata: {
          departmentIds: orderedDepartments.map((department) => department.id),
          provider: input.provider,
        },
        result: 'success',
        targetId: input.userId,
        targetType: 'user',
      });
    }

    return {
      aihub,
      departmentIds: orderedDepartments.map((department) => department.id),
      enterpriseProfile,
      externalIdentity,
      userId: input.userId,
      workspace,
    };
  }

  private async writeAuditLog(input: {
    action: string;
    metadata: Record<string, unknown>;
    result: 'failed' | 'success';
    targetId: string;
    targetType: string;
  }) {
    await this.db
      .insert(enterpriseAuditLogs)
      .values(input)
      .returning();
  }

  private async writeAuditLogBestEffort(input: {
    action: string;
    metadata: Record<string, unknown>;
    result: 'failed' | 'success';
    targetId: string;
    targetType: string;
  }) {
    try {
      await this.writeAuditLog(input);
    } catch {}
  }
}

export const provisionFromSsoProfile = async (input: TopLevelProvisioningInput) => {
  const { aihubProvisioningAdapter, db, roleAssigner, workspaceAssigner, ...profile } = input;

  if (!db) {
    throw new Error('provisionFromSsoProfile requires a db option');
  }

  return new IdentityProvisioningService({
    aihubProvisioningAdapter,
    db,
    roleAssigner,
    workspaceAssigner,
  }).provisionFromSsoProfile(profile);
};
