// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResourceAccessControlRow } from '@/database/repositories/enterprise/resourceAclRepository';
import { resourceAclService } from '@/server/services/enterprise/resourceAclService';

import { resourcePermissionRouter } from './resourcePermission';

vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const { publicProcedure } = await import('@/libs/trpc/lambda');

  return { wsCompatProcedure: publicProcedure };
});

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: vi.fn((opts: any) => opts.next({ ctx: opts.ctx })),
}));

const makeAclRow = (row: Partial<ResourceAccessControlRow>): ResourceAccessControlRow =>
  ({
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    createdBy: null,
    id: 'acl-1',
    inheritedFromId: null,
    permission: 'manage',
    principalId: 'user-1',
    principalType: 'user',
    resourceId: 'kb-1',
    resourceType: 'knowledge_base',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    workspaceId: 'workspace-1',
    ...row,
  }) as ResourceAccessControlRow;

const createDb = ({
  aclRows = [],
  documents = [],
  file,
  knowledgeBase,
  knowledgeBaseFile,
}: {
  aclRows?: ResourceAccessControlRow[];
  documents?: any[];
  file?: any;
  knowledgeBase?: any;
  knowledgeBaseFile?: any;
} = {}) => {
  const documentRows = [...documents];

  return {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [
          makeAclRow({
            createdBy: 'user-1',
            principalId: 'user-2',
            resourceId: knowledgeBase?.id ?? 'kb-1',
          }),
        ]),
      })),
    })),
    query: {
      agentSkills: { findFirst: vi.fn() },
      documents: { findFirst: vi.fn(async () => documentRows.shift()) },
      files: { findFirst: vi.fn(async () => file) },
      knowledgeBaseFiles: { findFirst: vi.fn(async () => knowledgeBaseFile) },
      knowledgeBases: { findFirst: vi.fn(async () => knowledgeBase) },
      resourceAccessControls: { findFirst: vi.fn(async () => undefined) },
      userConnectors: { findFirst: vi.fn() },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => aclRows),
      })),
    })),
    update: vi.fn(),
  };
};

describe('resourcePermissionRouter', () => {
  const originalStrictMode = process.env.MASTERLION_RESOURCE_ACL_STRICT;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();

    if (originalStrictMode === undefined) {
      delete process.env.MASTERLION_RESOURCE_ACL_STRICT;
      return;
    }

    process.env.MASTERLION_RESOURCE_ACL_STRICT = originalStrictMode;
  });

  it('does not allow grant through legacy fallback when strict mode is disabled', async () => {
    process.env.MASTERLION_RESOURCE_ACL_STRICT = '0';
    const db = createDb({
      knowledgeBase: {
        id: 'kb-1',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
      },
    });
    const caller = resourcePermissionRouter.createCaller({
      serverDB: db,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as any);

    await expect(
      caller.grant({
        permission: 'read',
        principalId: 'user-2',
        principalType: 'user',
        resourceId: 'kb-1',
        resourceType: 'knowledge_base',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(db.insert).not.toHaveBeenCalled();
  });

  it('requires an existing resource before listing grants', async () => {
    process.env.MASTERLION_RESOURCE_ACL_STRICT = '0';
    const db = createDb();
    const caller = resourcePermissionRouter.createCaller({
      serverDB: db,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as any);

    await expect(
      caller.listGrants({ resourceId: 'missing-kb', resourceType: 'knowledge_base' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('allows listGrants with an existing manage ACL', async () => {
    process.env.MASTERLION_RESOURCE_ACL_STRICT = '1';
    const manageAcl = makeAclRow({
      principalId: 'user-1',
      resourceId: 'kb-1',
      workspaceId: 'workspace-1',
    });
    const db = createDb({
      aclRows: [manageAcl],
      knowledgeBase: {
        id: 'kb-1',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
      },
    });
    const caller = resourcePermissionRouter.createCaller({
      serverDB: db,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as any);

    await expect(
      caller.listGrants({ resourceId: 'kb-1', resourceType: 'knowledge_base' }),
    ).resolves.toEqual([manageAcl]);
  });

  it('uses the resolved file inheritance chain for effective permission lookup', async () => {
    const getEffectivePermissionSpy = vi
      .spyOn(resourceAclService, 'getEffectivePermission')
      .mockResolvedValue({
        inheritedFrom: { resourceId: 'kb-1', resourceType: 'knowledge_base' },
        permission: 'read',
        resource: { resourceId: 'kb-1', resourceType: 'knowledge_base' },
        source: 'acl',
      });
    const db = createDb({
      documents: [
        {
          fileType: 'custom/folder',
          id: 'folder-1',
          knowledgeBaseId: 'kb-1',
          parentId: null,
          userId: 'owner-1',
          workspaceId: 'workspace-1',
        },
      ],
      file: {
        id: 'file-1',
        parentId: 'folder-1',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
      },
      knowledgeBaseFile: { knowledgeBaseId: 'kb-from-link' },
    });
    const caller = resourcePermissionRouter.createCaller({
      serverDB: db,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as any);

    await caller.getEffectivePermissions({ resourceId: 'file-1', resourceType: 'file' });

    expect(getEffectivePermissionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: 'owner-1',
        ownerWorkspaceId: 'workspace-1',
        resource: { resourceId: 'file-1', resourceType: 'file' },
        resourceChain: [
          { resourceId: 'file-1', resourceType: 'file' },
          { resourceId: 'folder-1', resourceType: 'folder' },
          { resourceId: 'kb-1', resourceType: 'knowledge_base' },
        ],
      }),
    );
  });
});
