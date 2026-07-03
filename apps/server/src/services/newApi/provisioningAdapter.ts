import {
  NewApiClient,
  NewApiError,
  type NewApiCreateUserInput,
  type NewApiManagementAuth,
  type NewApiToken,
  type NewApiUpdateUserInput,
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
  'createToken' | 'createUser' | 'listTokens' | 'searchUsers' | 'updateUser'
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

// Bug 4: NewAPI requires a password on user creation (max 20 chars). SSO
// users never use it to log in to Aihub directly (they use managed tokens),
// so a random password is generated and discarded. 20 chars of base36 = ~103
// bits of entropy, well beyond any brute-force threshold for a throwaway.
const generateRandomPassword = (): string => {
  const bytes = new Uint8Array(12);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // base36 keeps it alphanumeric, guaranteed to fit within 20 chars
  return Array.from(bytes, (b) => b.toString(36))
    .join('')
    .slice(0, 20)
    .padEnd(20, '0');
};

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

// Bug 1b: detect Aihub "username already exists" conflicts so createUser can
// fall back to reusing the existing user instead of failing permanently.
const isDuplicateUserError = (error: unknown): boolean => {
  if (!(error instanceof NewApiError)) return false;
  if (error.status !== 400 && error.status !== 409) return false;

  const message = error.message.toLowerCase();
  return (
    message.includes('already exists') ||
    message.includes('already used') ||
    message.includes('duplicate') ||
    message.includes('已存在') ||
    message.includes('已被使用') ||
    message.includes('username')
  );
};

const getUserQuota = (user: NewApiUser | undefined): number => {
  if (!user) return 0;
  const quota = user.quota;
  return typeof quota === 'number' && Number.isFinite(quota) && quota > 0 ? quota : 0;
};

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

    // Email fallback: only accept the match when the found user's username
    // equals the expected MasterLion username (employeeNumber). This prevents
    // binding to a user that self-registered in Aihub with a different
    // username (e.g. newapi_320) but happens to share the same email.
    if (!targetUser && lookupField !== 'email' && asTrimmedString(input.email)) {
      const emailMatch = await this.findUser(input.email!);
      const expectedUsername = getCreateUsername(input);
      if (emailMatch && asTrimmedString(emailMatch.username) === expectedUsername) {
        targetUser = emailMatch;
      }
    }

    if (!targetUser) {
      if (!policy.autoCreateUser) {
        throw new Error(
          `Aihub user matching "${keyword}"${lookupField !== 'email' ? ` or "${input.email}"` : ''} was not found and autoCreateUser is disabled`,
        );
      }

      targetUser = await this.createUser(input, policy);
    }

    // Bug 2: an existing Aihub user created without the default initial quota
    // (e.g. pre-provisioned manually or via a prior partial failure) would have
    // no balance. Top up the configured initial quota when the user has none.
    targetUser = await this.ensureInitialQuota(targetUser, policy);

    const token = await this.ensureManagedToken(
      targetUser.id,
      managedTokenName,
      policy,
      input.masterLionUsername,
    );

    // Link the Aihub user to the OAuth provider (e.g. BIEL IAM) so that when
    // the user later logs in to Aihub directly via IAM SSO, they are matched
    // to this same account instead of creating a new one. Uses the employee
    // number (工号) as provider_user_id — the same value IAM returns.
    await this.ensureOAuthBinding(targetUser.id, input);

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

    const exact = findExactUser(page.items ?? [], keyword);
    if (exact) return exact;

    // Bug 1c: the admin API search can miss existing users (pagination cap of
    // 20, permission scope, or keyword semantics). Fall back to the bridge's
    // authoritative DB read so a user that exists in Aihub is not treated as
    // "not found" — which would otherwise trigger a duplicate create attempt.
    if (this.bridgeClient?.isEnabled()) {
      try {
        const bridged = await this.bridgeClient.findUserByIdentity({
          email: keyword,
          username: keyword,
        });
        if (bridged && isValidId(bridged.id)) return bridged;
      } catch {
        // bridge lookup failed — treat as not found and let the caller decide
      }
    }

    return undefined;
  }

  private async refetchUser(userId: number, username: string) {
    // Bug 1a: some NewAPI versions return only {id} on create without echoing
    // back the identity fields. Re-fetch the authoritative record by id via
    // the bridge (direct DB read), then fall back to an admin search.
    if (this.bridgeClient?.isEnabled()) {
      try {
        const bridged = await this.bridgeClient.findUserById(userId);
        if (bridged && isValidId(bridged.id)) return bridged;
      } catch {
        // fall through to admin search
      }
    }

    return this.findUser(username);
  }

  private async createUser(
    input: ProvisionEnterpriseUserInput,
    policy: AihubProvisioningPolicy,
  ) {
    const username = getCreateUsername(input);
    // Bug 4: NewAPI's POST /api/user/ rejects creation without a password
    // ("无效的参数"). SSO users never log in to Aihub directly, so generate a
    // long random password they will never use.
    const password = generateRandomPassword();
    const createInput: NewApiCreateUserInput = {
      display_name: asTrimmedString(input.name),
      email: asTrimmedString(input.email),
      group: asTrimmedString(policy.userGroup),
      password,
      quota: policy.initialQuota,
      username,
    };

    let createdUser: NewApiUser | undefined;

    try {
      createdUser = await this.client.createUser(this.adminAuth, createInput);
    } catch (error) {
      // Bug 1b: a prior partial provisioning failure may have already created
      // the Aihub user. On a duplicate-username conflict, reuse the existing
      // user instead of aborting — otherwise every subsequent login retries
      // create and fails permanently.
      if (isDuplicateUserError(error)) {
        const existing = await this.findUser(username);
        if (existing && isValidId(existing.id)) {
          return existing;
        }
      }
      throw error;
    }

    if (createdUser && isValidId(createdUser.id)) {
      // Bug 1a: trust the valid id returned by Aihub. Only re-fetch the
      // authoritative record when the response did not echo back a matching
      // identity (some NewAPI versions omit username/email/display_name on the
      // create response). Never abort a successful create over a mismatch.
      if (isSameUserIdentity(createdUser, input)) {
        return createdUser;
      }

      const reconfirmed = await this.refetchUser(createdUser.id, username);
      if (reconfirmed && isValidId(reconfirmed.id)) {
        return reconfirmed;
      }

      return createdUser;
    }

    // No valid id returned — try to locate the user we just created.
    const targetUser = await this.findUser(username);
    if (targetUser && isValidId(targetUser.id)) {
      return targetUser;
    }

    throw new Error(`Aihub user "${username}" was created but no NewAPI user id was returned`);
  }

  private async ensureInitialQuota(
    user: NewApiUser,
    policy: AihubProvisioningPolicy,
  ): Promise<NewApiUser> {
    const initialQuota = typeof policy.initialQuota === 'number' ? policy.initialQuota : 0;
    if (initialQuota <= 0) return user;
    // Only top up when the user has no balance; never reduce an existing quota.
    if (getUserQuota(user) > 0) return user;

    try {
      const updateInput: NewApiUpdateUserInput = {
        id: user.id,
        quota: initialQuota,
      };
      const updated = await this.client.updateUser(this.adminAuth, updateInput);
      if (updated && isValidId(updated.id)) {
        return { ...user, quota: initialQuota };
      }
    } catch (error) {
      console.warn(
        `[Aihub Provisioning] Failed to top up initial quota for user ${user.id}: ${(error as Error).message}`,
      );
    }

    return user;
  }

  /**
   * Independently ensure an existing Aihub user has the default initial quota.
   *
   * This is called outside {@link provisionEnterpriseUser} so that even when
   * full provisioning fails (e.g. a duplicate-username conflict that could not
   * be resolved, or a managed-token error), an *existing* Aihub user whose
   * binding already records a `newApiUserId` still gets its balance topped up
   * on every login. This covers the "old user with no balance" scenario.
   */
  async ensureUserQuota(
    newApiUserId: number,
    policy: ProvisioningPolicy,
  ): Promise<void> {
    if (!isValidId(newApiUserId)) return;
    const aihubPolicy = policy.aihubProvisioning ?? {};
    const initialQuota = typeof aihubPolicy.initialQuota === 'number' ? aihubPolicy.initialQuota : 0;
    if (initialQuota <= 0) return;

    // Fetch the current user record to check the existing quota.
    let user: NewApiUser | undefined;
    if (this.bridgeClient?.isEnabled()) {
      try {
        user = await this.bridgeClient.findUserById(newApiUserId);
      } catch {
        // fall through to admin search
      }
    }
    if (!user) {
      // Admin API has no "get user by id"; search by id as keyword.
      const page = await this.client.searchUsers(this.adminAuth, {
        keyword: String(newApiUserId),
        pageSize: 20,
      });
      user = (page.items ?? []).find((u) => Number(u.id) === Number(newApiUserId));
    }
    if (!user || !isValidId(user.id)) return;
    if (getUserQuota(user) > 0) return;

    try {
      await this.client.updateUser(this.adminAuth, {
        id: user.id,
        quota: initialQuota,
      });
    } catch (error) {
      console.warn(
        `[Aihub Provisioning] Failed to top up initial quota for user ${user.id}: ${(error as Error).message}`,
      );
    }
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

  private async ensureOAuthBinding(
    newApiUserId: number,
    input: ProvisionEnterpriseUserInput,
  ): Promise<void> {
    // The OAuth provider_user_id is the employee number (工号) — the same
    // value BIEL IAM returns as account_no. This lets IAM login match the
    // existing Aihub account instead of creating a new one.
    const providerUserId = asTrimmedString(input.employeeNumber);
    if (!providerUserId) return;

    if (!this.bridgeClient?.isEnabled()) return;

    const providerId = Number(process.env.AIHUB_IAM_PROVIDER_ID) || 1;

    const linked = await this.bridgeClient.linkOAuthBinding(
      newApiUserId,
      providerUserId,
      providerId,
    );

    if (!linked) {
      console.warn(
        `[Aihub Provisioning] Failed to link OAuth binding for user ${newApiUserId} ` +
          `(providerUserId="${providerUserId}"); the user may get a duplicate account on IAM login.`,
      );
    }
  }
}
