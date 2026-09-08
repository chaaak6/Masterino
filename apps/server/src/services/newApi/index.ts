import { DEFAULT_MODEL, isAihubModelHidden } from '@lobechat/business-const';
import {
  filterAiProviderChatEligibleModels,
  getModelCatalogFromSettings,
  loadModels as loadModelCatalog,
  mergeModelCatalogEntry,
  type PersistedModelCatalog,
} from '@lobechat/business-model-bank';
import { detectModelProvider, processMultiProviderModelList } from '@lobechat/model-runtime';
import type {
  AihubRebindResult,
  ChatModelCard,
  NewApiAccountSummary,
  NewApiBindingImportResult,
  NewApiBindingImportRow,
  NewApiBindingStatus,
  NewApiQuotaPolicy,
  NewApiTokenUsage,
  NewApiUsageLogItem,
  NewApiUsageSummary,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { ModelProvider } from 'model-bank';
import {
  type AiFullModelCard,
  AiModelSourceEnum,
  type AiModelType,
  type AiProviderModelListItem,
} from 'model-bank';

import { AiModelModel } from '@/database/models/aiModel';
import { AiProviderModel } from '@/database/models/aiProvider';
import { NewApiBindingModel } from '@/database/models/newApiBinding';
import { UserModel } from '@/database/models/user';
import {
  account as authAccount,
  enterpriseAuditLogs,
  enterpriseUserProfiles,
  externalIdentities,
  type NewApiBindingItem,
  newApiBindings,
  type UserItem,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { NewApiBridgeClient, NewApiBridgeError } from './bridgeClient';
import {
  NewApiClient,
  NewApiError,
  type NewApiLogItem,
  type NewApiManagementAuth,
  type NewApiModelCard,
  type NewApiToken,
  type NewApiTokenUsageResponse,
  type NewApiUser,
  type NewApiUserSelf,
} from './client';
import { createNewApiReadSource, getNewApiDataSource, type NewApiReadSource } from './readSource';

const DEFAULT_MANAGED_TOKEN_NAME = 'masterlion-managed';
const DEFAULT_USAGE_PAGE_SIZE = 100;
const DEFAULT_QUOTA_DISPLAY_TYPE: NewApiQuotaPolicy['quotaDisplayType'] = 'CNY';
const DEFAULT_QUOTA_PER_UNIT = 500_000;
const DEFAULT_USD_EXCHANGE_RATE = 7.12;
const LOG_TYPE_CONSUME = 2;
const ENTERPRISE_PROVISIONING_MESSAGE =
  'Aihub provisioning is managed by enterprise provisioning policy';

interface NewApiServiceOptions {
  client?: NewApiClient;
  db: LobeChatDatabase;
  gateKeeper?: KeyVaultsGateKeeper;
  readOnlyDb?: NewApiReadSource;
  userId: string;
}

type UsableNewApiBindingItem = NewApiBindingItem & {
  newApiUserId: number;
};

const isValidNewApiUserId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

const getNewApiBaseUrl = () => {
  const baseUrl = process.env.AIHUB_PROXY_URL;
  if (!baseUrl) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'AIHUB_PROXY_URL is required',
    });
  }

  return baseUrl;
};

const getManagedTokenName = () =>
  process.env.AIHUB_MANAGED_TOKEN_NAME || DEFAULT_MANAGED_TOKEN_NAME;

const getAdminAuth = (): NewApiManagementAuth => {
  const accessToken = process.env.AIHUB_ADMIN_ACCESS_TOKEN;
  const newApiUserId = Number(process.env.AIHUB_ADMIN_USER_ID);

  if (!accessToken || !Number.isInteger(newApiUserId) || newApiUserId <= 0) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'AIHUB_ADMIN_USER_ID and AIHUB_ADMIN_ACCESS_TOKEN are required',
    });
  }

  return { accessToken, newApiUserId };
};

const getAdminTargetAuth = (newApiUserId: number): NewApiManagementAuth => {
  const accessToken = process.env.AIHUB_ADMIN_ACCESS_TOKEN;

  if (!accessToken) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message:
        'AIHUB_ADMIN_ACCESS_TOKEN is required when an Aihub binding does not have a user access token',
    });
  }

  return { accessToken, newApiUserId };
};

const getUsagePageSize = () => {
  const value = Number(process.env.AIHUB_USAGE_PAGE_SIZE);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_USAGE_PAGE_SIZE;
};

const readPositiveNumber = (value: unknown, fallback: number) => {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : fallback;
};

const getFallbackQuotaPolicy = (): NewApiQuotaPolicy => ({
  quotaDisplayType:
    process.env.AIHUB_QUOTA_DISPLAY_TYPE?.toUpperCase() === 'USD'
      ? 'USD'
      : DEFAULT_QUOTA_DISPLAY_TYPE,
  quotaPerUnit: readPositiveNumber(process.env.AIHUB_QUOTA_PER_UNIT, DEFAULT_QUOTA_PER_UNIT),
  usdExchangeRate: readPositiveNumber(
    process.env.AIHUB_USD_EXCHANGE_RATE,
    DEFAULT_USD_EXCHANGE_RATE,
  ),
});

const normalizeQuotaPolicy = (
  status: {
    quota_display_type?: string;
    quota_per_unit?: number;
    usd_exchange_rate?: number;
  } = {},
): NewApiQuotaPolicy => {
  const fallback = getFallbackQuotaPolicy();
  const displayType = status.quota_display_type?.toUpperCase();

  return {
    quotaDisplayType: displayType === 'USD' ? 'USD' : fallback.quotaDisplayType,
    quotaPerUnit: readPositiveNumber(status.quota_per_unit, fallback.quotaPerUnit),
    usdExchangeRate: readPositiveNumber(status.usd_exchange_rate, fallback.usdExchangeRate),
  };
};

const toAccountSummary = (self: NewApiUserSelf): NewApiAccountSummary => ({
  email: self.email,
  group: self.group,
  newApiUserId: self.id,
  quota: self.quota,
  requestCount: self.request_count,
  usedQuota: self.used_quota,
  username: self.username,
});

const toTokenUsageFromToken = (token: NewApiToken): NewApiTokenUsage => ({
  expiresAt: token.expired_time === -1 ? 0 : token.expired_time,
  modelLimitsEnabled: token.model_limits_enabled,
  name: token.name,
  object: 'token_usage',
  totalAvailable: token.remain_quota,
  totalGranted:
    token.remain_quota === undefined && token.used_quota === undefined
      ? undefined
      : (token.remain_quota ?? 0) + (token.used_quota ?? 0),
  totalUsed: token.used_quota,
  unlimitedQuota: token.unlimited_quota,
});

const toTokenUsage = (usage: NewApiTokenUsageResponse): NewApiTokenUsage => ({
  expiresAt: usage.expires_at,
  modelLimits: usage.model_limits,
  modelLimitsEnabled: usage.model_limits_enabled,
  name: usage.name,
  object: usage.object,
  totalAvailable: usage.total_available,
  totalGranted: usage.total_granted,
  totalUsed: usage.total_used,
  unlimitedQuota: usage.unlimited_quota,
});

const toUsageLog = (log: NewApiLogItem): NewApiUsageLogItem => {
  const promptTokens = log.prompt_tokens ?? 0;
  const completionTokens = log.completion_tokens ?? 0;

  return {
    completionTokens,
    createdAt: log.created_at,
    id: log.id,
    modelName: log.model_name,
    promptTokens,
    quota: log.quota ?? 0,
    requestId: log.request_id,
    tokenName: log.token_name,
    totalTokens: promptTokens + completionTokens,
  };
};

const toAiModel = (model: ChatModelCard): AiProviderModelListItem => ({
  abilities: {
    files: Boolean(model.files),
    functionCall: Boolean(model.functionCall),
    imageOutput: Boolean(model.imageOutput),
    reasoning: Boolean(model.reasoning),
    search: Boolean(model.search),
    video: Boolean(model.video),
    vision: Boolean(model.vision),
  },
  ...(model.contextWindowTokens ? { contextWindowTokens: model.contextWindowTokens } : {}),
  displayName: model.displayName ?? model.id,
  enabled: true,
  id: model.id,
  ...(model.parameters ? { parameters: model.parameters } : {}),
  ...(model.pricing ? { pricing: model.pricing } : {}),
  ...(model.releasedAt ? { releasedAt: model.releasedAt } : {}),
  ...(model.settings ? { settings: model.settings } : {}),
  source: AiModelSourceEnum.Remote,
  type: model.type ?? 'chat',
});

const toFallbackAiModel = (model: NewApiModelCard): AiProviderModelListItem =>
  toAiModel({
    displayName: model.id,
    id: model.id,
    type: 'chat',
  });

interface PreparedNewApiModel {
  catalog?: AiFullModelCard;
  model: AiProviderModelListItem;
  raw: NewApiModelCard;
}

const prepareNewApiModels = async (models: NewApiModelCard[]): Promise<PreparedNewApiModel[]> => {
  const [processedModels, catalogModels] = await Promise.all([
    processMultiProviderModelList(models, ModelProvider.NewAPI),
    loadModelCatalog(),
  ]);
  const processedModelMap = new Map(processedModels.map((model) => [model.id, model]));
  const catalogModelMap = new Map<string, AiFullModelCard>(
    catalogModels.map((model) => [model.id.toLowerCase(), model]),
  );
  for (const model of catalogModels) {
    const id = model.id.toLowerCase();
    // Aggregator entries can omit native capabilities. Prefer the owning provider's
    // exact model entry; provider metadata/manual evidence still wins during merge.
    if (model.providerId === detectModelProvider(id)) {
      catalogModelMap.set(id, model);
    }
  }

  return models.map((model) => {
    const processedModel = processedModelMap.get(model.id);
    return {
      catalog: catalogModelMap.get(model.id.toLowerCase()),
      model: processedModel ? toAiModel(processedModel) : toFallbackAiModel(model),
      raw: model,
    };
  });
};

const evidenceStateToBoolean = (state: 'supported' | 'unknown' | 'unsupported') => {
  if (state === 'unknown') return undefined;
  return state === 'supported';
};

const toAiModelType = (catalog: PersistedModelCatalog, parsedType: AiModelType): AiModelType => {
  if (
    catalog.entry.kind === 'unknown' &&
    ['realtime', 'text2music', 'video'].includes(parsedType)
  ) {
    return parsedType;
  }

  if (
    catalog.entry.kind === 'moderation' ||
    catalog.entry.kind === 'rerank' ||
    catalog.entry.kind === 'unknown'
  ) {
    // The legacy provider model DTO has no rerank/moderation/unknown members.
    // Keep the precise kind in settings.modelCatalog and project a non-chat
    // legacy type so older consumers cannot accidentally admit it as chat.
    return 'embedding';
  }

  return catalog.entry.kind;
};

const materializeNewApiModel = (
  prepared: PreparedNewApiModel,
  existing?: AiProviderModelListItem,
): AiProviderModelListItem => {
  const previousCatalog = getModelCatalogFromSettings(existing?.settings);
  const raw = prepared.raw;
  const catalog = mergeModelCatalogEntry({
    catalog: prepared.catalog
      ? {
          abilities: prepared.catalog.abilities,
          contextWindowTokens: prepared.catalog.contextWindowTokens,
          kind: prepared.catalog.type,
          maxOutput: prepared.catalog.maxOutput,
        }
      : undefined,
    manual: previousCatalog?.manual,
    modelId: raw.id,
    observed: previousCatalog?.observed,
    providerId: ModelProvider.NewAPI,
    providerMetadata: {
      contextWindowTokens: raw.context_window,
      declaredKind: raw.type,
      endpointTypes: raw.supported_endpoint_types,
      maxOutput: raw.max_output_tokens,
      modelVersion: raw.version,
      supportedInputModalities: [
        ...(raw.input_modalities ?? []),
        ...(raw.supported_modalities ?? []),
      ],
      unsupportedInputModalities: raw.unsupported_modalities,
    },
  });
  const image = evidenceStateToBoolean(catalog.entry.inputModalities.image);
  const files = evidenceStateToBoolean(catalog.entry.inputModalities.file);
  const video = evidenceStateToBoolean(catalog.entry.inputModalities.video);

  return {
    ...prepared.model,
    abilities: {
      ...prepared.model.abilities,
      ...(files === undefined ? { files: undefined } : { files }),
      ...(image === undefined ? { vision: undefined } : { vision: image }),
      ...(video === undefined ? { video: undefined } : { video }),
    },
    contextWindowTokens: catalog.entry.contextWindowTokens,
    settings: {
      ...existing?.settings,
      ...prepared.model.settings,
      modelCatalog: catalog,
    },
    type: toAiModelType(catalog, prepared.model.type),
  };
};

const getDefaultModel = (models: AiProviderModelListItem[]) => {
  const chatModels = filterAiProviderChatEligibleModels(models);
  if (chatModels.length === 0) return undefined;

  const defaultModel = chatModels.find((model) => model.id === DEFAULT_MODEL);

  if (defaultModel) return defaultModel.id;

  return chatModels[Math.floor(Math.random() * chatModels.length)]?.id;
};

export class NewApiService {
  private client: NewApiClient;
  private db: LobeChatDatabase;
  private gateKeeper?: KeyVaultsGateKeeper;
  private gateKeeperPromise: Promise<KeyVaultsGateKeeper>;
  private readOnlyDb: NewApiReadSource;
  private userId: string;

  constructor({ client, db, gateKeeper, readOnlyDb, userId }: NewApiServiceOptions) {
    this.client = client ?? new NewApiClient({ baseUrl: getNewApiBaseUrl() });
    this.db = db;
    this.gateKeeper = gateKeeper;
    this.gateKeeperPromise = gateKeeper
      ? Promise.resolve(gateKeeper)
      : KeyVaultsGateKeeper.initWithEnvKey();
    this.readOnlyDb = readOnlyDb ?? createNewApiReadSource();
    this.userId = userId;
  }

  private forUser(userId: string) {
    return new NewApiService({
      client: this.client,
      db: this.db,
      gateKeeper: this.gateKeeper,
      readOnlyDb: this.readOnlyDb,
      userId,
    });
  }

  private async getGateKeeper() {
    return this.gateKeeperPromise;
  }

  private async getQuotaPolicy() {
    if (typeof this.client.getStatus !== 'function') return getFallbackQuotaPolicy();

    try {
      return normalizeQuotaPolicy(await this.client.getStatus());
    } catch {
      return getFallbackQuotaPolicy();
    }
  }

  private async decryptAccessToken(binding: NewApiBindingItem) {
    if (!binding.encryptedAccessToken) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Aihub binding does not have a user access token',
      });
    }

    const gateKeeper = await this.getGateKeeper();
    const { plaintext, wasAuthentic } = await gateKeeper.decrypt(binding.encryptedAccessToken);

    if (!wasAuthentic || !plaintext) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Aihub binding token could not be decrypted',
      });
    }

    return plaintext;
  }

  private async isEnterpriseProvisionedUser() {
    if (typeof this.db.query?.account?.findFirst !== 'function') return false;

    const enterpriseAccount = await this.db.query.account.findFirst({
      where: and(eq(authAccount.providerId, 'wecom'), eq(authAccount.userId, this.userId)),
    });

    return Boolean(enterpriseAccount);
  }

  private async autoBindCurrentUser(): Promise<UsableNewApiBindingItem> {
    if (await this.isEnterpriseProvisionedUser()) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: ENTERPRISE_PROVISIONING_MESSAGE,
      });
    }

    const model = new NewApiBindingModel(this.db, this.userId);
    const currentUser = await UserModel.findById(this.db, this.userId);

    if (!currentUser) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Masterino user "${this.userId}" not found`,
      });
    }

    const { user: account } = await this.resolveNewApiUser(
      {
        email: currentUser.email || undefined,
        username: currentUser.username || undefined,
      },
      currentUser,
    );

    await model.upsert({
      encryptedAccessToken: null,
      newApiUserId: account.id,
      status: 'pending',
    });

    const binding = await model.find();
    if (!binding) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Aihub binding could not be saved for the current Masterino user',
      });
    }

    this.assertUsableBinding(binding);

    return binding;
  }

  private getUnavailableBindingMessage(binding: NewApiBindingItem) {
    if (binding.status === 'error') {
      return `Aihub binding is in error state${
        binding.errorMessage ? `: ${binding.errorMessage}` : ''
      }`;
    }

    return 'Aihub binding does not have a NewAPI user id';
  }

  private assertUsableBinding(
    binding: NewApiBindingItem,
  ): asserts binding is UsableNewApiBindingItem {
    if (!isValidNewApiUserId(binding.newApiUserId)) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: this.getUnavailableBindingMessage(binding),
      });
    }
  }

  private toBindingStatus(binding: NewApiBindingItem): NewApiBindingStatus {
    const newApiUserId = binding.newApiUserId;
    const baseStatus = {
      errorMessage: binding.errorMessage,
      lastSyncedAt: binding.lastSyncedAt,
      managedTokenId: binding.managedTokenId,
      oauthBinding: {
        errorCode: binding.iamOAuthBindingErrorCode,
        errorMessage: binding.iamOAuthBindingError,
        lastSyncedAt: binding.iamOAuthBindingSyncedAt,
        status: binding.iamOAuthBindingStatus ?? 'unknown',
      },
    };

    if (!isValidNewApiUserId(newApiUserId)) {
      return {
        ...baseStatus,
        errorMessage: binding.errorMessage ?? this.getUnavailableBindingMessage(binding),
        isBound: false,
        status: binding.status === 'error' ? 'error' : 'missing',
      };
    }

    if (binding.status === 'error') {
      return {
        ...baseStatus,
        errorMessage: binding.errorMessage ?? this.getUnavailableBindingMessage(binding),
        isBound: false,
        newApiUserId,
        status: 'error',
      };
    }

    return {
      ...baseStatus,
      isBound: true,
      newApiUserId,
      status: binding.status,
    };
  }

  private async getBindingOrThrow({
    autoBind = true,
  }: { autoBind?: boolean } = {}): Promise<UsableNewApiBindingItem> {
    const model = new NewApiBindingModel(this.db, this.userId);
    const binding = await model.find();

    if (binding) {
      this.assertUsableBinding(binding);
      return binding;
    }
    if (autoBind) return this.autoBindCurrentUser();

    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Current Masterino user is not bound to an Aihub account',
    });
  }

  private async getAuthForBinding(binding: UsableNewApiBindingItem): Promise<NewApiManagementAuth> {
    if (!binding.encryptedAccessToken) return getAdminTargetAuth(binding.newApiUserId);

    return {
      accessToken: await this.decryptAccessToken(binding),
      newApiUserId: binding.newApiUserId,
    };
  }

  private async getManagementAuth(): Promise<{
    auth: NewApiManagementAuth;
    binding: NewApiBindingItem;
  }> {
    const binding = await this.getBindingOrThrow();

    return {
      auth: await this.getAuthForBinding(binding),
      binding,
    };
  }

  private async saveManagedProviderToken(tokenKey: string, checkModel?: string) {
    const gateKeeper = await this.getGateKeeper();
    const aiProviderModel = new AiProviderModel(this.db, this.userId);

    await aiProviderModel.updateConfig(
      ModelProvider.NewAPI,
      {
        checkModel,
        fetchOnClient: false,
        keyVaults: {
          apiKey: tokenKey,
          baseURL: getNewApiBaseUrl(),
        },
      },
      gateKeeper.encrypt,
      KeyVaultsGateKeeper.getUserKeyVaults,
    );

    await aiProviderModel.toggleProviderEnabled(ModelProvider.NewAPI, true);
  }

  private async findManagedToken(auth: NewApiManagementAuth): Promise<NewApiToken | undefined> {
    const tokenName = getManagedTokenName();
    const page = await this.client.listTokens(auth, { keyword: tokenName, pageSize: 100 });

    return page.items.filter((token) => token.name === tokenName).sort((a, b) => b.id - a.id)[0];
  }

  private async findManagedTokenFromReadOnlyDb(
    newApiUserId: number,
    managedTokenId?: number | null,
  ) {
    if (!this.shouldUseReadOnlyDb()) return undefined;

    if (managedTokenId && typeof this.readOnlyDb.findManagedTokenById === 'function') {
      const token = await this.readOnlyDb.findManagedTokenById(newApiUserId, managedTokenId);
      if (!token) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Aihub managed token ${managedTokenId} is unavailable or does not belong to user ${newApiUserId}`,
        });
      }

      return token;
    }

    return this.readOnlyDb.findManagedToken(newApiUserId, getManagedTokenName());
  }

  private async getManagedTokenOptionsForBinding(binding: NewApiBindingItem) {
    if (!isValidNewApiUserId(binding.newApiUserId)) return [];

    const tokens =
      typeof this.readOnlyDb.listManagedTokens === 'function'
        ? await this.readOnlyDb
            .listManagedTokens(binding.newApiUserId, getManagedTokenName())
            .catch(() => [])
        : [];
    if (tokens.length > 0) {
      return tokens.map((token) => ({
        id: token.id,
        name: token.name || `Token #${token.id}`,
      }));
    }

    const token = await this.findManagedTokenFromReadOnlyDb(
      binding.newApiUserId,
      binding.managedTokenId,
    ).catch(() => undefined);
    const tokenId = token?.id ?? binding.managedTokenId;
    if (!tokenId) return [];

    return [
      {
        id: tokenId,
        name: token?.name || `Token #${tokenId}`,
      },
    ];
  }

  private shouldUseReadOnlyDb() {
    const dataSource = getNewApiDataSource();
    return dataSource !== 'api' && this.readOnlyDb.isEnabled();
  }

  private isReadOnlyDbRequired() {
    const dataSource = getNewApiDataSource();
    return dataSource === 'db' || dataSource === 'bridge';
  }

  private getReadSourceRequiredMessage() {
    return `Aihub read source is required for AIHUB_DATA_SOURCE=${getNewApiDataSource()}`;
  }

  private async findLobeUser(row: NewApiBindingImportRow) {
    if (row.lobeUserId) return UserModel.findById(this.db, row.lobeUserId);
    if (row.email) return UserModel.findByEmail(this.db, row.email);
    if (row.username) return UserModel.findByUsername(this.db, row.username);

    return undefined;
  }

  private getLobeUserMissingMessage(row: NewApiBindingImportRow) {
    if (row.lobeUserId) return `Masterino user "${row.lobeUserId}" not found`;
    if (row.email) return `Masterino user email "${row.email}" not found`;
    if (row.username) return `Masterino username "${row.username}" not found`;

    return 'Either lobeUserId, email, or username is required';
  }

  private pickNewApiUser(
    users: NewApiUser[],
    identity: { email?: string | null; username?: string | null },
  ) {
    const email = identity.email?.trim().toLowerCase();
    const username = identity.username?.trim().toLowerCase();

    return (
      users.find((user) => email && user.email?.trim().toLowerCase() === email) ||
      users.find((user) => username && user.username?.trim().toLowerCase() === username) ||
      (users.length === 1 ? users[0] : undefined)
    );
  }

  private async resolveNewApiUser(
    row: NewApiBindingImportRow,
    lobeUser: Pick<UserItem, 'email' | 'username'>,
  ): Promise<{ source: NewApiBindingImportResult['source']; user: NewApiUser }> {
    if (row.newApiAccessToken && row.newApiUserId) {
      const account = await this.client.getSelf({
        accessToken: row.newApiAccessToken,
        newApiUserId: row.newApiUserId,
      });

      if (Number(account.id) !== Number(row.newApiUserId)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Aihub user mismatch: expected ${row.newApiUserId}, got ${account.id}`,
        });
      }

      return { source: 'direct-token', user: account };
    }

    const identity = {
      email: row.email || lobeUser.email || undefined,
      username: row.username || lobeUser.username || undefined,
    };

    if (this.shouldUseReadOnlyDb()) {
      const user = await this.readOnlyDb.findUserByIdentity(identity);
      if (user) return { source: 'readonly-db', user };
    }

    const keyword = identity.email || identity.username;
    if (!keyword) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Cannot match Aihub user without email or username',
      });
    }

    if (this.isReadOnlyDbRequired()) {
      if (!this.readOnlyDb.isEnabled()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: this.getReadSourceRequiredMessage(),
        });
      }

      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Aihub user for "${keyword}" not found in the read-only database`,
      });
    }

    const page = await this.client.searchUsers(getAdminAuth(), { keyword, pageSize: 20 });
    const user = this.pickNewApiUser(page.items, identity);

    if (!user) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Aihub user for "${keyword}" not found`,
      });
    }

    return { source: 'admin-api', user };
  }

  async validateBinding(input: Pick<NewApiBindingImportRow, 'newApiAccessToken' | 'newApiUserId'>) {
    if (!input.newApiAccessToken || !input.newApiUserId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Aihub user id and access token are required for direct token validation',
      });
    }

    const account = await this.client.getSelf({
      accessToken: input.newApiAccessToken,
      newApiUserId: input.newApiUserId,
    });

    if (Number(account.id) !== Number(input.newApiUserId)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Aihub user mismatch: expected ${input.newApiUserId}, got ${account.id}`,
      });
    }

    return toAccountSummary(account);
  }

  async bindUser(targetUserId: string, input: NewApiBindingImportRow, knownTargetUser?: UserItem) {
    const targetUser = knownTargetUser ?? (await UserModel.findById(this.db, targetUserId));
    if (!targetUser) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Masterino user "${targetUserId}" not found`,
      });
    }

    const { source, user: account } = await this.resolveNewApiUser(input, targetUser);
    const gateKeeper = await this.getGateKeeper();
    const encryptedAccessToken = input.newApiAccessToken
      ? await gateKeeper.encrypt(input.newApiAccessToken)
      : null;

    await new NewApiBindingModel(this.db, targetUserId).upsert({
      encryptedAccessToken,
      newApiUserId: account.id,
      status: 'pending',
    });

    const targetService = this.forUser(targetUserId);
    await targetService.ensureManagedToken();

    return {
      account: toAccountSummary(account),
      source,
    };
  }

  async importBindings(rows: NewApiBindingImportRow[]): Promise<NewApiBindingImportResult[]> {
    const results: NewApiBindingImportResult[] = [];

    for (const row of rows) {
      const user = await this.findLobeUser(row);

      if (!user) {
        results.push({
          error: this.getLobeUserMissingMessage(row),
          lobeUserId: row.lobeUserId,
          newApiUserId: row.newApiUserId,
          ok: false,
        });
        continue;
      }

      try {
        const binding = await this.bindUser(user.id, row, user);
        results.push({
          lobeUserId: user.id,
          newApiUserId: binding.account.newApiUserId,
          ok: true,
          source: binding.source,
        });
      } catch (error) {
        results.push({
          error: error instanceof Error ? error.message : String(error),
          lobeUserId: user.id,
          newApiUserId: row.newApiUserId,
          ok: false,
        });
      }
    }

    return results;
  }

  async getBindingStatus(): Promise<NewApiBindingStatus> {
    const binding = await new NewApiBindingModel(this.db, this.userId).find();

    if (!binding) {
      try {
        const autoBinding = await this.autoBindCurrentUser();
        const { key } = await this.ensureManagedToken();
        await this.syncModelsForBinding(autoBinding, key);
        const refreshedBinding =
          (await new NewApiBindingModel(this.db, this.userId).find()) || autoBinding;
        this.assertUsableBinding(refreshedBinding);

        return {
          ...this.toBindingStatus(refreshedBinding),
          managedTokens: await this.getManagedTokenOptionsForBinding(refreshedBinding),
        };
      } catch (error) {
        const persistedBinding = await new NewApiBindingModel(this.db, this.userId).find();
        if (persistedBinding)
          return {
            ...this.toBindingStatus(persistedBinding),
            managedTokens: await this.getManagedTokenOptionsForBinding(persistedBinding),
          };

        return {
          errorMessage: error instanceof Error ? error.message : String(error),
          isBound: false,
          oauthBinding: { status: 'unknown' },
          status: 'missing',
        };
      }
    }

    return {
      ...this.toBindingStatus(binding),
      managedTokens: await this.getManagedTokenOptionsForBinding(binding),
    };
  }

  async rebindCurrentUser(): Promise<AihubRebindResult> {
    const binding = await new NewApiBindingModel(this.db, this.userId).find();
    if (!binding || !isValidNewApiUserId(binding.newApiUserId)) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Current Masterino user is not bound to an Aihub account',
      });
    }

    const [identity, profile] = await Promise.all([
      this.db.query.externalIdentities.findFirst({
        where: and(
          eq(externalIdentities.userId, this.userId),
          eq(externalIdentities.provider, 'wecom'),
        ),
      }),
      this.db.query.enterpriseUserProfiles.findFirst({
        where: and(
          eq(enterpriseUserProfiles.userId, this.userId),
          eq(enterpriseUserProfiles.provider, 'wecom'),
        ),
      }),
    ]);
    const employeeNumber = profile?.employeeNumber?.trim();
    if (!identity || !profile || !employeeNumber) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: !identity
          ? 'WeCom identity was not found for the current user'
          : 'Enterprise employee number was not found for the current user',
      });
    }
    if (profile.employmentStatus !== 'active') {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Enterprise employment status is not active for the current user',
      });
    }

    const syncedAt = new Date();
    const bridge = new NewApiBridgeClient();
    try {
      const result = await bridge.linkOAuthBinding(
        binding.newApiUserId,
        employeeNumber,
        Number(process.env.AIHUB_IAM_PROVIDER_ID) || 1,
      );
      await this.db
        .update(newApiBindings)
        .set({
          iamOAuthBindingError: null,
          iamOAuthBindingErrorCode: null,
          iamOAuthBindingStatus: 'active',
          iamOAuthBindingSyncedAt: syncedAt,
          updatedAt: syncedAt,
        })
        .where(eq(newApiBindings.userId, this.userId));
      await this.writeOAuthBindingAudit('success', { outcome: result.status });
      return {
        lastSyncedAt: syncedAt,
        repaired: result.status === 'created' || result.status === 'repaired',
        status: 'active',
      };
    } catch (error) {
      const errorCode = error instanceof NewApiBridgeError ? error.code : 'binding_failed';
      const errorMessage = error instanceof Error ? error.message : String(error);
      const status = errorCode === 'binding_conflict' ? 'conflict' : 'error';
      await this.db
        .update(newApiBindings)
        .set({
          iamOAuthBindingError: errorMessage,
          iamOAuthBindingErrorCode: errorCode,
          iamOAuthBindingStatus: status,
          iamOAuthBindingSyncedAt: syncedAt,
          updatedAt: syncedAt,
        })
        .where(eq(newApiBindings.userId, this.userId));
      await this.writeOAuthBindingAudit('failed', { errorCode });
      return {
        errorCode,
        errorMessage,
        lastSyncedAt: syncedAt,
        repaired: false,
        status,
      };
    }
  }

  private async writeOAuthBindingAudit(
    result: 'failed' | 'success',
    metadata: Record<string, unknown>,
  ) {
    try {
      await this.db.insert(enterpriseAuditLogs).values({
        action: 'identity.aihub_oauth_binding.retry',
        actorUserId: this.userId,
        metadata,
        result,
        targetId: this.userId,
        targetType: 'user',
      });
    } catch (error) {
      console.warn('[Aihub Binding] Failed to write retry audit log:', error);
    }
  }

  private async listModelMetadataBestEffort(key: string): Promise<NewApiModelCard[]> {
    if (typeof this.client.listModels !== 'function') return [];

    try {
      const metadata = await this.client.listModels(key);
      return Array.isArray(metadata) ? metadata : [];
    } catch {
      // The bridge/DB remains the authority for accessible ids. Metadata enriches
      // classification only and must not make an otherwise healthy sync fail.
      return [];
    }
  }

  private async reconcileRemoteModels(prepared: PreparedNewApiModel[]) {
    const reconcile = async (database: LobeChatDatabase) => {
      const aiModelModel = new AiModelModel(database, this.userId);
      const existingModels = await aiModelModel.getModelListByProviderId(ModelProvider.NewAPI);
      const existingById = new Map(existingModels.map((model) => [model.id, model]));
      const models = prepared.map((model) =>
        materializeNewApiModel(model, existingById.get(model.raw.id)),
      );
      const incomingIds = new Set(models.map((model) => model.id));
      const modelsToInsert: AiProviderModelListItem[] = [];

      for (const model of models) {
        const existing = existingById.get(model.id);
        if (!existing) {
          modelsToInsert.push(model);
          continue;
        }

        if (existing.source === AiModelSourceEnum.Remote) {
          await aiModelModel.update(model.id, ModelProvider.NewAPI, model);
        }
      }

      await aiModelModel.batchUpdateAiModels(ModelProvider.NewAPI, modelsToInsert);

      for (const existing of existingModels) {
        if (existing.source === AiModelSourceEnum.Remote && !incomingIds.has(existing.id)) {
          await aiModelModel.delete(existing.id, ModelProvider.NewAPI);
        }
      }

      return models;
    };

    if (typeof this.db.transaction === 'function') {
      return this.db.transaction((transaction) => reconcile(transaction as LobeChatDatabase));
    }

    // Minimal in-memory database doubles used by focused unit tests do not expose
    // transactions. Production databases always take the branch above.
    return reconcile(this.db);
  }

  private async syncModelsForBinding(binding: UsableNewApiBindingItem, key: string) {
    let rawModels: NewApiModelCard[] | undefined;

    if (this.shouldUseReadOnlyDb()) {
      const [account, token] = await Promise.all([
        this.readOnlyDb.findUserById(binding.newApiUserId),
        this.findManagedTokenFromReadOnlyDb(binding.newApiUserId, binding.managedTokenId),
      ]);
      const modelIds = await this.readOnlyDb.listAccessibleModels(account?.group, token);
      if (modelIds.length > 0) {
        const metadata = await this.listModelMetadataBestEffort(key);
        const accessibleIds = new Set(modelIds);
        const metadataById = new Map(
          metadata.filter((model) => accessibleIds.has(model.id)).map((model) => [model.id, model]),
        );
        rawModels = modelIds.map((id) => metadataById.get(id) ?? { id });
      } else if (this.isReadOnlyDbRequired()) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Aihub read-only database did not return accessible models for the current user',
        });
      }
    }

    if (!rawModels) {
      rawModels = await this.client.listModels(key);
    }

    // Apply the AIHUB_HIDDEN_MODELS deny-list before persisting, so models that
    // are still enabled in the Aihub abilities table but should no longer be
    // offered are dropped on the next sync and disappear after refresh.
    rawModels = rawModels.filter((model) => !isAihubModelHidden(model.id));

    const prepared = await prepareNewApiModels(rawModels);
    const models = await this.reconcileRemoteModels(prepared);
    const defaultModel = getDefaultModel(models);

    // The credential is part of core Aihub readiness even when the user's
    // current model set has no chat default (for example embedding-only).
    await this.saveManagedProviderToken(key, defaultModel);

    return {
      defaultModel,
      models,
    };
  }

  async getAccountSummary() {
    const binding = await this.getBindingOrThrow();
    const quotaPolicy = await this.getQuotaPolicy();
    if (this.shouldUseReadOnlyDb()) {
      const account = await this.readOnlyDb.findUserById(binding.newApiUserId);
      if (account) return { ...toAccountSummary(account), quotaPolicy };

      if (this.isReadOnlyDbRequired()) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Aihub account was not found in the read-only database',
        });
      }
    }

    const auth = await this.getAuthForBinding(binding);
    const account = await this.client.getSelf(auth);

    return { ...toAccountSummary(account), quotaPolicy };
  }

  async ensureManagedToken() {
    const binding = await this.getBindingOrThrow();
    const bindingModel = new NewApiBindingModel(this.db, this.userId);

    try {
      const dbToken = await this.findManagedTokenFromReadOnlyDb(
        binding.newApiUserId,
        binding.managedTokenId,
      );
      if (dbToken?.key) {
        await this.saveManagedProviderToken(dbToken.key);
        await bindingModel.updateSyncState({
          errorMessage: null,
          lastSyncedAt: new Date(),
          managedTokenId: dbToken.id,
          status: 'active',
        });

        return { key: dbToken.key, tokenId: dbToken.id };
      }

      if (this.isReadOnlyDbRequired()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: !this.readOnlyDb.isEnabled()
            ? this.getReadSourceRequiredMessage()
            : 'Aihub read-only database did not return an active API token for the current user',
        });
      }

      const auth = await this.getAuthForBinding(binding);

      if (binding.managedTokenId) {
        try {
          const { key } = await this.client.getTokenKey(auth, binding.managedTokenId);
          await this.saveManagedProviderToken(key);
          await bindingModel.updateSyncState({
            errorMessage: null,
            lastSyncedAt: new Date(),
            managedTokenId: binding.managedTokenId,
            status: 'active',
          });

          return { key, tokenId: binding.managedTokenId };
        } catch (error) {
          if (!(error instanceof NewApiError && [401, 403, 404].includes(error.status))) {
            throw error;
          }
        }
      }

      let token = await this.findManagedToken(auth);

      if (!token) {
        await this.client.createToken(auth, {
          expired_time: -1,
          name: getManagedTokenName(),
          remain_quota: 0,
          unlimited_quota: true,
        });
        token = await this.findManagedToken(auth);
      }

      if (!token) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create or find Aihub managed token',
        });
      }

      const { key } = await this.client.getTokenKey(auth, token.id);
      await this.saveManagedProviderToken(key);
      await bindingModel.updateSyncState({
        errorMessage: null,
        lastSyncedAt: new Date(),
        managedTokenId: token.id,
        status: 'active',
      });

      return { key, tokenId: token.id };
    } catch (error) {
      await bindingModel.updateSyncState({
        errorMessage: error instanceof Error ? error.message : String(error),
        lastSyncedAt: new Date(),
        managedTokenId: binding.managedTokenId,
        status: 'error',
      });

      throw error;
    }
  }

  async syncModels() {
    const binding = await this.getBindingOrThrow();
    const { key } = await this.ensureManagedToken();
    return this.syncModelsForBinding(binding, key);
  }

  private buildUsageSummary(
    account: NewApiAccountSummary,
    tokenUsage: NewApiTokenUsage,
    logs: NewApiUsageLogItem[],
    quotaPolicy?: NewApiQuotaPolicy,
  ) {
    const byModel: NewApiUsageSummary['byModel'] = {};
    const byDay: NewApiUsageSummary['byDay'] = {};
    for (const log of logs) {
      const modelName = log.modelName || 'unknown';
      const day = new Date(log.createdAt * 1000).toISOString().slice(0, 10);

      byModel[modelName] ||= {
        completionTokens: 0,
        promptTokens: 0,
        quota: 0,
        requests: 0,
        totalTokens: 0,
      };

      byModel[modelName].completionTokens += log.completionTokens;
      byModel[modelName].promptTokens += log.promptTokens;
      byModel[modelName].quota += log.quota;
      byModel[modelName].requests += 1;
      byModel[modelName].totalTokens += log.totalTokens;

      byDay[day] ||= {
        completionTokens: 0,
        promptTokens: 0,
        quota: 0,
        requests: 0,
        totalTokens: 0,
      };

      byDay[day].completionTokens += log.completionTokens;
      byDay[day].promptTokens += log.promptTokens;
      byDay[day].quota += log.quota;
      byDay[day].requests += 1;
      byDay[day].totalTokens += log.totalTokens;
    }

    return {
      account,
      byDay,
      byModel,
      recentLogs: logs.slice(0, 20),
      requestCount: logs.length,
      quotaPolicy,
      tokenUsage,
      totalCompletionTokens: logs.reduce((sum, log) => sum + log.completionTokens, 0),
      totalPromptTokens: logs.reduce((sum, log) => sum + log.promptTokens, 0),
      totalQuota: logs.reduce((sum, log) => sum + log.quota, 0),
      totalTokens: logs.reduce((sum, log) => sum + log.totalTokens, 0),
    } satisfies NewApiUsageSummary;
  }

  async getUsageSummary(params: { endTimestamp?: number; startTimestamp?: number } = {}) {
    const binding = await this.getBindingOrThrow();
    const quotaPolicy = await this.getQuotaPolicy();
    const dbToken = await this.findManagedTokenFromReadOnlyDb(
      binding.newApiUserId,
      binding.managedTokenId,
    );
    if (dbToken?.key) {
      const account = await this.readOnlyDb.findUserById(binding.newApiUserId);
      const logs: NewApiUsageLogItem[] = [];
      const pageSize = getUsagePageSize();
      let page = 1;

      while (true) {
        const result = await this.readOnlyDb.getUsageLogs(binding.newApiUserId, {
          endTimestamp: params.endTimestamp,
          page,
          pageSize,
          startTimestamp: params.startTimestamp,
        });

        logs.push(...result.items.map(toUsageLog));
        if (result.items.length < pageSize) break;
        page += 1;
      }

      return this.buildUsageSummary(
        account ? toAccountSummary(account) : { newApiUserId: binding.newApiUserId },
        toTokenUsageFromToken(dbToken),
        logs,
        quotaPolicy,
      );
    }

    if (this.isReadOnlyDbRequired()) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Aihub read-only database did not return an active API token for usage lookup',
      });
    }

    const { auth } = await this.getManagementAuth();
    const { key } = await this.ensureManagedToken();
    const [account, tokenUsage] = await Promise.all([
      this.client.getSelf(auth),
      this.client.getTokenUsage(key),
    ]);

    const logs: NewApiUsageLogItem[] = [];
    const pageSize = getUsagePageSize();
    let page = 1;
    let total: number | undefined;

    do {
      const result = await this.client.getSelfLogs(auth, {
        endTimestamp: params.endTimestamp,
        page,
        pageSize,
        startTimestamp: params.startTimestamp,
        type: LOG_TYPE_CONSUME,
      });

      total = result.total;
      logs.push(...result.items.map(toUsageLog));

      if (result.items.length < pageSize) break;
      page += 1;
    } while (total === undefined || logs.length < total);

    return this.buildUsageSummary(
      { ...toAccountSummary(account), quotaPolicy },
      toTokenUsage(tokenUsage),
      logs,
      quotaPolicy,
    );
  }
}
