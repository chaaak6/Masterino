import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  type PrincipalType,
  ResourceAclRepository,
  type ResourcePermission,
  type ResourceRef,
  type ResourceType,
} from '@/database/repositories/enterprise/resourceAclRepository';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  isLegacyResourceScopeVisible,
  resolveResourceAclScope,
  resourceAclService,
} from '@/server/services/enterprise/resourceAclService';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';

const resourceTypes = [
  'knowledge_base',
  'folder',
  'document',
  'file',
  'skill',
  'connector',
] as const satisfies readonly [ResourceType, ...ResourceType[]];
const principalTypes = ['user', 'role', 'workspace', 'department'] as const satisfies readonly [
  PrincipalType,
  ...PrincipalType[],
];
const resourcePermissions = ['read', 'write', 'manage'] as const satisfies readonly [
  ResourcePermission,
  ...ResourcePermission[],
];

const resourceTypeSchema = z.enum(resourceTypes);
const principalTypeSchema = z.enum(principalTypes);
const resourcePermissionSchema = z.enum(resourcePermissions);

const resourceInputSchema = z.object({
  resourceId: z.string(),
  resourceType: resourceTypeSchema,
});

const getPlatformRole = (ctx: unknown): null | string => {
  const record = ctx as Record<string, any>;
  return record.platformRole ?? record.user?.platformRole ?? record.user?.role ?? null;
};

const getStringArray = (ctx: unknown, key: string): string[] | undefined => {
  const value = (ctx as Record<string, unknown>)[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined;
};

const assertCanManageResource = async (ctx: any, resource: ResourceRef) => {
  const scope = await resolveResourceAclScope(ctx.serverDB, resource);

  if (!scope.exists) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Resource not found' });
  }

  return resourceAclService.assertCan({
    allowLegacyFallback: false,
    db: ctx.serverDB,
    departmentIds: getStringArray(ctx, 'departmentIds'),
    ownerUserId: scope.ownerUserId,
    ownerWorkspaceId: scope.ownerWorkspaceId,
    permission: 'manage',
    platformRole: getPlatformRole(ctx),
    resource: scope.resource,
    resourceChain: scope.resourceChain,
    roleIds: getStringArray(ctx, 'roleIds'),
    userId: ctx.userId,
    workspaceId: ctx.workspaceId ?? null,
  });
};

const resourcePermissionProcedure = wsCompatProcedure.use(serverDatabase);

export const resourcePermissionRouter = router({
  getEffectivePermissions: resourcePermissionProcedure
    .input(resourceInputSchema)
    .query(async ({ ctx, input }) => {
      const resource: ResourceRef = {
        resourceId: input.resourceId,
        resourceType: input.resourceType,
      };
      const scope = await resolveResourceAclScope(ctx.serverDB, resource);

      return resourceAclService.getEffectivePermission({
        allowLegacyFallback: isLegacyResourceScopeVisible({
          ownerUserId: scope.ownerUserId,
          ownerWorkspaceId: scope.ownerWorkspaceId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? null,
        }),
        db: ctx.serverDB,
        departmentIds: getStringArray(ctx, 'departmentIds'),
        ownerUserId: scope.ownerUserId,
        ownerWorkspaceId: scope.ownerWorkspaceId,
        platformRole: getPlatformRole(ctx),
        resource: scope.resource,
        resourceChain: scope.resourceChain,
        roleIds: getStringArray(ctx, 'roleIds'),
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? null,
      });
    }),

  grant: resourcePermissionProcedure
    .input(
      resourceInputSchema.extend({
        permission: resourcePermissionSchema,
        principalId: z.string(),
        principalType: principalTypeSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const resource: ResourceRef = {
        resourceId: input.resourceId,
        resourceType: input.resourceType,
      };
      await assertCanManageResource(ctx, resource);

      const repository = new ResourceAclRepository(ctx.serverDB);
      return repository.grant({
        createdBy: ctx.userId,
        permission: input.permission,
        principalId: input.principalId,
        principalType: input.principalType,
        resourceId: input.resourceId,
        resourceType: input.resourceType,
        workspaceId: ctx.workspaceId ?? null,
      });
    }),

  listGrants: resourcePermissionProcedure
    .input(resourceInputSchema)
    .query(async ({ ctx, input }) => {
      const resource: ResourceRef = {
        resourceId: input.resourceId,
        resourceType: input.resourceType,
      };
      await assertCanManageResource(ctx, resource);

      const repository = new ResourceAclRepository(ctx.serverDB);
      return repository.listForResource({
        resourceId: input.resourceId,
        resourceType: input.resourceType,
        workspaceId: ctx.workspaceId ?? null,
      });
    }),
});
