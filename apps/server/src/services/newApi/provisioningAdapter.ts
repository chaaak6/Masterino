import {
  NewApiClient,
  type NewApiCreateUserInput,
  type NewApiManagementAuth,
  type NewApiToken,
  type NewApiUser,
} from './client';

type LookupField = 'email' | 'employeeNumber' | 'name';

export type AihubProvisioningPolicy = {
  autoCreateUser?: boolean;
  enabled?: boolean;
  initialQuota?: number;
  lookupField?: string;
  managedTokenName?: string;
  managedTokenQuota?: number;
  managedTokenUnlimitedQuota?: boolean;
  userGroup?: string;
};

export type ProvisioningPolicy = {
  aihubProvisioning?: AihubProvisioningPolicy;
  defaultRole?: string;
  [key: string]: unknown;
};

export type ProvisionEnterpriseUserInput = {
  email?: string;
  employeeNumber?: string;
  name?: string;
  policy: ProvisioningPolicy;
  userId: string;
};

export type ProvisionEnterpriseUserResult = {
  managedTokenId?: number;
  newApiUserId?: number;
  status?: unknown;
  [key: string]: unknown;
};

type ProvisioningClient = Pick<
  NewApiClient,
  'createToken' | 'createUser' | 'listTokens' | 'searchUsers'
>;

type NewApiProvisioningAdapterOptions = {
  adminAuth?: NewApiManagementAuth;
  client?: ProvisioningClient;
};

const asTrimmedString = (value: unknown) => {
  if (typeof value !== 'string') return;

  const trimmed = value.trim();
  return trimmed || undefined;
};

const isValidId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

const getAdminAuthFromEnv = (): NewApiManagementAuth => {
  const accessToken = asTrimmedString(process.env.AIHUB_ADMIN_ACCESS_TOKEN);
  const newApiUserId = Number(process.env.AIHUB_ADMIN_USER_ID);

  if (!accessToken) {
    throw new Error('AIHUB_ADMIN_ACCESS_TOKEN is required for Aihub provisioning');
  }

  if (!Number.isInteger(newApiUserId) || newApiUserId <= 0) {
    throw new Error('AIHUB_ADMIN_USER_ID must be a positive integer for Aihub provisioning');
  }

  return {
    accessToken,
    newApiUserId,
  };
};

const getLookupField = (policy: AihubProvisioningPolicy): LookupField => {
  const lookupField = asTrimmedString(policy.lookupField) ?? 'employeeNumber';

  if (lookupField === 'employeeNumber' || lookupField === 'email' || lookupField === 'name') {
    return lookupField;
  }

  throw new Error(
    `Unsupported Aihub provisioning lookupField "${lookupField}". Expected employeeNumber, email, or name.`,
  );
};

const getLookupKeyword = (input: ProvisionEnterpriseUserInput, lookupField: LookupField) => {
  const keyword = asTrimmedString(input[lookupField]);

  if (!keyword) {
    throw new Error(
      `Aihub provisioning lookupField "${lookupField}" requires a non-empty ${lookupField} for user ${input.userId}`,
    );
  }

  return keyword;
};

const findExactUser = (users: NewApiUser[], keyword: string) =>
  users.find((user) => asTrimmedString(user.username) === keyword) ??
  users.find((user) => asTrimmedString(user.email) === keyword) ??
  users.find((user) => asTrimmedString(user.display_name) === keyword);

const isSameUserIdentity = (user: NewApiUser, input: ProvisionEnterpriseUserInput) => {
  const expectedUsername = getCreateUsername(input);
  const expectedEmail = asTrimmedString(input.email);
  const expectedName = asTrimmedString(input.name);

  return (
    asTrimmedString(user.username) === expectedUsername ||
    (!!expectedEmail && asTrimmedString(user.email) === expectedEmail) ||
    (!!expectedName && asTrimmedString(user.display_name) === expectedName)
  );
};

const findExactToken = (tokens: NewApiToken[], name: string, newApiUserId: number) =>
  tokens.find(
    (token) =>
      asTrimmedString(token.name) === name &&
      (token.user_id === undefined || Number(token.user_id) === Number(newApiUserId)),
  );

const getRequiredManagedTokenName = (policy: AihubProvisioningPolicy) => {
  const managedTokenName = asTrimmedString(policy.managedTokenName);

  if (!managedTokenName) {
    throw new Error('Aihub managed token name is required for provisioning');
  }

  return managedTokenName;
};

const getCreateUsername = (input: ProvisionEnterpriseUserInput) => {
  const username =
    asTrimmedString(input.employeeNumber) ??
    asTrimmedString(input.email) ??
    asTrimmedString(input.name);

  if (!username) {
    throw new Error(`Aihub user creation requires employeeNumber, email, or name for ${input.userId}`);
  }

  return username;
};

export class NewApiProvisioningAdapter {
  private adminAuth: NewApiManagementAuth;
  private client: ProvisioningClient;

  constructor(options: NewApiProvisioningAdapterOptions = {}) {
    this.client =
      options.client ??
      new NewApiClient({
        baseUrl: process.env.AIHUB_PROXY_URL ?? '',
      });
    this.adminAuth = options.adminAuth ?? getAdminAuthFromEnv();
  }

  async provisionEnterpriseUser(
    input: ProvisionEnterpriseUserInput,
  ): Promise<ProvisionEnterpriseUserResult> {
    const policy = input.policy.aihubProvisioning ?? {};
    const lookupField = getLookupField(policy);
    const keyword = getLookupKeyword(input, lookupField);
    const managedTokenName = getRequiredManagedTokenName(policy);

    let targetUser = await this.findUser(keyword);

    if (!targetUser) {
      if (!policy.autoCreateUser) {
        throw new Error(
          `Aihub user matching "${keyword}" was not found and autoCreateUser is disabled`,
        );
      }

      targetUser = await this.createUser(input, policy);
    }

    const token = await this.ensureManagedToken(targetUser.id, managedTokenName, policy);

    return {
      managedTokenId: token.id,
      newApiUserId: targetUser.id,
      status: 'active',
    };
  }

  private async findUser(keyword: string) {
    const page = await this.client.searchUsers(this.adminAuth, {
      keyword,
      pageSize: 20,
    });

    return findExactUser(page.items ?? [], keyword);
  }

  private async createUser(
    input: ProvisionEnterpriseUserInput,
    policy: AihubProvisioningPolicy,
  ) {
    const username = getCreateUsername(input);
    const createInput: NewApiCreateUserInput = {
      display_name: asTrimmedString(input.name),
      email: asTrimmedString(input.email),
      group: asTrimmedString(policy.userGroup),
      quota: policy.initialQuota,
      username,
    };

    const createdUser = await this.client.createUser(this.adminAuth, createInput);

    if (isValidId(createdUser.id)) {
      if (!isSameUserIdentity(createdUser, input)) {
        throw new Error(
          `Aihub created user identity mismatch for "${username}": received user ${createdUser.id}`,
        );
      }

      return createdUser;
    }

    const page = await this.client.searchUsers(this.adminAuth, {
      keyword: username,
      pageSize: 20,
    });
    const targetUser = findExactUser(page.items ?? [], username);

    if (targetUser && isValidId(targetUser.id)) {
      return targetUser;
    }

    throw new Error(`Aihub user "${username}" was created but no NewAPI user id was returned`);
  }

  private async ensureManagedToken(
    newApiUserId: number,
    managedTokenName: string,
    policy: AihubProvisioningPolicy,
  ) {
    // Token management must use the admin's own credentials — the Aihub backend
    // verifies that New-Api-User matches the access token's owner. Using the
    // target user's id in New-Api-User with the admin's token causes a 401.
    const findToken = async () => {
      const page = await this.client.listTokens(this.adminAuth, {
        keyword: managedTokenName,
        pageSize: 100,
      });

      return findExactToken(page.items ?? [], managedTokenName, newApiUserId);
    };

    const existingToken = await findToken();
    if (existingToken && isValidId(existingToken.id)) return existingToken;

    await this.client.createToken(this.adminAuth, {
      expired_time: -1,
      name: managedTokenName,
      remain_quota: policy.managedTokenQuota,
      unlimited_quota: policy.managedTokenUnlimitedQuota,
    });

    const createdToken = await findToken();
    if (createdToken && isValidId(createdToken.id)) return createdToken;

    throw new Error(
      `Aihub managed token "${managedTokenName}" was not found after creation for user ${newApiUserId}`,
    );
  }
}
