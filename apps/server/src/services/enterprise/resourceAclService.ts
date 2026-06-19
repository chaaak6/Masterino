import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import {
  type EffectiveResourceAclResult,
  permissionSatisfies,
  type PrincipalRef,
  ResourceAclRepository,
  type ResourcePermission,
  type ResourceRef,
} from '@/database/repositories/enterprise/resourceAclRepository';
import {
  DOCUMENT_FOLDER_TYPE,
  agentSkills,
  documents,
  files,
  knowledgeBaseFiles,
  knowledgeBases,
  userConnectors,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { isPlatformAdminRole } from './permissionService';

export type ResourceAclDecision = Omit<EffectiveResourceAclResult, 'source'> & {
  legacyAllowed?: boolean;
  permission?: ResourcePermission;
  source?: 'acl' | 'legacy' | 'owner' | 'platform_admin';
};

export interface BuildPrincipalRefsParams {
  departmentIds?: string[];
  roleIds?: string[];
  userId?: string;
  workspaceId?: null | string;
}

export interface GetEffectiveResourceAclParams extends BuildPrincipalRefsParams {
  allowLegacyFallback?: boolean;
  db: LobeChatDatabase;
  ownerUserId?: null | string;
  ownerWorkspaceId?: null | string;
  platformRole?: null | string;
  resource: ResourceRef;
  resourceChain?: ResourceRef[];
  userId: string;
  workspaceId?: null | string;
}

export interface AssertResourceAclParams extends GetEffectiveResourceAclParams {
  permission: ResourcePermission;
}

export type ResourceAclRepositoryFactory = (db: LobeChatDatabase) => ResourceAclRepository;

export interface ResourceOwnerScope {
  ownerUserId?: null | string;
  ownerWorkspaceId?: null | string;
}

export interface ResolvedResourceAclScope extends ResourceOwnerScope {
  exists: boolean;
  resource: ResourceRef;
  resourceChain: ResourceRef[];
}

export const isResourceAclStrictMode = (): boolean => {
  const value = process.env.MASTERLION_RESOURCE_ACL_STRICT;
  return value === '1' || value === 'true';
};

export const buildPrincipalRefs = ({
  departmentIds = [],
  roleIds = [],
  userId,
  workspaceId,
}: BuildPrincipalRefsParams): PrincipalRef[] => {
  const principals: PrincipalRef[] = [];

  if (userId) principals.push({ principalId: userId, principalType: 'user' });
  if (workspaceId) principals.push({ principalId: workspaceId, principalType: 'workspace' });

  for (const roleId of roleIds) {
    principals.push({ principalId: roleId, principalType: 'role' });
  }

  for (const departmentId of departmentIds) {
    principals.push({ principalId: departmentId, principalType: 'department' });
  }

  return principals;
};

export const isLegacyResourceScopeVisible = ({
  ownerUserId,
  ownerWorkspaceId,
  userId,
  workspaceId,
}: ResourceOwnerScope & { userId: string; workspaceId?: null | string }): boolean =>
  workspaceId ? ownerWorkspaceId === workspaceId : ownerUserId === userId && !ownerWorkspaceId;

const getDocumentResourceType = (fileType?: null | string): ResourceRef['resourceType'] =>
  fileType === DOCUMENT_FOLDER_TYPE ? 'folder' : 'document';

const missingResourceScope = (resource: ResourceRef): ResolvedResourceAclScope => ({
  exists: false,
  resource,
  resourceChain: [resource],
});

const appendResourceOnce = (chain: ResourceRef[], resource: ResourceRef) => {
  if (
    chain.some(
      (item) =>
        item.resourceType === resource.resourceType && item.resourceId === resource.resourceId,
    )
  ) {
    return;
  }

  chain.push(resource);
};

const resolveDocumentChain = async (
  db: LobeChatDatabase,
  document: {
    fileType?: null | string;
    id: string;
    knowledgeBaseId?: null | string;
    parentId?: null | string;
  },
): Promise<{ knowledgeBaseId?: null | string; resourceChain: ResourceRef[] }> => {
  const chain: ResourceRef[] = [
    {
      resourceId: document.id,
      resourceType: getDocumentResourceType(document.fileType),
    },
  ];
  const seen = new Set<string>([document.id]);
  let knowledgeBaseId = document.knowledgeBaseId;
  let parentId = document.parentId;

  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = await db.query.documents.findFirst({
      columns: {
        fileType: true,
        id: true,
        knowledgeBaseId: true,
        parentId: true,
      },
      where: eq(documents.id, parentId),
    });

    if (!parent) break;

    chain.push({
      resourceId: parent.id,
      resourceType: getDocumentResourceType(parent.fileType),
    });

    knowledgeBaseId ||= parent.knowledgeBaseId;
    parentId = parent.parentId;
  }

  if (knowledgeBaseId) {
    appendResourceOnce(chain, {
      resourceId: knowledgeBaseId,
      resourceType: 'knowledge_base',
    });
  }

  return { knowledgeBaseId, resourceChain: chain };
};

export const resolveResourceAclScope = async (
  db: LobeChatDatabase,
  resource: ResourceRef,
): Promise<ResolvedResourceAclScope> => {
  switch (resource.resourceType) {
    case 'knowledge_base': {
      const row = await db.query.knowledgeBases.findFirst({
        columns: { id: true, userId: true, workspaceId: true },
        where: eq(knowledgeBases.id, resource.resourceId),
      });

      if (!row) return missingResourceScope(resource);

      return {
        exists: true,
        ownerUserId: row.userId,
        ownerWorkspaceId: row.workspaceId,
        resource,
        resourceChain: [resource],
      };
    }

    case 'document':
    case 'folder': {
      const row = await db.query.documents.findFirst({
        columns: {
          fileType: true,
          id: true,
          knowledgeBaseId: true,
          parentId: true,
          userId: true,
          workspaceId: true,
        },
        where: eq(documents.id, resource.resourceId),
      });

      if (!row) return missingResourceScope(resource);

      const actualResource: ResourceRef = {
        resourceId: row.id,
        resourceType: getDocumentResourceType(row.fileType),
      };
      if (actualResource.resourceType !== resource.resourceType)
        return missingResourceScope(resource);

      return {
        exists: true,
        ownerUserId: row.userId,
        ownerWorkspaceId: row.workspaceId,
        resource: actualResource,
        resourceChain: (await resolveDocumentChain(db, row)).resourceChain,
      };
    }

    case 'file': {
      const row = await db.query.files.findFirst({
        columns: { id: true, parentId: true, userId: true, workspaceId: true },
        where: eq(files.id, resource.resourceId),
      });

      if (!row) return missingResourceScope(resource);

      const resourceChain: ResourceRef[] = [resource];
      let hasKnowledgeBase = false;

      if (row.parentId) {
        const parent = await db.query.documents.findFirst({
          columns: {
            fileType: true,
            id: true,
            knowledgeBaseId: true,
            parentId: true,
          },
          where: eq(documents.id, row.parentId),
        });

        if (parent) {
          const parentScope = await resolveDocumentChain(db, parent);

          for (const parentResource of parentScope.resourceChain) {
            appendResourceOnce(resourceChain, parentResource);
          }

          hasKnowledgeBase = Boolean(parentScope.knowledgeBaseId);
        }
      }

      if (!hasKnowledgeBase) {
        const knowledgeBaseLink = await db.query.knowledgeBaseFiles.findFirst({
          columns: { knowledgeBaseId: true },
          where: eq(knowledgeBaseFiles.fileId, resource.resourceId),
        });

        if (knowledgeBaseLink?.knowledgeBaseId) {
          appendResourceOnce(resourceChain, {
            resourceId: knowledgeBaseLink.knowledgeBaseId,
            resourceType: 'knowledge_base',
          });
        }
      }

      return {
        exists: true,
        ownerUserId: row.userId,
        ownerWorkspaceId: row.workspaceId,
        resource,
        resourceChain,
      };
    }

    case 'skill': {
      const row = await db.query.agentSkills.findFirst({
        columns: { id: true, userId: true, workspaceId: true },
        where: eq(agentSkills.id, resource.resourceId),
      });

      if (!row) return missingResourceScope(resource);

      return {
        exists: true,
        ownerUserId: row.userId,
        ownerWorkspaceId: row.workspaceId,
        resource,
        resourceChain: [resource],
      };
    }

    case 'connector': {
      const row = await db.query.userConnectors.findFirst({
        columns: { id: true, userId: true, workspaceId: true },
        where: eq(userConnectors.id, resource.resourceId),
      });

      if (!row) return missingResourceScope(resource);

      return {
        exists: true,
        ownerUserId: row.userId,
        ownerWorkspaceId: row.workspaceId,
        resource,
        resourceChain: [resource],
      };
    }
  }
};

export const resolveResourceOwner = async (
  db: LobeChatDatabase,
  resource: ResourceRef,
): Promise<ResourceOwnerScope> => {
  const scope = await resolveResourceAclScope(db, resource);

  return { ownerUserId: scope.ownerUserId, ownerWorkspaceId: scope.ownerWorkspaceId };
};

export class ResourceAclService {
  constructor(
    private readonly createRepository: ResourceAclRepositoryFactory = (db) =>
      new ResourceAclRepository(db),
  ) {}

  getEffectivePermission = async ({
    allowLegacyFallback = true,
    db,
    departmentIds,
    ownerUserId,
    platformRole,
    resource,
    resourceChain,
    roleIds,
    userId,
    workspaceId,
  }: GetEffectiveResourceAclParams): Promise<ResourceAclDecision> => {
    if (isPlatformAdminRole(platformRole)) {
      return { permission: 'manage', resource, source: 'platform_admin' };
    }

    if (ownerUserId === userId) {
      return { permission: 'manage', resource, source: 'owner' };
    }

    const repository = this.createRepository(db);
    const aclResult = await repository.getEffectivePermission({
      principals: buildPrincipalRefs({ departmentIds, roleIds, userId, workspaceId }),
      resourceChain: resourceChain ?? [resource],
      workspaceId: workspaceId ?? null,
    });

    if (aclResult.permission) return { ...aclResult, source: 'acl' };

    if (allowLegacyFallback && !isResourceAclStrictMode()) {
      return {
        legacyAllowed: true,
        permission: 'manage',
        resource,
        source: 'legacy',
      };
    }

    return aclResult;
  };

  assertCan = async (params: AssertResourceAclParams): Promise<ResourceAclDecision> => {
    const effective = await this.getEffectivePermission(params);

    if (permissionSatisfies(effective.permission, params.permission)) {
      return effective;
    }

    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Missing resource permission: ${params.permission}`,
    });
  };
}

export const resourceAclService = new ResourceAclService();
export const getEffectivePermission = (params: GetEffectiveResourceAclParams) =>
  resourceAclService.getEffectivePermission(params);
export const assertCan = (params: AssertResourceAclParams) => resourceAclService.assertCan(params);
