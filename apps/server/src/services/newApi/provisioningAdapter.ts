import {
  NewApiClient,
  type NewApiCreateUserInput,
  type NewApiManagementAuth,
  type NewApiToken,
  type NewApiUser,
} from './client';
import { NewApiBridgeClient } from './bridgeClient';

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
  masterLionUsername?: string;
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
  bridgeClient?: NewApiBridgeClient;
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
  private bridgeClient: NewApiBridgeClient | undefined;
  private client: ProvisioningClient;

  constructor(options: NewApiProvisioningAdapterOptions = {}) {
    this.client =
      options.client ??
      new NewApiClient({
        baseUrl: process.env.AIHUB_PROXY_URL ?? '',
      });
    this.adminAuth = options.adminAuth ?? getAdminAuthFromEnv();
    this.bridgeClient = options.bridgeClient ?? new NewApiBridgeClient();
  }

  async provisionEnterpriseUser(
    input: ProvisionEnterpriseUserInput,
  ): Promise<ProvisionEnterpriseUserResult> {
    const policy = input.policy.aihubProvisioning ?? {};
    const lookupField = getLookupField(policy);
    const keyword = getLookupKeyword(input, lookupField);
    const managedTokenName = getRequiredManagedTokenName(policy);

    let targetUser = await this.findUser(keyword);

    if (!targetUser && lookupField !== 'email' && asTrimmedString(input.email)) {
      targetUser = await this.findUser(input.email!);
    }

    if (!targetUser) {
      if (!policy.autoCreateUser) {
        throw new Error(
          `Aihub user matching "${keyword}"${lookupField !== 'email' ? ` or "${input.email}"` : ''} was not found and autoCreateUser is disabled`,
        );
      }

      targetUser = await this.createUser(input, policy);
    }

    const token = await this.ensureManagedToken(
      targetUser.id,
      managedTokenName,
      policy,
      input.masterLionUsername,
    );

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
    masterLionUsername?: string,
  ) {
    // 1. Try the bridge (direct DB read) to find an existing managed token for the target user.
    //    The Aihub API only lists the authenticated user's own tokens, so admin can't see
    //    other users' tokens via /api/token/. The bridge queries the DB directly.
    if (this.bridgeClient?.isEnabled()) {
      try {
        const bridgedToken = await this.bridgeClient.findManagedToken(
          newApiUserId,
          managedTokenName,
        );
        if (bridgedToken && isValidId(bridgedToken.id)) return bridgedToken;
      } catch {
        // Bridge lookup failed — fall through to admin API approach
      }
    }

    // 2. Fall back to admin API: list admin's own tokens for a name match.
    const findToken = async (filterByUserId = true) => {
      const page = await this.client.listTokens(this.adminAuth, {
        keyword: managedTokenName,
        pageSize: 100,
      });

      if (!filterByUserId) {
        return (page.items ?? []).find(
          (token) => asTrimmedString(token.name) === managedTokenName,
        );
      }

      return findExactToken(page.items ?? [], managedTokenName, newApiUserId);
    };

    const existingToken = await findToken();
    if (existingToken && isValidId(existingToken.id)) return existingToken;

    // 3. Create a new token as admin. The Aihub API always assigns the token to the
    //    authenticated user (admin), not the target user. After creation, we reassign
    //    ownership to the target Aihub user via the bridge's direct DB write capability.
    await this.client.createToken(this.adminAuth, {
      expired_time: -1,
      name: managedTokenName,
      remain_quota: policy.managedTokenQuota,
      unlimited_quota: policy.managedTokenUnlimitedQuota,
    });

    // After creation, the token is under admin (user_id=1), so we search by name
    // without filtering by user_id. The reassign step below will correct the ownership.
    const createdToken = await findToken(false);
    if (createdToken && isValidId(createdToken.id)) {
      // 4. Reassign the token to the target Aihub user via the bridge.
      //    This corrects the user_id from admin (1) to the target user,
      //    so the token appears under the correct user in Aihub and quota
      //    is tracked properly. If the bridge is unavailable or lacks write
      //    permission, the token remains under admin — a degraded but
      //    functional state (the token key still works for API calls).
      if (this.bridgeClient?.isEnabled()) {
        const desiredName =
          masterLionUsername && `MasterLion_${masterLionUsername}` !== managedTokenName
            ? `MasterLion_${masterLionUsername}`
            : undefined;
        const reassigned = await this.bridgeClient.reassignToken(
          createdToken.id,
          newApiUserId,
          desiredName,
        );
        if (!reassigned) {
          console.warn(
            `[Aihub Provisioning] Failed to reassign token ${createdToken.id} to user ${newApiUserId}; ` +
              'token remains under admin user. Ensure the bridge DB account has UPDATE privilege on the tokens table.',
          );
        }
      } else {
        console.warn(
          `[Aihub Provisioning] Bridge is not enabled; token ${createdToken.id} remains under admin user.`,
        );
      }

      return createdToken;
    }

    throw new Error(
      `Aihub managed token "${managedTokenName}" was not found after creation for user ${newApiUserId}`,
    );
  }
}
