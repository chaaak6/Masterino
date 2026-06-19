// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  bestPermission,
  permissionSatisfies,
  type GrantResourceAclParams,
  type ResourceAccessControlRow,
  ResourceAclRepository,
  type ResourceAclStore,
} from './resourceAclRepository';

class MemoryResourceAclStore implements ResourceAclStore {
  inserted: GrantResourceAclParams[] = [];
  rows: ResourceAccessControlRow[];
  updated: Array<{ id: string; values: Pick<GrantResourceAclParams, 'createdBy' | 'permission'> }> =
    [];

  constructor(rows: ResourceAccessControlRow[] = []) {
    this.rows = [...rows];
  }

  findGrant = async (params: Omit<GrantResourceAclParams, 'createdBy' | 'permission'>) =>
    this.rows.find(
      (row) =>
        (row.workspaceId ?? null) === (params.workspaceId ?? null) &&
        row.resourceType === params.resourceType &&
        row.resourceId === params.resourceId &&
        row.principalType === params.principalType &&
        row.principalId === params.principalId,
    );

  insertGrant = async (params: GrantResourceAclParams) => {
    this.inserted.push(params);
    const row = makeRow({
      ...params,
      id: `acl-${this.rows.length + 1}`,
      workspaceId: params.workspaceId ?? null,
    });
    this.rows.push(row);
    return row;
  };

  listEffectiveLookup = async ({
    principals,
    resourceChain,
    workspaceId,
  }: Parameters<ResourceAclStore['listEffectiveLookup']>[0]) =>
    this.rows.filter(
      (row) =>
        (row.workspaceId ?? null) === (workspaceId ?? null) &&
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

  listForResource = async ({
    resourceId,
    resourceType,
    workspaceId,
  }: Parameters<ResourceAclStore['listForResource']>[0]) =>
    this.rows.filter(
      (row) =>
        (row.workspaceId ?? null) === (workspaceId ?? null) &&
        row.resourceType === resourceType &&
        row.resourceId === resourceId,
    );

  updateGrant = async (
    id: string,
    values: Pick<GrantResourceAclParams, 'createdBy' | 'permission'>,
  ) => {
    this.updated.push({ id, values });
    const row = this.rows.find((item) => item.id === id);
    if (!row) throw new Error(`Missing row ${id}`);
    row.permission = values.permission;
    row.createdBy = values.createdBy ?? row.createdBy;
    return row;
  };
}

const makeRow = (
  row: Partial<ResourceAccessControlRow> &
    Pick<
      ResourceAccessControlRow,
      'id' | 'principalId' | 'principalType' | 'resourceId' | 'resourceType'
    >,
): ResourceAccessControlRow => ({
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  createdBy: null,
  inheritedFromId: null,
  permission: 'read',
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  workspaceId: null,
  ...row,
});

describe('resourceAclRepository', () => {
  it('ranks permissions by read, write, manage', () => {
    expect(permissionSatisfies('manage', 'read')).toBe(true);
    expect(permissionSatisfies('write', 'read')).toBe(true);
    expect(permissionSatisfies('read', 'write')).toBe(false);
    expect(permissionSatisfies('write', 'manage')).toBe(false);
  });

  it('selects the best permission without mutating the input array', () => {
    const permissions = ['read', 'manage', 'write'] as const;
    const before = [...permissions];

    expect(bestPermission(permissions)).toBe('manage');
    expect(permissions).toEqual(before);
  });

  it('uses the nearest resource in the chain even when a parent has a stronger grant', async () => {
    const store = new MemoryResourceAclStore([
      makeRow({
        id: 'parent-manage',
        permission: 'manage',
        principalId: 'user-1',
        principalType: 'user',
        resourceId: 'kb-1',
        resourceType: 'knowledge_base',
        workspaceId: 'workspace-1',
      }),
      makeRow({
        id: 'child-read',
        permission: 'read',
        principalId: 'user-1',
        principalType: 'user',
        resourceId: 'doc-1',
        resourceType: 'document',
        workspaceId: 'workspace-1',
      }),
    ]);
    const repository = new ResourceAclRepository({} as any, store);

    await expect(
      repository.getEffectivePermission({
        principals: [{ principalId: 'user-1', principalType: 'user' }],
        resourceChain: [
          { resourceId: 'doc-1', resourceType: 'document' },
          { resourceId: 'kb-1', resourceType: 'knowledge_base' },
        ],
        workspaceId: 'workspace-1',
      }),
    ).resolves.toMatchObject({
      inheritedFrom: undefined,
      permission: 'read',
      resource: { resourceId: 'doc-1', resourceType: 'document' },
    });
  });

  it('inherits a knowledge base grant to a file through the resource chain', async () => {
    const store = new MemoryResourceAclStore([
      makeRow({
        id: 'kb-read',
        permission: 'read',
        principalId: 'user-1',
        principalType: 'user',
        resourceId: 'kb-1',
        resourceType: 'knowledge_base',
        workspaceId: 'workspace-1',
      }),
    ]);
    const repository = new ResourceAclRepository({} as any, store);

    await expect(
      repository.getEffectivePermission({
        principals: [{ principalId: 'user-1', principalType: 'user' }],
        resourceChain: [
          { resourceId: 'file-1', resourceType: 'file' },
          { resourceId: 'kb-1', resourceType: 'knowledge_base' },
        ],
        workspaceId: 'workspace-1',
      }),
    ).resolves.toMatchObject({
      inheritedFrom: { aclId: 'kb-read', resourceId: 'kb-1', resourceType: 'knowledge_base' },
      permission: 'read',
      resource: { resourceId: 'kb-1', resourceType: 'knowledge_base' },
    });
  });

  it('keeps global and workspace scopes distinct', async () => {
    const store = new MemoryResourceAclStore([
      makeRow({
        id: 'global-manage',
        permission: 'manage',
        principalId: 'user-1',
        principalType: 'user',
        resourceId: 'kb-1',
        resourceType: 'knowledge_base',
        workspaceId: null,
      }),
      makeRow({
        id: 'workspace-read',
        permission: 'read',
        principalId: 'user-1',
        principalType: 'user',
        resourceId: 'kb-1',
        resourceType: 'knowledge_base',
        workspaceId: 'workspace-1',
      }),
    ]);
    const repository = new ResourceAclRepository({} as any, store);

    await expect(
      repository.getEffectivePermission({
        principals: [{ principalId: 'user-1', principalType: 'user' }],
        resourceChain: [{ resourceId: 'kb-1', resourceType: 'knowledge_base' }],
        workspaceId: 'workspace-1',
      }),
    ).resolves.toMatchObject({ aclId: 'workspace-read', permission: 'read' });

    await expect(
      repository.getEffectivePermission({
        principals: [{ principalId: 'user-1', principalType: 'user' }],
        resourceChain: [{ resourceId: 'kb-1', resourceType: 'knowledge_base' }],
        workspaceId: null,
      }),
    ).resolves.toMatchObject({ aclId: 'global-manage', permission: 'manage' });
  });

  it('updates an existing grant in the same scope and inserts for a distinct workspace scope', async () => {
    const store = new MemoryResourceAclStore([
      makeRow({
        id: 'existing-global',
        permission: 'read',
        principalId: 'user-1',
        principalType: 'user',
        resourceId: 'file-1',
        resourceType: 'file',
        workspaceId: null,
      }),
    ]);
    const repository = new ResourceAclRepository({} as any, store);

    await expect(
      repository.grant({
        createdBy: 'admin-1',
        permission: 'write',
        principalId: 'user-1',
        principalType: 'user',
        resourceId: 'file-1',
        resourceType: 'file',
        workspaceId: null,
      }),
    ).resolves.toMatchObject({ id: 'existing-global', permission: 'write' });

    expect(store.updated).toEqual([
      { id: 'existing-global', values: { createdBy: 'admin-1', permission: 'write' } },
    ]);
    expect(store.inserted).toHaveLength(0);

    await expect(
      repository.grant({
        createdBy: 'admin-1',
        permission: 'manage',
        principalId: 'user-1',
        principalType: 'user',
        resourceId: 'file-1',
        resourceType: 'file',
        workspaceId: 'workspace-1',
      }),
    ).resolves.toMatchObject({ permission: 'manage', workspaceId: 'workspace-1' });

    expect(store.inserted).toEqual([
      {
        createdBy: 'admin-1',
        permission: 'manage',
        principalId: 'user-1',
        principalType: 'user',
        resourceId: 'file-1',
        resourceType: 'file',
        workspaceId: 'workspace-1',
      },
    ]);
  });
});
