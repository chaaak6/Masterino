// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { NewApiProvisioningAdapter } from './provisioningAdapter';

const adminAuth = {
  accessToken: 'admin-token',
  newApiUserId: 1,
};

type AihubProvisioningPolicy = {
  autoCreateUser: boolean;
  enabled: boolean;
  initialQuota: number;
  lookupField: 'email' | 'employeeNumber' | 'mobile' | string;
  managedTokenName: string;
  managedTokenQuota: number;
  managedTokenUnlimitedQuota: boolean;
  userGroup?: string;
};

const defaultAihubProvisioning: AihubProvisioningPolicy = {
  autoCreateUser: true,
  enabled: true,
  initialQuota: 1000,
  lookupField: 'employeeNumber',
  managedTokenName: 'masterlion-managed',
  managedTokenQuota: 200,
  managedTokenUnlimitedQuota: false,
  userGroup: 'staff',
};

const createPolicy = (overrides: Partial<AihubProvisioningPolicy> = {}) => ({
  aihubProvisioning: {
    ...defaultAihubProvisioning,
    ...overrides,
  },
  defaultRole: 'member',
});

const enterpriseUserInput = {
  email: 'ada@example.com',
  employeeNumber: 'E-1001',
  name: 'Ada Lovelace',
  policy: createPolicy(),
  userId: 'user-ada',
};

const createClient = () => ({
  createToken: vi.fn(),
  createUser: vi.fn(),
  listTokens: vi.fn(),
  searchUsers: vi.fn(),
});

const createAdapter = (client = createClient()) =>
  new NewApiProvisioningAdapter({
    adminAuth,
    client: client as any,
  });

describe('NewApiProvisioningAdapter', () => {
  it('exposes provisionEnterpriseUser for enterprise identity provisioning', () => {
    const adapter = createAdapter();

    expect(adapter.provisionEnterpriseUser).toBeTypeOf('function');
  });

  it('looks up by employee number and reuses an existing managed token', async () => {
    const client = createClient();
    client.searchUsers.mockResolvedValue({
      items: [{ email: 'ada@example.com', id: 9001, username: 'E-1001' }],
      total: 1,
    });
    client.listTokens.mockResolvedValue({
      items: [
        {
          id: 8001,
          name: 'masterlion-managed',
          remain_quota: 200,
          unlimited_quota: false,
          user_id: 9001,
        },
      ],
      total: 1,
    });
    const adapter = createAdapter(client);

    const result = await adapter.provisionEnterpriseUser(enterpriseUserInput);

    expect(result).toEqual({
      managedTokenId: 8001,
      newApiUserId: 9001,
      status: 'active',
    });
    expect(client.searchUsers).toHaveBeenCalledWith(
      adminAuth,
      expect.objectContaining({ keyword: 'E-1001' }),
    );
    expect(client.searchUsers).not.toHaveBeenCalledWith(
      adminAuth,
      expect.objectContaining({ keyword: 'ada@example.com' }),
    );
    expect(client.listTokens).toHaveBeenCalledWith(
      adminAuth,
      expect.objectContaining({ keyword: 'masterlion-managed' }),
    );
    expect(client.createUser).not.toHaveBeenCalled();
    expect(client.createToken).not.toHaveBeenCalled();
  });

  it('creates an Aihub user and managed token from the provisioning policy when lookup misses', async () => {
    const client = createClient();
    const createdUser = {
      display_name: 'Ada Lovelace',
      email: 'ada@example.com',
      group: 'staff',
      id: 9002,
      quota: 1000,
      username: 'E-1001',
    };
    const createdToken = {
      id: 8002,
      name: 'masterlion-managed',
      remain_quota: 500,
      unlimited_quota: true,
      user_id: 9002,
    };
    client.searchUsers
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValueOnce({ items: [createdUser], total: 1 });
    client.createUser.mockResolvedValue(createdUser);
    client.listTokens
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValueOnce({ items: [createdToken], total: 1 });
    client.createToken.mockResolvedValue(createdToken);
    const adapter = createAdapter(client);

    const result = await adapter.provisionEnterpriseUser({
      ...enterpriseUserInput,
      policy: createPolicy({
        managedTokenQuota: 500,
        managedTokenUnlimitedQuota: true,
      }),
    });

    expect(result).toEqual({
      managedTokenId: 8002,
      newApiUserId: 9002,
      status: 'active',
    });
    expect(client.searchUsers).toHaveBeenNthCalledWith(
      1,
      adminAuth,
      expect.objectContaining({ keyword: 'E-1001' }),
    );
    expect(client.createUser).toHaveBeenCalledWith(
      adminAuth,
      expect.objectContaining({
        email: 'ada@example.com',
        quota: 1000,
        username: 'E-1001',
      }),
    );
    const createUserInput = client.createUser.mock.calls[0]?.[1] as Record<string, unknown>;
    expect([createUserInput.display_name, createUserInput.name]).toContain('Ada Lovelace');
    expect([createUserInput.group, createUserInput.userGroup]).toContain('staff');
    expect(client.createToken).toHaveBeenCalledWith(
      adminAuth,
      expect.objectContaining({
        name: 'masterlion-managed',
        remain_quota: 500,
        unlimited_quota: true,
      }),
    );
  });

  it('rejects created users when Aihub returns a mismatched identity', async () => {
    const client = createClient();
    client.searchUsers
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValueOnce({ items: [], total: 0 });
    client.createUser.mockResolvedValue({
      email: 'other@example.com',
      id: 9003,
      username: 'OTHER-1001',
    });
    const adapter = createAdapter(client);

    await expect(adapter.provisionEnterpriseUser(enterpriseUserInput)).rejects.toThrow(
      /Aihub created user identity mismatch/i,
    );
    expect(client.createToken).not.toHaveBeenCalled();
  });

  it('ignores same-name tokens that do not belong to the target Aihub user', async () => {
    const client = createClient();
    client.searchUsers.mockResolvedValue({
      items: [{ email: 'ada@example.com', id: 9001, username: 'E-1001' }],
      total: 1,
    });
    client.listTokens
      .mockResolvedValueOnce({
        items: [{ id: 7001, name: 'masterlion-managed', user_id: 7777 }],
        total: 1,
      })
      .mockResolvedValueOnce({
        items: [{ id: 8001, name: 'masterlion-managed', user_id: 9001 }],
        total: 1,
      });
    client.createToken.mockResolvedValue({
      id: 8001,
      name: 'masterlion-managed',
      user_id: 9001,
    });
    const adapter = createAdapter(client);

    await expect(adapter.provisionEnterpriseUser(enterpriseUserInput)).resolves.toEqual({
      managedTokenId: 8001,
      newApiUserId: 9001,
      status: 'active',
    });
    expect(client.createToken).toHaveBeenCalledTimes(1);
  });

  it('throws a clear error when autoCreateUser is disabled and lookup misses', async () => {
    const client = createClient();
    client.searchUsers.mockResolvedValue({ items: [], total: 0 });
    const adapter = createAdapter(client);

    await expect(
      adapter.provisionEnterpriseUser({
        ...enterpriseUserInput,
        employeeNumber: 'E-404',
        policy: createPolicy({ autoCreateUser: false }),
      }),
    ).rejects.toThrow(/Aihub user.*E-404.*ada@example.com.*autoCreateUser/i);
    expect(client.searchUsers).toHaveBeenNthCalledWith(
      1,
      adminAuth,
      expect.objectContaining({ keyword: 'E-404' }),
    );
    expect(client.searchUsers).toHaveBeenNthCalledWith(
      2,
      adminAuth,
      expect.objectContaining({ keyword: 'ada@example.com' }),
    );
    expect(client.createUser).not.toHaveBeenCalled();
    expect(client.createToken).not.toHaveBeenCalled();
  });

  it('falls back to email lookup when employee number lookup misses', async () => {
    const client = createClient();
    client.searchUsers
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValueOnce({
        items: [{ email: 'ada@example.com', id: 9001, username: 'ada-email' }],
        total: 1,
      });
    client.listTokens.mockResolvedValue({
      items: [
        { id: 8001, name: 'masterlion-managed', remain_quota: 200, unlimited_quota: false, user_id: 9001 },
      ],
      total: 1,
    });
    const adapter = createAdapter(client);

    const result = await adapter.provisionEnterpriseUser(enterpriseUserInput);

    expect(result).toEqual({
      managedTokenId: 8001,
      newApiUserId: 9001,
      status: 'active',
    });
    expect(client.searchUsers).toHaveBeenNthCalledWith(
      1,
      adminAuth,
      expect.objectContaining({ keyword: 'E-1001' }),
    );
    expect(client.searchUsers).toHaveBeenNthCalledWith(
      2,
      adminAuth,
      expect.objectContaining({ keyword: 'ada@example.com' }),
    );
    expect(client.createUser).not.toHaveBeenCalled();
  });

  it('skips email fallback when lookupField is already email', async () => {
    const client = createClient();
    client.searchUsers.mockResolvedValue({ items: [], total: 0 });
    const adapter = createAdapter(client);

    await expect(
      adapter.provisionEnterpriseUser({
        ...enterpriseUserInput,
        policy: createPolicy({ autoCreateUser: false, lookupField: 'email' }),
      }),
    ).rejects.toThrow(/Aihub user.*ada@example.com.*autoCreateUser/i);
    expect(client.searchUsers).toHaveBeenCalledTimes(1);
    expect(client.searchUsers).toHaveBeenCalledWith(
      adminAuth,
      expect.objectContaining({ keyword: 'ada@example.com' }),
    );
  });

  it('skips email fallback when input has no email', async () => {
    const client = createClient();
    client.searchUsers.mockResolvedValue({ items: [], total: 0 });
    const adapter = createAdapter(client);

    await expect(
      adapter.provisionEnterpriseUser({
        ...enterpriseUserInput,
        email: undefined,
        policy: createPolicy({ autoCreateUser: false }),
      }),
    ).rejects.toThrow(/Aihub user.*E-1001.*autoCreateUser/i);
    expect(client.searchUsers).toHaveBeenCalledTimes(1);
  });

  it('propagates token initialization errors after resolving a valid Aihub user', async () => {
    const tokenError = new Error('NewAPI token initialization failed');
    const client = createClient();
    client.searchUsers.mockResolvedValue({
      items: [{ email: 'ada@example.com', id: 9001, username: 'E-1001' }],
      total: 1,
    });
    client.listTokens.mockResolvedValue({ items: [], total: 0 });
    client.createToken.mockRejectedValue(tokenError);
    const adapter = createAdapter(client);

    await expect(adapter.provisionEnterpriseUser(enterpriseUserInput)).rejects.toBe(tokenError);
  });

  it('reassigns newly created token to the target user via the bridge', async () => {
    const client = createClient();
    client.searchUsers.mockResolvedValue({
      items: [{ email: 'ada@example.com', id: 9001, username: 'E-1001' }],
      total: 1,
    });
    const createdToken = {
      id: 8003,
      name: 'masterlion-managed',
      remain_quota: 200,
      unlimited_quota: false,
      user_id: 1,
    };
    client.listTokens
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValueOnce({ items: [createdToken], total: 1 });
    client.createToken.mockResolvedValue(createdToken);

    const bridgeClient = {
      findManagedToken: vi.fn().mockResolvedValue(undefined),
      isEnabled: () => true,
      reassignToken: vi.fn().mockResolvedValue(true),
    };

    const adapter = new NewApiProvisioningAdapter({
      adminAuth,
      bridgeClient: bridgeClient as any,
      client: client as any,
    });

    const result = await adapter.provisionEnterpriseUser({
      ...enterpriseUserInput,
      masterLionUsername: 'ada',
    });

    expect(result).toEqual({
      managedTokenId: 8003,
      newApiUserId: 9001,
      status: 'active',
    });
    expect(bridgeClient.reassignToken).toHaveBeenCalledWith(8003, 9001, 'MasterLion_ada');
  });

  it('continues without error when bridge reassign fails (degraded mode)', async () => {
    const client = createClient();
    client.searchUsers.mockResolvedValue({
      items: [{ email: 'ada@example.com', id: 9001, username: 'E-1001' }],
      total: 1,
    });
    const createdToken = {
      id: 8004,
      name: 'masterlion-managed',
      remain_quota: 200,
      unlimited_quota: false,
      user_id: 1,
    };
    client.listTokens
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValueOnce({ items: [createdToken], total: 1 });
    client.createToken.mockResolvedValue(createdToken);

    const bridgeClient = {
      findManagedToken: vi.fn().mockResolvedValue(undefined),
      isEnabled: () => true,
      reassignToken: vi.fn().mockResolvedValue(false),
    };

    const adapter = new NewApiProvisioningAdapter({
      adminAuth,
      bridgeClient: bridgeClient as any,
      client: client as any,
    });

    const result = await adapter.provisionEnterpriseUser(enterpriseUserInput);

    expect(result).toEqual({
      managedTokenId: 8004,
      newApiUserId: 9001,
      status: 'active',
    });
    expect(bridgeClient.reassignToken).toHaveBeenCalled();
  });
});
