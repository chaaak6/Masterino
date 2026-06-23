import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { getServerDB } from '@/database/core/db-adaptor';
import { ssoProviderConfigs, type SsoProviderConfigItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import { PROVIDER_ALIAS_MAP } from '@/libs/better-auth/constants';
import { parseSSOProviders } from '@/libs/better-auth/utils/server';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

export const WECOM_SSO_PROVIDER = 'wecom' as const;
export const WECOM_SSO_DISPLAY_NAME = '企业微信';
export const WECOM_SSO_DEFAULT_MODES = ['web_qr', 'workbench'] as const;
export const WECOM_DEFAULT_AIHUB_INITIAL_QUOTA = 50_000_000;

const trimString = (value: unknown) => (typeof value === 'string' ? value.trim() : value);
const emptyStringToUndefined = (value: unknown) => {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const trimmedStringSchema = z.preprocess(trimString, z.string());
const stringWithDefault = (defaultValue: string) =>
  z.preprocess(emptyStringToUndefined, z.string().default(defaultValue));

const wecomIdentityMappingSchema = z
  .object({
    departmentField: stringWithDefault('department'),
    emailField: stringWithDefault('email'),
    employeeNumberField: stringWithDefault('userid'),
    mobileField: stringWithDefault('mobile'),
    nameField: stringWithDefault('name'),
    positionField: stringWithDefault('position'),
  })
  .default({});

const wecomDepartmentSyncSchema = z
  .object({
    enabled: z.boolean().default(false),
    mode: z.enum(['login', 'manual', 'scheduled']).default('login'),
  })
  .default({});

const wecomAihubProvisioningSchema = z
  .object({
    autoCreateUser: z.boolean().default(true),
    enabled: z.boolean().default(true),
    initialQuota: z.number().min(0).default(WECOM_DEFAULT_AIHUB_INITIAL_QUOTA),
    lookupField: z.preprocess(
      emptyStringToUndefined,
      z.enum(['employeeNumber', 'email', 'name']).default('employeeNumber'),
    ),
    managedTokenName: stringWithDefault('masterlion-managed'),
    managedTokenQuota: z.number().min(0).default(WECOM_DEFAULT_AIHUB_INITIAL_QUOTA),
    managedTokenUnlimitedQuota: z.boolean().default(true),
    userGroup: z.preprocess(emptyStringToUndefined, z.string().optional()),
  })
  .default({});

export const wecomSsoConfigSchema = z
  .object({
    agentId: trimmedStringSchema.default(''),
    aihubProvisioning: wecomAihubProvisioningSchema,
    autoProvision: z.boolean().default(true),
    corpId: trimmedStringSchema.default(''),
    defaultRole: z.enum(['owner', 'admin', 'member', 'viewer']).default('member'),
    defaultWorkspaceId: z.preprocess(emptyStringToUndefined, z.string().optional()),
    departmentSync: wecomDepartmentSyncSchema,
    enabled: z.boolean().default(false),
    enabledModes: z.array(z.enum(['web_qr', 'workbench'])).default([...WECOM_SSO_DEFAULT_MODES]),
    identityMapping: wecomIdentityMappingSchema,
    redirectUri: z
      .preprocess(trimString, z.union([z.literal(''), z.string().url()]))
      .default(''),
    trustedDomains: z
      .array(trimmedStringSchema)
      .default([])
      .transform((domains) => Array.from(new Set(domains.filter(Boolean)))),
  })
  .superRefine((config, ctx) => {
    if (!config.enabled) return;

    if (!config.corpId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Corp ID is required when WeCom SSO is enabled',
        path: ['corpId'],
      });
    }

    if (!config.agentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Agent ID is required when WeCom SSO is enabled',
        path: ['agentId'],
      });
    }

    if (config.enabledModes.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one enabled mode is required when WeCom SSO is enabled',
        path: ['enabledModes'],
      });
    }
  })
  .transform((config) => ({
    ...config,
    defaultWorkspaceId: config.defaultWorkspaceId,
  }));

const corpSecretSchema = z.preprocess(emptyStringToUndefined, z.string().optional());

export const wecomSsoUpsertInputSchema = z.object({
  config: wecomSsoConfigSchema,
  corpSecret: corpSecretSchema,
});

export const wecomSsoUpdateInputSchema = wecomSsoUpsertInputSchema.extend({
  provider: z.literal(WECOM_SSO_PROVIDER),
});

export type WecomSsoConfig = z.infer<typeof wecomSsoConfigSchema>;
export type WecomSsoEncryptedSecrets = Partial<Record<'corpSecret', string>>;
export type WecomSsoConfigResult = {
  config: WecomSsoConfig;
  corpSecretConfigured: boolean;
  displayName: typeof WECOM_SSO_DISPLAY_NAME;
  enabled: boolean;
  provider: typeof WECOM_SSO_PROVIDER;
};
export type UpsertWecomSsoConfigParams = z.input<typeof wecomSsoUpsertInputSchema>;
export type WecomSsoRuntimeConfig = {
  agentId: string;
  corpId: string;
  corpSecret: string;
  enabled: true;
  enabledModes: WecomSsoConfig['enabledModes'];
  redirectUri: string;
};

export const validateWecomSsoConfig = (input: unknown): WecomSsoConfig =>
  wecomSsoConfigSchema.parse(input);

export const redactWecomSecrets = (
  config: WecomSsoConfig & { corpSecret?: string },
  secrets: WecomSsoEncryptedSecrets = {},
) => {
  const safeConfig = { ...config };
  delete safeConfig.corpSecret;

  return {
    ...safeConfig,
    corpSecret: undefined,
    corpSecretConfigured: Boolean(secrets.corpSecret),
  };
};

const normalizeEncryptedSecrets = (
  secrets: Record<string, string> | undefined,
): WecomSsoEncryptedSecrets => ({
  ...(secrets ?? {}),
});

const getDefaultWecomRedirectUri = () =>
  `${appEnv.APP_URL}/api/auth/oauth2/callback/${WECOM_SSO_PROVIDER}`;

const normalizeWecomConfigForStorage = (config: WecomSsoConfig): WecomSsoConfig => ({
  ...config,
  redirectUri: config.enabled ? getDefaultWecomRedirectUri() : config.redirectUri,
});

const assertWecomSsoProviderRegistered = () => {
  const registeredProviders = parseSSOProviders(authEnv.AUTH_SSO_PROVIDERS).map(
    (provider) => PROVIDER_ALIAS_MAP[provider] ?? provider,
  );

  if (!registeredProviders.includes(WECOM_SSO_PROVIDER)) {
    throw new Error('AUTH_SSO_PROVIDERS must include wecom to enable WeCom SSO');
  }
};

const hasOwnConfigKey = (config: UpsertWecomSsoConfigParams['config'], key: keyof WecomSsoConfig) =>
  Object.prototype.hasOwnProperty.call(config, key);

const inheritOmittedEnterpriseBlocks = (
  config: WecomSsoConfig,
  inputConfig: UpsertWecomSsoConfigParams['config'],
  existingConfig?: SsoProviderConfigItem['config'],
): WecomSsoConfig => {
  if (!existingConfig) return config;

  const existing = validateWecomSsoConfig({ ...existingConfig, enabled: false });

  return {
    ...config,
    aihubProvisioning: hasOwnConfigKey(inputConfig, 'aihubProvisioning')
      ? config.aihubProvisioning
      : existing.aihubProvisioning,
    departmentSync: hasOwnConfigKey(inputConfig, 'departmentSync')
      ? config.departmentSync
      : existing.departmentSync,
    identityMapping: hasOwnConfigKey(inputConfig, 'identityMapping')
      ? config.identityMapping
      : existing.identityMapping,
  };
};

const findWecomSsoConfig = (db: LobeChatDatabase) =>
  db.query.ssoProviderConfigs.findFirst({
    where: eq(ssoProviderConfigs.provider, WECOM_SSO_PROVIDER),
  });

const toWecomSsoConfigResult = (
  row?: null | Pick<
    SsoProviderConfigItem,
    'config' | 'displayName' | 'enabled' | 'encryptedSecrets' | 'provider'
>,
): WecomSsoConfigResult => {
  const rowEnabled = row?.enabled;
  const config = validateWecomSsoConfig({ ...(row?.config ?? {}), enabled: rowEnabled });
  const enabled = rowEnabled ?? config.enabled;
  const encryptedSecrets = normalizeEncryptedSecrets(row?.encryptedSecrets);

  return {
    config: {
      ...config,
      enabled,
    },
    corpSecretConfigured: Boolean(encryptedSecrets.corpSecret),
    displayName: WECOM_SSO_DISPLAY_NAME,
    enabled,
    provider: WECOM_SSO_PROVIDER,
  };
};

export const getWecomSsoConfig = async (db: LobeChatDatabase): Promise<WecomSsoConfigResult> => {
  const row = await findWecomSsoConfig(db);

  if (row) return toWecomSsoConfigResult(row);

  // env-only mode: no DB row but env vars are set → treat as enabled with defaults
  const envConfig = getEnvRuntimeConfig();
  if (envConfig) {
    return {
      config: validateWecomSsoConfig({
        agentId: envConfig.agentId,
        corpId: envConfig.corpId,
        enabled: true,
      }),
      corpSecretConfigured: true,
      displayName: WECOM_SSO_DISPLAY_NAME,
      enabled: true,
      provider: WECOM_SSO_PROVIDER,
    };
  }

  return toWecomSsoConfigResult(undefined);
};

export const upsertWecomSsoConfig = async (
  db: LobeChatDatabase,
  params: UpsertWecomSsoConfigParams,
  updatedBy: string,
): Promise<WecomSsoConfigResult> => {
  const existing = await findWecomSsoConfig(db);
  const input = wecomSsoUpsertInputSchema.parse(params);
  const config = normalizeWecomConfigForStorage(
    inheritOmittedEnterpriseBlocks(input.config, params.config, existing?.config),
  );
  const encryptedSecrets = normalizeEncryptedSecrets(existing?.encryptedSecrets);

  if (config.enabled) {
    assertWecomSsoProviderRegistered();
  }

  if (config.enabled && !input.corpSecret && !encryptedSecrets.corpSecret) {
    throw new Error('Corp Secret is required when WeCom SSO is enabled');
  }

  if (input.corpSecret) {
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    encryptedSecrets.corpSecret = await gateKeeper.encrypt(input.corpSecret);
  }

  const values = {
    config,
    displayName: WECOM_SSO_DISPLAY_NAME,
    enabled: config.enabled,
    encryptedSecrets,
    provider: WECOM_SSO_PROVIDER,
    updatedBy,
  };

  const [row] = existing
    ? await db
        .update(ssoProviderConfigs)
        .set(values)
        .where(eq(ssoProviderConfigs.provider, WECOM_SSO_PROVIDER))
        .returning()
    : await db.insert(ssoProviderConfigs).values(values).returning();

  return toWecomSsoConfigResult(row ?? values);
};

const getEnvRuntimeConfig = (): WecomSsoRuntimeConfig | undefined => {
  if (
    !authEnv.AUTH_WECOM_CORP_ID ||
    !authEnv.AUTH_WECOM_AGENT_ID ||
    !authEnv.AUTH_WECOM_CORP_SECRET
  ) {
    return;
  }

  return {
    agentId: authEnv.AUTH_WECOM_AGENT_ID,
    corpId: authEnv.AUTH_WECOM_CORP_ID,
    corpSecret: authEnv.AUTH_WECOM_CORP_SECRET,
    enabled: true,
    enabledModes: [...WECOM_SSO_DEFAULT_MODES],
    redirectUri: getDefaultWecomRedirectUri(),
  };
};

const decryptCorpSecret = async (encryptedSecret: string) => {
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const result = await gateKeeper.decrypt(encryptedSecret);

  if (!result.wasAuthentic || !result.plaintext) {
    throw new Error('Failed to decrypt WeCom Corp Secret');
  }

  return result.plaintext;
};

export const getWecomSsoRuntimeConfig = async (
  db?: LobeChatDatabase,
): Promise<WecomSsoRuntimeConfig> => {
  const serverDB = db ?? (await getServerDB());
  const row = await findWecomSsoConfig(serverDB);

  if (!row) {
    const envConfig = getEnvRuntimeConfig();
    if (!envConfig) {
      throw new Error('WeCom SSO is not configured');
    }

    return envConfig;
  }

  const enabled = row.enabled;
  const config = validateWecomSsoConfig({ ...(row.config ?? {}), enabled });

  if (!enabled) {
    throw new Error('WeCom SSO is disabled');
  }

  const encryptedSecrets = normalizeEncryptedSecrets(row.encryptedSecrets);
  const corpSecret = encryptedSecrets.corpSecret
    ? await decryptCorpSecret(encryptedSecrets.corpSecret)
    : undefined;

  if (!corpSecret) {
    throw new Error('WeCom Corp Secret is not configured');
  }

  return {
    agentId: config.agentId,
    corpId: config.corpId,
    corpSecret,
    enabled: true,
    enabledModes: config.enabledModes,
    redirectUri: getDefaultWecomRedirectUri(),
  };
};
