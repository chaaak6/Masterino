// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { NewApiError } from './client';
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
  // Regression guard: provisioning must not mutate wallet quota through Aihub PUT /api/user/.
  // Its update handler replaces omitted identity fields, including username, with empty values.
  updateUser: vi.fn(),
});

const createBridgeClient = (overrides: Record<string, unknown> = {}) => ({
  findManagedToken: vi.fn().mockResolvedValue(undefined),
  findManagedTokenById: vi.fn().mockResolvedValue(undefined),
  findUserById: vi.fn().mockResolvedValue(undefined),
  findUserByIdentity: vi.fn().mockResolvedValue(undefined),
  isEnabled: () => true,
  linkOAuthBinding: vi.fn().mockResolvedValue({ status: 'existing' }),
  listManagedTokens: vi.fn().mockResolvedValue([]),
  reassignToken: vi.fn().mockResolvedValue(true),
  ...overrides,
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

    expect(result).toMatchObject({
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
      expect.objectContaining({ keyword: 'Masterino_E-1001' }),
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
      name: 'Masterino_E-1001',
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

    expect(result).toMatchObject({
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
        password: expect.any(String),
        quota: 1000,
        username: 'E-1001',
      }),
    );
    const createUserInput = client.createUser.mock.calls[0]?.[1] as Record<string, unknown>;
    expect([createUserInput.display_name, createUserInput.name]).toContain('Ada Lovelace');
    expect([createUserInput.group, createUserInput.userGroup]).toContain('staff');
    expect(createUserInput.password).toMatch(/^[0-9a-z]{20}$/);
    expect(client.createToken).toHaveBeenCalledWith(
      adminAuth,
      expect.objectContaining({
        name: 'Masterino_E-1001',
        remain_quota: 500,
        unlimited_quota: true,
      }),
    );
  });

  it('creates the canonical token when the optional legacy token name is not configured', async () => {
    const client = createClient();
    client.searchUsers.mockResolvedValue({
      items: [{ email: 'ada@example.com', id: 9001, username: 'E-1001' }],
      total: 1,
    });
    let created = false;
    client.listTokens.mockImplementation(async () => ({
      items: created ? [{ id: 8005, name: 'Masterino_E-1001', user_id: 9001 }] : [],
      total: created ? 1 : 0,
    }));
    client.createToken.mockImplementation(async () => {
      created = true;
      return { id: 8005, name: 'Masterino_E-1001', user_id: 9001 };
    });
    const adapter = createAdapter(client);

    await expect(
      adapter.provisionEnterpriseUser({
        ...enterpriseUserInput,
        policy: createPolicy({ managedTokenName: undefined }),
      }),
    ).resolves.toMatchObject({ managedTokenId: 8005, newApiUserId: 9001 });
    expect(client.createToken).toHaveBeenCalledWith(
      adminAuth,
      expect.objectContaining({ name: 'Masterino_E-1001' }),
    );
  });

  it('refetches the authoritative user when Aihub omits identity fields on create', async () => {
    // Bug 1a: some NewAPI versions return only {id} on create without echoing
    // back username/email/display_name. Provisioning must not abort over the
    // mismatch — it should re-fetch by id and continue.
    const client = createClient();
    const authoritativeUser = {
      email: 'ada@example.com',
      id: 9003,
      quota: 1000,
      username: 'E-1001',
    };
    client.searchUsers
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValueOnce({ items: [], total: 0 });
    client.createUser.mockResolvedValue({
      email: 'other@example.com',
      id: 9003,
      username: 'OTHER-1001',
    });
    client.listTokens.mockResolvedValue({
      items: [{ id: 8001, name: 'masterlion-managed', user_id: 9003 }],
      total: 1,
    });
    const bridgeClient = createBridgeClient({
      findUserById: vi.fn().mockResolvedValue(authoritativeUser),
    });
    const adapter = new NewApiProvisioningAdapter({
      adminAuth,
      bridgeClient: bridgeClient as any,
      client: client as any,
    });

    const result = await adapter.provisionEnterpriseUser(enterpriseUserInput);

    expect(result).toMatchObject({
      managedTokenId: 8001,
      newApiUserId: 9003,
      status: 'active',
    });
    expect(bridgeClient.findUserById).toHaveBeenCalledWith(9003);
    expect(client.createUser).toHaveBeenCalledTimes(1);
  });

  it('rejects a post-create authoritative user whose username differs from the employee number', async () => {
    const client = createClient();
    client.searchUsers
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValueOnce({ items: [], total: 0 });
    client.createUser.mockResolvedValue({ id: 9003 });
    const bridgeClient = createBridgeClient({
      findUserById: vi.fn().mockResolvedValue({
        email: 'ada@example.com',
        id: 9003,
        username: 'OTHER-1001',
      }),
    });
    const adapter = new NewApiProvisioningAdapter({
      adminAuth,
      bridgeClient: bridgeClient as any,
      client: client as any,
    });

    await expect(adapter.provisionEnterpriseUser(enterpriseUserInput)).rejects.toThrow(
      /identity conflict.*OTHER-1001.*E-1001/i,
    );
    expect(client.listTokens).not.toHaveBeenCalled();
  });

  it('never reassigns a shared legacy token owned by another Aihub user', async () => {
    const client = createClient();
    client.searchUsers.mockResolvedValue({
      items: [{ email: 'ada@example.com', id: 9001, username: 'E-1001' }],
      total: 1,
    });
    let canonicalCreated = false;
    client.listTokens.mockImplementation(async (_auth, query) => ({
      items:
        query.keyword === 'masterlion-managed'
          ? [{ id: 7001, name: 'masterlion-managed', user_id: 7777 }]
          : canonicalCreated
            ? [{ id: 8001, name: 'Masterino_E-1001', user_id: 1 }]
            : [],
      total: query.keyword === 'masterlion-managed' || canonicalCreated ? 1 : 0,
    }));
    client.createToken.mockImplementation(async () => {
      canonicalCreated = true;
      return {
        id: 8001,
        name: 'Masterino_E-1001',
        user_id: 1,
      };
    });
    const bridgeClient = createBridgeClient();
    const adapter = new NewApiProvisioningAdapter({
      adminAuth,
      bridgeClient: bridgeClient as any,
      client: client as any,
    });

    await expect(adapter.provisionEnterpriseUser(enterpriseUserInput)).resolves.toMatchObject({
      managedTokenId: 8001,
      newApiUserId: 9001,
    });
    expect(client.createToken).toHaveBeenCalledWith(
      adminAuth,
      expect.objectContaining({ name: 'Masterino_E-1001' }),
    );
    expect(bridgeClient.reassignToken).toHaveBeenCalledWith(8001, 9001);
    expect(bridgeClient.reassignToken).not.toHaveBeenCalledWith(7001, 9001);
  });

  it('never claims an admin-owned shared legacy token for the current user', async () => {
    const client = createClient();
    client.searchUsers.mockResolvedValue({
      items: [{ email: 'ada@example.com', id: 9001, username: 'E-1001' }],
      total: 1,
    });
    let canonicalCreated = false;
    client.listTokens.mockImplementation(async (_auth, query) => ({
      items:
        query.keyword === 'masterlion-managed'
          ? [{ id: 7001, name: 'masterlion-managed', user_id: 1 }]
          : canonicalCreated
            ? [{ id: 8001, name: 'Masterino_E-1001', user_id: 1 }]
            : [],
      total: query.keyword === 'masterlion-managed' || canonicalCreated ? 1 : 0,
    }));
    client.createToken.mockImplementation(async () => {
      canonicalCreated = true;
      return { id: 8001, name: 'Masterino_E-1001', user_id: 1 };
    });
    const bridgeClient = createBridgeClient();
    const adapter = new NewApiProvisioningAdapter({
      adminAuth,
      bridgeClient: bridgeClient as any,
      client: client as any,
    });

    const result = await adapter.provisionEnterpriseUser(enterpriseUserInput);

    expect(result.managedTokenId).toBe(8001);
    expect(bridgeClient.reassignToken).toHaveBeenCalledWith(8001, 9001);
    expect(bridgeClient.reassignToken).not.toHaveBeenCalledWith(7001, 9001);
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

  it('falls back to email lookup when employee number lookup misses and username matches', async () => {
    const client = createClient();
    client.searchUsers.mockResolvedValueOnce({ items: [], total: 0 }).mockResolvedValueOnce({
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

    expect(result).toMatchObject({
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

  it('rejects an email match whose username differs from the employee number and creates a new user instead', async () => {
    // Bug: a user self-registered in Aihub with username "newapi_320" but the
    // same email. The email fallback must NOT bind to that user — it should
    // create a new Aihub user with the correct username (employeeNumber).
    const client = createClient();
    const createdUser = {
      display_name: 'Ada Lovelace',
      email: 'ada@example.com',
      id: 9002,
      quota: 1000,
      username: 'E-1001',
    };
    client.searchUsers
      .mockResolvedValueOnce({ items: [], total: 0 }) // employeeNumber lookup misses
      .mockResolvedValueOnce({
        // email lookup finds wrong user
        items: [{ email: 'ada@example.com', id: 9001, username: 'newapi_9001' }],
        total: 1,
      })
      .mockResolvedValueOnce({ items: [], total: 0 }) // post-create search (if needed)
      .mockResolvedValueOnce({
        // bridge fallback in findUser during createUser
        items: [createdUser],
        total: 1,
      });
    client.createUser.mockResolvedValue(createdUser);
    client.listTokens.mockResolvedValue({
      items: [{ id: 8001, name: 'masterlion-managed', user_id: 9002 }],
      total: 1,
    });
    const adapter = createAdapter(client);

    const result = await adapter.provisionEnterpriseUser(enterpriseUserInput);

    expect(result.newApiUserId).toBe(9002);
    expect(client.createUser).toHaveBeenCalledTimes(1);
    expect(client.createUser).toHaveBeenCalledWith(
      adminAuth,
      expect.objectContaining({ username: 'E-1001' }),
    );
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
      name: 'Masterino_E-1001',
      remain_quota: 200,
      unlimited_quota: false,
      user_id: 1,
    };
    client.listTokens
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValueOnce({ items: [createdToken], total: 1 });
    client.createToken.mockResolvedValue(createdToken);

    const bridgeClient = {
      findManagedToken: vi.fn().mockResolvedValue(undefined),
      isEnabled: () => true,
      linkOAuthBinding: vi.fn().mockResolvedValue(true),
      reassignToken: vi.fn().mockResolvedValue(true),
    };

    const adapter = new NewApiProvisioningAdapter({
      adminAuth,
      bridgeClient: bridgeClient as any,
      client: client as any,
    });

    const result = await adapter.provisionEnterpriseUser({
      ...enterpriseUserInput,
      masterinoUsername: 'E-1001',
    });

    expect(result).toMatchObject({
      managedTokenId: 8003,
      newApiUserId: 9001,
      status: 'active',
    });
    expect(bridgeClient.reassignToken).toHaveBeenCalledWith(8003, 9001);
  });

  it('fails readiness when bridge cannot assign a newly-created token to the target user', async () => {
    const client = createClient();
    client.searchUsers.mockResolvedValue({
      items: [{ email: 'ada@example.com', id: 9001, username: 'E-1001' }],
      total: 1,
    });
    const createdToken = {
      id: 8004,
      name: 'Masterino_E-1001',
      remain_quota: 200,
      unlimited_quota: false,
      user_id: 1,
    };
    client.listTokens
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValueOnce({ items: [createdToken], total: 1 });
    client.createToken.mockResolvedValue(createdToken);

    const bridgeClient = {
      findManagedToken: vi.fn().mockResolvedValue(undefined),
      isEnabled: () => true,
      linkOAuthBinding: vi.fn().mockResolvedValue(true),
      reassignToken: vi.fn().mockResolvedValue(false),
    };

    const adapter = new NewApiProvisioningAdapter({
      adminAuth,
      bridgeClient: bridgeClient as any,
      client: client as any,
    });

    await expect(adapter.provisionEnterpriseUser(enterpriseUserInput)).rejects.toThrow(
      /reassign.*target Aihub user/i,
    );
    expect(bridgeClient.reassignToken).toHaveBeenCalled();
  });

  it('recovers the canonical admin-owned token left by a crash instead of creating another', async () => {
    const client = createClient();
    client.searchUsers.mockResolvedValue({
      items: [{ email: 'ada@example.com', id: 9001, username: 'E-1001' }],
      total: 1,
    });
    client.listTokens.mockResolvedValue({
      items: [{ id: 8100, name: 'Masterino_E-1001', user_id: 1 }],
      total: 1,
    });
    const bridgeClient = createBridgeClient();
    const adapter = new NewApiProvisioningAdapter({
      adminAuth,
      bridgeClient: bridgeClient as any,
      client: client as any,
    });

    const result = await adapter.provisionEnterpriseUser(enterpriseUserInput);

    expect(result.managedTokenId).toBe(8100);
    expect(client.createToken).not.toHaveBeenCalled();
    expect(bridgeClient.reassignToken).toHaveBeenCalledWith(8100, 9001);
  });

  it('queries the legacy managed-token name when the canonical lookup misses', async () => {
    const client = createClient();
    client.searchUsers.mockResolvedValue({
      items: [{ email: 'ada@example.com', id: 9001, username: 'E-1001' }],
      total: 1,
    });
    client.listTokens.mockImplementation(async (_auth, query) => ({
      items:
        query.keyword === 'masterlion-managed'
          ? [{ id: 8101, name: 'masterlion-managed', user_id: 9001 }]
          : [],
      total: query.keyword === 'masterlion-managed' ? 1 : 0,
    }));
    const adapter = createAdapter(client);

    const result = await adapter.provisionEnterpriseUser(enterpriseUserInput);

    expect(result.managedTokenId).toBe(8101);
    expect(client.listTokens).toHaveBeenNthCalledWith(
      1,
      adminAuth,
      expect.objectContaining({ keyword: 'Masterino_E-1001' }),
    );
    expect(client.listTokens).toHaveBeenNthCalledWith(
      2,
      adminAuth,
      expect.objectContaining({ keyword: 'masterlion-managed' }),
    );
    expect(client.createToken).not.toHaveBeenCalled();
  });

  it('prefers the token id already recorded in the Masterino binding', async () => {
    const client = createClient();
    client.searchUsers.mockResolvedValue({
      items: [{ email: 'ada@example.com', id: 9001, username: 'E-1001' }],
      total: 1,
    });
    const bridgeClient = createBridgeClient({
      findManagedTokenById: vi.fn().mockResolvedValue({
        id: 8200,
        name: 'older-custom-name',
        user_id: 9001,
      }),
    });
    const adapter = new NewApiProvisioningAdapter({
      adminAuth,
      bridgeClient: bridgeClient as any,
      client: client as any,
    });

    const result = await adapter.provisionEnterpriseUser({
      ...enterpriseUserInput,
      preferredManagedTokenId: 8200,
    });

    expect(result.managedTokenId).toBe(8200);
    expect(client.listTokens).not.toHaveBeenCalled();
    expect(client.createToken).not.toHaveBeenCalled();
  });

  it('rotates an unusable historical token instead of selecting it again by name', async () => {
    const client = createClient();
    client.searchUsers.mockResolvedValue({
      items: [{ email: 'ada@example.com', id: 9001, username: 'E-1001' }],
      total: 1,
    });
    let canonicalCreated = false;
    client.listTokens.mockImplementation(async (_auth, query) => ({
      items:
        query.keyword === 'Masterino_E-1001' && canonicalCreated
          ? [
              {
                expired_time: -1,
                id: 8301,
                name: 'Masterino_E-1001',
                remain_quota: 200,
                status: 1,
                user_id: 1,
              },
            ]
          : [],
      total: canonicalCreated ? 1 : 0,
    }));
    client.createToken.mockImplementation(async () => {
      canonicalCreated = true;
      return { id: 8301, name: 'Masterino_E-1001', user_id: 1 };
    });
    const unusable = {
      expired_time: 1,
      id: 8200,
      name: 'Masterino_E-1001',
      remain_quota: 0,
      status: 2,
      user_id: 9001,
    };
    const bridgeClient = createBridgeClient({
      findManagedToken: vi.fn().mockResolvedValue(unusable),
      findManagedTokenById: vi.fn().mockResolvedValue(unusable),
    });
    const adapter = new NewApiProvisioningAdapter({
      adminAuth,
      bridgeClient: bridgeClient as any,
      client: client as any,
    });

    const result = await adapter.provisionEnterpriseUser({
      ...enterpriseUserInput,
      preferredManagedTokenId: 8200,
    });

    expect(result.managedTokenId).toBe(8301);
    expect(client.createToken).toHaveBeenCalledOnce();
    expect(bridgeClient.reassignToken).toHaveBeenCalledWith(8301, 9001);
  });

  it('rejects an Aihub identity whose username is not the enterprise employee number', async () => {
    const client = createClient();
    client.searchUsers.mockResolvedValue({
      items: [{ email: 'ada@example.com', id: 9001, username: 'newapi_9001' }],
      total: 1,
    });
    const adapter = createAdapter(client);

    await expect(
      adapter.provisionEnterpriseUser({
        ...enterpriseUserInput,
        policy: createPolicy({ autoCreateUser: false, lookupField: 'email' }),
      }),
    ).rejects.toThrow(/username.*employee number/i);
    expect(client.createToken).not.toHaveBeenCalled();
  });

  it('reuses an existing Aihub user on duplicate-username conflict instead of failing', async () => {
    // Bug 1b: a prior partial provisioning failure may have already created the
    // Aihub user. createUser returns a 400 "username already exists" — provisioning
    // must fall back to lookup + reuse rather than aborting permanently.
    const client = createClient();
    const existingUser = { email: 'ada@example.com', id: 9001, quota: 1000, username: 'E-1001' };
    client.searchUsers
      .mockResolvedValueOnce({ items: [], total: 0 }) // initial lookup misses
      .mockResolvedValueOnce({ items: [], total: 0 }) // email fallback misses
      .mockResolvedValueOnce({ items: [existingUser], total: 1 }); // post-conflict reuse
    const { NewApiError } = await import('./client');
    client.createUser.mockRejectedValue(
      new NewApiError('用户名已存在', 400, { message: '用户名已存在' }),
    );
    client.listTokens.mockResolvedValue({
      items: [{ id: 8001, name: 'masterlion-managed', user_id: 9001 }],
      total: 1,
    });
    const adapter = createAdapter(client);

    const result = await adapter.provisionEnterpriseUser(enterpriseUserInput);

    expect(result).toMatchObject({
      managedTokenId: 8001,
      newApiUserId: 9001,
      status: 'active',
    });
    expect(client.createUser).toHaveBeenCalledTimes(1);
  });

  it('rejects a duplicate-user fallback whose username differs from the employee number', async () => {
    const client = createClient();
    client.searchUsers
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValueOnce({
        items: [{ email: 'E-1001', id: 9001, username: 'OTHER-1001' }],
        total: 1,
      });
    const { NewApiError } = await import('./client');
    client.createUser.mockRejectedValue(
      new NewApiError('username already exists', 409, { message: 'username already exists' }),
    );
    const adapter = createAdapter(client);

    await expect(adapter.provisionEnterpriseUser(enterpriseUserInput)).rejects.toThrow(
      /identity conflict.*OTHER-1001.*E-1001/i,
    );
    expect(client.listTokens).not.toHaveBeenCalled();
  });

  it('rejects a newly-created token that reappears under a different non-admin user', async () => {
    const client = createClient();
    client.searchUsers.mockResolvedValue({
      items: [{ email: 'ada@example.com', id: 9001, username: 'E-1001' }],
      total: 1,
    });
    client.listTokens
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValueOnce({
        items: [{ id: 8300, name: 'Masterino_E-1001', user_id: 7777 }],
        total: 1,
      });
    client.createToken.mockResolvedValue({ id: 8300, name: 'Masterino_E-1001', user_id: 1 });
    const bridgeClient = createBridgeClient();
    const adapter = new NewApiProvisioningAdapter({
      adminAuth,
      bridgeClient: bridgeClient as any,
      client: client as any,
    });

    await expect(adapter.provisionEnterpriseUser(enterpriseUserInput)).rejects.toThrow(
      /identity conflict.*7777/i,
    );
    expect(bridgeClient.reassignToken).not.toHaveBeenCalled();
  });

  it('falls back to the bridge to resolve an existing user when admin search misses', async () => {
    // Bug 1c: admin API search can miss existing users (pagination cap, scope).
    // The bridge's authoritative DB read should rescue the lookup so a duplicate
    // create is not attempted.
    const client = createClient();
    client.searchUsers.mockResolvedValue({ items: [], total: 0 });
    const bridgedUser = { email: 'ada@example.com', id: 9001, quota: 1000, username: 'E-1001' };
    const bridgeClient = createBridgeClient({
      findUserByIdentity: vi.fn().mockResolvedValue(bridgedUser),
    });
    client.listTokens.mockResolvedValue({
      items: [{ id: 8001, name: 'masterlion-managed', user_id: 9001 }],
      total: 1,
    });
    const adapter = new NewApiProvisioningAdapter({
      adminAuth,
      bridgeClient: bridgeClient as any,
      client: client as any,
    });

    const result = await adapter.provisionEnterpriseUser(enterpriseUserInput);

    expect(result).toMatchObject({
      managedTokenId: 8001,
      newApiUserId: 9001,
      status: 'active',
    });
    expect(bridgeClient.findUserByIdentity).toHaveBeenCalledWith({
      email: 'E-1001',
      username: 'E-1001',
    });
    expect(client.createUser).not.toHaveBeenCalled();
  });

  it('does not make an existing Aihub user wallet balance part of readiness', async () => {
    const client = createClient();
    const zeroQuotaUser = { email: 'ada@example.com', id: 9001, quota: 0, username: 'E-1001' };
    client.searchUsers.mockResolvedValue({ items: [zeroQuotaUser], total: 0 });
    client.listTokens.mockResolvedValue({
      items: [{ id: 8001, name: 'masterlion-managed', user_id: 9001 }],
      total: 1,
    });
    const adapter = createAdapter(client);

    const result = await adapter.provisionEnterpriseUser(enterpriseUserInput);

    expect(result).toMatchObject({
      managedTokenId: 8001,
      newApiUserId: 9001,
      status: 'active',
    });
    expect(client.updateUser).not.toHaveBeenCalled();
  });
});
