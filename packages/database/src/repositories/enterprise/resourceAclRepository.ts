import { and, eq, inArray, isNull } from 'drizzle-orm';

import {
  type NewResourceAccessControl,
  type ResourceAccessControlItem,
  resourceAccessControls,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';

export type ResourceType =
  | 'connector'
  | 'document'
  | 'file'
  | 'folder'
  | 'knowledge_base'
  | 'skill';
export type PrincipalType = 'department' | 'role' | 'user' | 'workspace';
export type ResourcePermission = 'manage' | 'read' | 'write';

export interface ResourceRef {
  resourceId: string;
  resourceType: ResourceType;
}

export interface PrincipalRef {
  principalId: string;
  principalType: PrincipalType;
}

export interface GrantResourceAclParams extends PrincipalRef, ResourceRef {
  createdBy?: null | string;
  permission: ResourcePermission;
  workspaceId?: null | string;
}

export interface EffectiveResourceAclResult {
  aclId?: string;
  inheritedFrom?: ResourceRef & { aclId?: string };
  permission?: ResourcePermission;
  resource?: ResourceRef;
  source?: 'acl';
}

export type ResourceAccessControlRow = ResourceAccessControlItem;

export interface ResourceAclStore {
  findGrant(
    params: Omit<GrantResourceAclParams, 'createdBy' | 'permission'>,
  ): Promise<ResourceAccessControlRow | undefined>;
  insertGrant(params: GrantResourceAclParams): Promise<ResourceAccessControlRow>;
  listEffectiveLookup(params: {
    principals: PrincipalRef[];
    resourceChain: ResourceRef[];
    workspaceId?: null | string;
  }): Promise<ResourceAccessControlRow[]>;
  listForResource(params: {
    resourceId: string;
    resourceType: ResourceType;
    workspaceId?: null | string;
  }): Promise<ResourceAccessControlRow[]>;
  updateGrant(
    id: string,
    values: Pick<GrantResourceAclParams, 'createdBy' | 'permission'>,
  ): Promise<ResourceAccessControlRow>;
}

const permissionRank: Record<ResourcePermission, number> = {
  manage: 3,
  read: 1,
  write: 2,
};

export const permissionSatisfies = (
  actual: null | ResourcePermission | undefined,
  required: ResourcePermission,
): boolean => Boolean(actual && permissionRank[actual] >= permissionRank[required]);

export const bestPermission = (
  permissions: readonly ResourcePermission[],
): ResourcePermission | undefined => {
  let best: ResourcePermission | undefined;

  for (const permission of permissions) {
    if (!best || permissionRank[permission] > permissionRank[best]) {
      best = permission;
    }
  }

  return best;
};

const workspaceScopeWhere = (workspaceId?: null | string) =>
  workspaceId
    ? eq(resourceAccessControls.workspaceId, workspaceId)
    : isNull(resourceAccessControls.workspaceId);

class DrizzleResourceAclStore implements ResourceAclStore {
  constructor(private readonly db: LobeChatDatabase) {}

  findGrant = async ({
    principalId,
    principalType,
    resourceId,
    resourceType,
    workspaceId,
  }: Omit<GrantResourceAclParams, 'createdBy' | 'permission'>) => {
    return this.db.query.resourceAccessControls.findFirst({
      where: and(
        workspaceScopeWhere(workspaceId),
        eq(resourceAccessControls.resourceType, resourceType),
        eq(resourceAccessControls.resourceId, resourceId),
        eq(resourceAccessControls.principalType, principalType),
        eq(resourceAccessControls.principalId, principalId),
      ),
    });
  };

  insertGrant = async (params: GrantResourceAclParams) => {
    const [row] = await this.db
      .insert(resourceAccessControls)
      .values({
        createdBy: params.createdBy,
        permission: params.permission,
        principalId: params.principalId,
        principalType: params.principalType,
        resourceId: params.resourceId,
        resourceType: params.resourceType,
        workspaceId: params.workspaceId ?? null,
      } satisfies NewResourceAccessControl)
      .returning();

    return row!;
  };

  listEffectiveLookup = async ({
    principals,
    resourceChain,
    workspaceId,
  }: {
    principals: PrincipalRef[];
    resourceChain: ResourceRef[];
    workspaceId?: null | string;
  }) => {
    if (principals.length === 0 || resourceChain.length === 0) return [];

    const resourceTypes = [...new Set(resourceChain.map((resource) => resource.resourceType))];
    const resourceIds = [...new Set(resourceChain.map((resource) => resource.resourceId))];
    const principalTypes = [...new Set(principals.map((principal) => principal.principalType))];
    const principalIds = [...new Set(principals.map((principal) => principal.principalId))];

    const rows = await this.db
      .select()
      .from(resourceAccessControls)
      .where(
        and(
          workspaceScopeWhere(workspaceId),
          inArray(resourceAccessControls.resourceType, resourceTypes),
          inArray(resourceAccessControls.resourceId, resourceIds),
          inArray(resourceAccessControls.principalType, principalTypes),
          inArray(resourceAccessControls.principalId, principalIds),
        ),
      );

    return rows.filter(
      (row) =>
        resourceChain.some(
          (resource) =>
            resource.resourceType === row.resourceType && resource.resourceId === row.resourceId,
        ) &&
        principals.some(
          (principal) =>
            principal.principalType === row.principalType &&
            principal.principalId === row.principalId,
        ),
    );
  };

  listForResource = async ({
    resourceId,
    resourceType,
    workspaceId,
  }: {
    resourceId: string;
    resourceType: ResourceType;
    workspaceId?: null | string;
  }) => {
    return this.db
      .select()
      .from(resourceAccessControls)
      .where(
        and(
          workspaceScopeWhere(workspaceId),
          eq(resourceAccessControls.resourceType, resourceType),
          eq(resourceAccessControls.resourceId, resourceId),
        ),
      );
  };

  updateGrant = async (
    id: string,
    values: Pick<GrantResourceAclParams, 'createdBy' | 'permission'>,
  ) => {
    const setValues: Partial<NewResourceAccessControl> = {
      permission: values.permission,
      updatedAt: new Date(),
    };

    if (values.createdBy !== undefined) {
      setValues.createdBy = values.createdBy;
    }

    const [row] = await this.db
      .update(resourceAccessControls)
      .set(setValues)
      .where(eq(resourceAccessControls.id, id))
      .returning();

    return row!;
  };
}

export class ResourceAclRepository {
  private readonly store: ResourceAclStore;

  constructor(db: LobeChatDatabase, store?: ResourceAclStore) {
    this.store = store ?? new DrizzleResourceAclStore(db);
  }

  grant = async (params: GrantResourceAclParams) => {
    const existing = await this.store.findGrant({
      principalId: params.principalId,
      principalType: params.principalType,
      resourceId: params.resourceId,
      resourceType: params.resourceType,
      workspaceId: params.workspaceId ?? null,
    });

    if (existing) {
      return this.store.updateGrant(existing.id, {
        createdBy: params.createdBy,
        permission: params.permission,
      });
    }

    return this.store.insertGrant({
      ...params,
      workspaceId: params.workspaceId ?? null,
    });
  };

  listForResource = (params: {
    resourceId: string;
    resourceType: ResourceType;
    workspaceId?: null | string;
  }) =>
    this.store.listForResource({
      ...params,
      workspaceId: params.workspaceId ?? null,
    });

  getEffectivePermission = async ({
    principals,
    resourceChain,
    workspaceId,
  }: {
    principals: PrincipalRef[];
    resourceChain: ResourceRef[];
    workspaceId?: null | string;
  }): Promise<EffectiveResourceAclResult> => {
    if (principals.length === 0 || resourceChain.length === 0) return {};

    const rows = await this.store.listEffectiveLookup({
      principals,
      resourceChain,
      workspaceId: workspaceId ?? null,
    });

    for (const [index, resource] of resourceChain.entries()) {
      const matches = rows.filter(
        (row) =>
          row.resourceType === resource.resourceType && row.resourceId === resource.resourceId,
      );
      const permission = bestPermission(matches.map((row) => row.permission));

      if (!permission) continue;

      const acl = matches.find((row) => row.permission === permission);

      return {
        aclId: acl?.id,
        inheritedFrom: index > 0 ? { ...resource, aclId: acl?.id } : undefined,
        permission,
        resource,
        source: 'acl',
      };
    }

    return {};
  };
}
