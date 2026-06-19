// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  EffectiveResourceAclResult,
  ResourceAclRepository,
} from '@/database/repositories/enterprise/resourceAclRepository';

import {
  buildPrincipalRefs,
  isResourceAclStrictMode,
  resolveResourceAclScope,
  ResourceAclService,
} from './resourceAclService';

const createService = (result: EffectiveResourceAclResult) => {
  const repository = {
    getEffectivePermission: vi.fn().mockResolvedValue(result),
  } as unknown as ResourceAclRepository;

  return {
    repository,
    service: new ResourceAclService(() => repository),
  };
};

describe('resourceAclService', () => {
  const originalStrictMode = process.env.MASTERLION_RESOURCE_ACL_STRICT;

  afterEach(() => {
    if (originalStrictMode === undefined) {
      delete process.env.MASTERLION_RESOURCE_ACL_STRICT;
      return;
    }

    process.env.MASTERLION_RESOURCE_ACL_STRICT = originalStrictMode;
  });

  it('treats MASTERLION_RESOURCE_ACL_STRICT=1 or true as strict mode', () => {
    process.env.MASTERLION_RESOURCE_ACL_STRICT = '1';
    expect(isResourceAclStrictMode()).toBe(true);

    process.env.MASTERLION_RESOURCE_ACL_STRICT = 'true';
    expect(isResourceAclStrictMode()).toBe(true);

    process.env.MASTERLION_RESOURCE_ACL_STRICT = '0';
    expect(isResourceAclStrictMode()).toBe(false);
  });

  it('builds principal refs for user, workspace, roles, and departments', () => {
    expect(
      buildPrincipalRefs({
        departmentIds: ['department-1'],
        roleIds: ['role-1', 'role-2'],
        userId: 'user-1',
        workspaceId: 'workspace-1',
      }),
    ).toEqual([
      { principalId: 'user-1', principalType: 'user' },
      { principalId: 'workspace-1', principalType: 'workspace' },
      { principalId: 'role-1', principalType: 'role' },
      { principalId: 'role-2', principalType: 'role' },
      { principalId: 'department-1', principalType: 'department' },
    ]);
  });

  it('allows platform admins with manage permission without querying ACLs', async () => {
    process.env.MASTERLION_RESOURCE_ACL_STRICT = '1';
    const { repository, service } = createService({});

    await expect(
      service.assertCan({
        db: {} as any,
        permission: 'manage',
        platformRole: 'platform_admin',
        resource: { resourceId: 'kb-1', resourceType: 'knowledge_base' },
        userId: 'user-1',
        workspaceId: 'workspace-1',
      }),
    ).resolves.toMatchObject({ permission: 'manage', source: 'platform_admin' });

    expect(repository.getEffectivePermission).not.toHaveBeenCalled();
  });

  it('allows direct resource owners with manage permission', async () => {
    process.env.MASTERLION_RESOURCE_ACL_STRICT = '1';
    const { repository, service } = createService({});

    await expect(
      service.assertCan({
        db: {} as any,
        ownerUserId: 'user-1',
        permission: 'manage',
        resource: { resourceId: 'doc-1', resourceType: 'document' },
        userId: 'user-1',
        workspaceId: null,
      }),
    ).resolves.toMatchObject({ permission: 'manage', source: 'owner' });

    expect(repository.getEffectivePermission).not.toHaveBeenCalled();
  });

  it('does not treat workspace members as resource owners', async () => {
    process.env.MASTERLION_RESOURCE_ACL_STRICT = '1';
    const { repository, service } = createService({});

    await expect(
      service.assertCan({
        db: {} as any,
        ownerUserId: 'other-user',
        ownerWorkspaceId: 'workspace-1',
        permission: 'manage',
        resource: { resourceId: 'file-1', resourceType: 'file' },
        userId: 'user-1',
        workspaceId: 'workspace-1',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(repository.getEffectivePermission).toHaveBeenCalledTimes(1);
  });

  it('allows when an ACL grant satisfies the requested permission', async () => {
    process.env.MASTERLION_RESOURCE_ACL_STRICT = '1';
    const { service } = createService({ permission: 'write', source: 'acl' });

    await expect(
      service.assertCan({
        db: {} as any,
        permission: 'read',
        resource: { resourceId: 'kb-1', resourceType: 'knowledge_base' },
        userId: 'user-1',
        workspaceId: 'workspace-1',
      }),
    ).resolves.toMatchObject({ permission: 'write', source: 'acl' });
  });

  it('denies when the effective ACL is weaker than the requested permission in strict mode', async () => {
    process.env.MASTERLION_RESOURCE_ACL_STRICT = '1';
    const { service } = createService({ permission: 'read', source: 'acl' });

    await expect(
      service.assertCan({
        db: {} as any,
        permission: 'write',
        resource: { resourceId: 'kb-1', resourceType: 'knowledge_base' },
        userId: 'user-1',
        workspaceId: 'workspace-1',
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('allows legacy access when no ACL exists and strict mode is disabled', async () => {
    process.env.MASTERLION_RESOURCE_ACL_STRICT = '0';
    const { service } = createService({});

    await expect(
      service.assertCan({
        db: {} as any,
        permission: 'manage',
        resource: { resourceId: 'kb-1', resourceType: 'knowledge_base' },
        userId: 'user-1',
        workspaceId: 'workspace-1',
      }),
    ).resolves.toMatchObject({
      legacyAllowed: true,
      permission: 'manage',
      source: 'legacy',
    });
  });

  it('denies missing ACLs when legacy fallback is disabled', async () => {
    process.env.MASTERLION_RESOURCE_ACL_STRICT = '0';
    const { service } = createService({});

    await expect(
      service.assertCan({
        allowLegacyFallback: false,
        db: {} as any,
        permission: 'manage',
        resource: { resourceId: 'kb-1', resourceType: 'knowledge_base' },
        userId: 'user-1',
        workspaceId: 'workspace-1',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('denies when no ACL exists and strict mode is enabled', async () => {
    process.env.MASTERLION_RESOURCE_ACL_STRICT = '1';
    const { service } = createService({});

    await expect(
      service.assertCan({
        db: {} as any,
        permission: 'read',
        resource: { resourceId: 'kb-1', resourceType: 'knowledge_base' },
        userId: 'user-1',
        workspaceId: 'workspace-1',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Missing resource permission: read',
    });
  });

  it('resolves file ACL inheritance through document ancestors and knowledge base', async () => {
    const db = {
      query: {
        documents: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce({
              fileType: 'custom/folder',
              id: 'folder-1',
              knowledgeBaseId: null,
              parentId: 'doc-1',
              userId: 'owner-1',
              workspaceId: 'workspace-1',
            })
            .mockResolvedValueOnce({
              fileType: 'text/markdown',
              id: 'doc-1',
              knowledgeBaseId: 'kb-1',
              parentId: null,
              userId: 'owner-1',
              workspaceId: 'workspace-1',
            }),
        },
        files: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'file-1',
            parentId: 'folder-1',
            userId: 'owner-1',
            workspaceId: 'workspace-1',
          }),
        },
        knowledgeBaseFiles: {
          findFirst: vi.fn().mockResolvedValue({ knowledgeBaseId: 'kb-link-ignored' }),
        },
      },
    };

    await expect(
      resolveResourceAclScope(db as any, { resourceId: 'file-1', resourceType: 'file' }),
    ).resolves.toMatchObject({
      exists: true,
      ownerUserId: 'owner-1',
      ownerWorkspaceId: 'workspace-1',
      resourceChain: [
        { resourceId: 'file-1', resourceType: 'file' },
        { resourceId: 'folder-1', resourceType: 'folder' },
        { resourceId: 'doc-1', resourceType: 'document' },
        { resourceId: 'kb-1', resourceType: 'knowledge_base' },
      ],
    });
  });
});
