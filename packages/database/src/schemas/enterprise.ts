import { isNotNull, isNull, relations } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, timestamptz, updatedAt } from './_helpers';
import { users } from './user';
import { workspaces } from './workspace';

export const resourceTypeEnum = pgEnum('enterprise_resource_type', [
  'knowledge_base',
  'folder',
  'document',
  'file',
  'skill',
  'connector',
]);

export const principalTypeEnum = pgEnum('enterprise_principal_type', [
  'user',
  'role',
  'workspace',
  'department',
]);

export const resourcePermissionEnum = pgEnum('enterprise_resource_permission', [
  'read',
  'write',
  'manage',
]);

export const workspacePolicyTypeEnum = pgEnum('enterprise_workspace_policy_type', [
  'knowledge',
  'skill',
  'connector',
  'upload',
  'ai',
]);

export const systemConfigs = pgTable(
  'system_configs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('systemConfigs')),
    key: text('key').notNull(),
    scope: text('scope').notNull().default('global'),
    value: jsonb('value').$type<Record<string, unknown>>().notNull().default({}),
    updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('system_configs_key_scope_unique').on(t.key, t.scope)],
);

export const ssoProviderConfigs = pgTable(
  'sso_provider_configs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('ssoProviderConfigs')),
    provider: text('provider').notNull(),
    displayName: text('display_name').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    encryptedSecrets: jsonb('encrypted_secrets')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('sso_provider_configs_provider_unique').on(t.provider)],
);

export const externalIdentities = pgTable(
  'external_identities',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('externalIdentities')),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    externalUserId: text('external_user_id').notNull(),
    unionId: text('union_id'),
    email: text('email'),
    mobileHash: text('mobile_hash'),
    rawProfile: jsonb('raw_profile').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('external_identities_provider_external_user_id_unique').on(
      t.provider,
      t.externalUserId,
    ),
    index('external_identities_user_id_provider_idx').on(t.userId, t.provider),
  ],
);

export const enterpriseDepartments = pgTable(
  'enterprise_departments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('enterpriseDepartments')),
    provider: text('provider').notNull(),
    externalDepartmentId: text('external_department_id').notNull(),
    parentId: text('parent_id').references((): AnyPgColumn => enterpriseDepartments.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    order: integer('order').notNull().default(0),
    status: text('status').notNull().default('active'),
    rawProfile: jsonb('raw_profile').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('enterprise_departments_provider_external_department_id_unique').on(
      t.provider,
      t.externalDepartmentId,
    ),
    index('enterprise_departments_parent_id_idx').on(t.parentId),
  ],
);

export const enterpriseDepartmentMembers = pgTable(
  'enterprise_department_members',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('enterpriseDepartmentMembers')),
    departmentId: text('department_id')
      .notNull()
      .references(() => enterpriseDepartments.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    isPrimary: boolean('is_primary').notNull().default(false),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('enterprise_department_members_department_id_user_id_unique').on(
      t.departmentId,
      t.userId,
    ),
    index('enterprise_department_members_user_id_idx').on(t.userId),
  ],
);

export const enterpriseUserProfiles = pgTable(
  'enterprise_user_profiles',
  {
    userId: text('user_id')
      .primaryKey()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    employeeNumber: text('employee_number'),
    employmentStatus: text('employment_status').notNull().default('active'),
    position: text('position'),
    primaryDepartmentId: text('primary_department_id').references(() => enterpriseDepartments.id, {
      onDelete: 'set null',
    }),
    provider: text('provider').notNull(),
    externalUserId: text('external_user_id').notNull(),
    rawProfile: jsonb('raw_profile').$type<Record<string, unknown>>().notNull().default({}),
    lastSyncedAt: timestamptz('last_synced_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('enterprise_user_profiles_employee_number_unique').on(t.employeeNumber),
    uniqueIndex('enterprise_user_profiles_provider_external_user_id_unique').on(
      t.provider,
      t.externalUserId,
    ),
    index('enterprise_user_profiles_primary_department_id_idx').on(t.primaryDepartmentId),
  ],
);

export const enterpriseAuditLogs = pgTable(
  'enterprise_audit_logs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('enterpriseAuditLogs')),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    result: text('result').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('enterprise_audit_logs_actor_user_id_idx').on(t.actorUserId),
    index('enterprise_audit_logs_action_idx').on(t.action),
    index('enterprise_audit_logs_target_idx').on(t.targetType, t.targetId),
    index('enterprise_audit_logs_created_at_idx').on(t.createdAt),
  ],
);

export const resourceAccessControls = pgTable(
  'resource_access_controls',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('resourceAccessControls')),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    resourceType: resourceTypeEnum('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    principalType: principalTypeEnum('principal_type').notNull(),
    principalId: text('principal_id').notNull(),
    permission: resourcePermissionEnum('permission').notNull(),
    inheritedFromId: text('inherited_from_id').references(
      (): AnyPgColumn => resourceAccessControls.id,
      {
        onDelete: 'set null',
      },
    ),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('resource_access_controls_resource_idx').on(t.resourceType, t.resourceId),
    index('resource_access_controls_principal_idx').on(t.principalType, t.principalId),
    uniqueIndex('resource_access_controls_workspace_scope_unique')
      .on(t.workspaceId, t.resourceType, t.resourceId, t.principalType, t.principalId)
      .where(isNotNull(t.workspaceId)),
    uniqueIndex('resource_access_controls_global_scope_unique')
      .on(t.resourceType, t.resourceId, t.principalType, t.principalId)
      .where(isNull(t.workspaceId)),
  ],
);

export const workspacePolicies = pgTable(
  'workspace_policies',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('workspacePolicies')),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    policyType: workspacePolicyTypeEnum('policy_type').notNull(),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('workspace_policies_workspace_id_policy_type_unique').on(
      t.workspaceId,
      t.policyType,
    ),
  ],
);

export const systemConfigsRelations = relations(systemConfigs, ({ one }) => ({
  updater: one(users, {
    fields: [systemConfigs.updatedBy],
    references: [users.id],
  }),
}));

export const ssoProviderConfigsRelations = relations(ssoProviderConfigs, ({ one }) => ({
  updater: one(users, {
    fields: [ssoProviderConfigs.updatedBy],
    references: [users.id],
  }),
}));

export const externalIdentitiesRelations = relations(externalIdentities, ({ one }) => ({
  user: one(users, {
    fields: [externalIdentities.userId],
    references: [users.id],
  }),
}));

export const enterpriseDepartmentsRelations = relations(enterpriseDepartments, ({ many, one }) => ({
  members: many(enterpriseDepartmentMembers),
  parent: one(enterpriseDepartments, {
    fields: [enterpriseDepartments.parentId],
    references: [enterpriseDepartments.id],
  }),
  profiles: many(enterpriseUserProfiles),
}));

export const enterpriseDepartmentMembersRelations = relations(
  enterpriseDepartmentMembers,
  ({ one }) => ({
    department: one(enterpriseDepartments, {
      fields: [enterpriseDepartmentMembers.departmentId],
      references: [enterpriseDepartments.id],
    }),
    user: one(users, {
      fields: [enterpriseDepartmentMembers.userId],
      references: [users.id],
    }),
  }),
);

export const enterpriseUserProfilesRelations = relations(enterpriseUserProfiles, ({ one }) => ({
  primaryDepartment: one(enterpriseDepartments, {
    fields: [enterpriseUserProfiles.primaryDepartmentId],
    references: [enterpriseDepartments.id],
  }),
  user: one(users, {
    fields: [enterpriseUserProfiles.userId],
    references: [users.id],
  }),
}));

export const enterpriseAuditLogsRelations = relations(enterpriseAuditLogs, ({ one }) => ({
  actor: one(users, {
    fields: [enterpriseAuditLogs.actorUserId],
    references: [users.id],
  }),
}));

export const resourceAccessControlsRelations = relations(resourceAccessControls, ({ one }) => ({
  creator: one(users, {
    fields: [resourceAccessControls.createdBy],
    references: [users.id],
  }),
  inheritedFrom: one(resourceAccessControls, {
    fields: [resourceAccessControls.inheritedFromId],
    references: [resourceAccessControls.id],
  }),
  workspace: one(workspaces, {
    fields: [resourceAccessControls.workspaceId],
    references: [workspaces.id],
  }),
}));

export const workspacePoliciesRelations = relations(workspacePolicies, ({ one }) => ({
  updater: one(users, {
    fields: [workspacePolicies.updatedBy],
    references: [users.id],
  }),
  workspace: one(workspaces, {
    fields: [workspacePolicies.workspaceId],
    references: [workspaces.id],
  }),
}));

export type SystemConfigItem = typeof systemConfigs.$inferSelect;
export type NewSystemConfig = typeof systemConfigs.$inferInsert;
export type SsoProviderConfigItem = typeof ssoProviderConfigs.$inferSelect;
export type NewSsoProviderConfig = typeof ssoProviderConfigs.$inferInsert;
export type ExternalIdentityItem = typeof externalIdentities.$inferSelect;
export type NewExternalIdentity = typeof externalIdentities.$inferInsert;
export type EnterpriseDepartmentItem = typeof enterpriseDepartments.$inferSelect;
export type NewEnterpriseDepartment = typeof enterpriseDepartments.$inferInsert;
export type EnterpriseDepartmentMemberItem = typeof enterpriseDepartmentMembers.$inferSelect;
export type NewEnterpriseDepartmentMember = typeof enterpriseDepartmentMembers.$inferInsert;
export type EnterpriseUserProfileItem = typeof enterpriseUserProfiles.$inferSelect;
export type NewEnterpriseUserProfile = typeof enterpriseUserProfiles.$inferInsert;
export type EnterpriseAuditLogItem = typeof enterpriseAuditLogs.$inferSelect;
export type NewEnterpriseAuditLog = typeof enterpriseAuditLogs.$inferInsert;
export type ResourceAccessControlItem = typeof resourceAccessControls.$inferSelect;
export type NewResourceAccessControl = typeof resourceAccessControls.$inferInsert;
export type WorkspacePolicyItem = typeof workspacePolicies.$inferSelect;
export type NewWorkspacePolicy = typeof workspacePolicies.$inferInsert;
