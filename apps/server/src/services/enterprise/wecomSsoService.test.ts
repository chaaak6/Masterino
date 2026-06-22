// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import {
  getWecomSsoRuntimeConfig,
  getWecomSsoConfig,
  redactWecomSecrets,
  upsertWecomSsoConfig,
  validateWecomSsoConfig,
} from './wecomSsoService';

const { mockAuthEnv, mockGetServerDB } = vi.hoisted(() => ({
  mockAuthEnv: {
    AUTH_SSO_PROVIDERS: undefined as string | undefined,
    AUTH_WECOM_AGENT_ID: undefined as string | undefined,
    AUTH_WECOM_CORP_ID: undefined as string | undefined,
    AUTH_WECOM_CORP_SECRET: undefined as string | undefined,
  },
  mockGetServerDB: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: mockGetServerDB,
}));

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://app.example.com' },
}));

vi.mock('@/envs/auth', () => ({
  authEnv: mockAuthEnv,
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: vi.fn(),
  },
}));

const createMockDb = (existingRow: unknown = null) => {
  let insertValues: unknown;
  let updateValues: unknown;

  const insertChain = {
    returning: vi.fn(async () => [{ ...(insertValues as Record<string, unknown>), id: 'sso-1' }]),
    values: vi.fn((values: unknown) => {
      insertValues = values;
      return insertChain;
    }),
  };

  const updateChain = {
    returning: vi.fn(async () => [{ ...(updateValues as Record<string, unknown>), id: 'sso-1' }]),
    set: vi.fn((values: unknown) => {
      updateValues = values;
      return updateChain;
    }),
    where: vi.fn(() => updateChain),
  };

  return {
    db: {
      insert: vi.fn(() => insertChain),
      query: {
        ssoProviderConfigs: {
          findFirst: vi.fn(async () => existingRow),
        },
      },
      update: vi.fn(() => updateChain),
    },
    getInsertValues: () => insertValues,
    getUpdateValues: () => updateValues,
    insertChain,
    updateChain,
  };
};

const defaultEnterpriseWecomBlocks = {
  aihubProvisioning: {
    autoCreateUser: true,
    enabled: true,
    initialQuota: 50_000_000,
    lookupField: 'employeeNumber',
    managedTokenName: 'masterlion-managed',
    managedTokenQuota: 50_000_000,
    managedTokenUnlimitedQuota: false,
  },
  departmentSync: {
    enabled: false,
    mode: 'login',
  },
  identityMapping: {
    departmentField: 'department',
    emailField: 'email',
    employeeNumberField: 'userid',
    mobileField: 'mobile',
    nameField: 'name',
    positionField: 'position',
  },
};

describe('wecomSsoService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthEnv.AUTH_SSO_PROVIDERS = 'wecom';
    mockAuthEnv.AUTH_WECOM_AGENT_ID = undefined;
    mockAuthEnv.AUTH_WECOM_CORP_ID = undefined;
    mockAuthEnv.AUTH_WECOM_CORP_SECRET = undefined;
  });

  it('parses a valid config with defaults and trimmed list fields', () => {
    expect(
      validateWecomSsoConfig({
        agentId: ' 1000002 ',
        corpId: ' ww-corp ',
        enabledModes: ['web_qr'],
        trustedDomains: [' example.com ', '', 'example.com'],
      }),
    ).toEqual({
      agentId: '1000002',
      autoProvision: true,
      corpId: 'ww-corp',
      defaultRole: 'member',
      defaultWorkspaceId: undefined,
      enabled: false,
      enabledModes: ['web_qr'],
      redirectUri: '',
      trustedDomains: ['example.com'],
      ...defaultEnterpriseWecomBlocks,
    });
  });

  it('normalizes identity mapping fields with trimmed values and defaults for blanks', () => {
    expect(
      validateWecomSsoConfig({
        identityMapping: {
          departmentField: ' ',
          emailField: ' mail ',
          employeeNumberField: ' employee_no ',
          mobileField: '',
          nameField: ' display_name ',
          positionField: ' title ',
        },
      }).identityMapping,
    ).toEqual({
      departmentField: 'department',
      emailField: 'mail',
      employeeNumberField: 'employee_no',
      mobileField: 'mobile',
      nameField: 'display_name',
      positionField: 'title',
    });
  });

  it('normalizes department sync with login default and supported modes', () => {
    expect(validateWecomSsoConfig({ departmentSync: { enabled: true } }).departmentSync).toEqual({
      enabled: true,
      mode: 'login',
    });

    expect(validateWecomSsoConfig({ departmentSync: { mode: 'scheduled' } }).departmentSync).toEqual(
      {
        enabled: false,
        mode: 'scheduled',
      },
    );
  });

  it('rejects unsupported department sync modes', () => {
    expect(() => validateWecomSsoConfig({ departmentSync: { mode: 'realtime' } })).toThrow();
  });

  it('normalizes aihub provisioning defaults, trimmed strings, and optional user group', () => {
    expect(
      validateWecomSsoConfig({
        aihubProvisioning: {
          autoCreateUser: false,
          enabled: false,
          initialQuota: 50,
          lookupField: ' email ',
          managedTokenName: ' ops-managed ',
          managedTokenQuota: 250,
          managedTokenUnlimitedQuota: false,
          userGroup: ' aihub-staff ',
        },
      }).aihubProvisioning,
    ).toEqual({
      autoCreateUser: false,
      enabled: false,
      initialQuota: 50,
      lookupField: 'email',
      managedTokenName: 'ops-managed',
      managedTokenQuota: 250,
      managedTokenUnlimitedQuota: false,
      userGroup: 'aihub-staff',
    });

    expect(validateWecomSsoConfig({}).aihubProvisioning).toEqual({
      autoCreateUser: true,
      enabled: true,
      initialQuota: 50_000_000,
      lookupField: 'employeeNumber',
      managedTokenName: 'masterlion-managed',
      managedTokenQuota: 50_000_000,
      managedTokenUnlimitedQuota: false,
    });
  });

  it('falls back blank aihub provisioning strings to defaults or undefined', () => {
    expect(
      validateWecomSsoConfig({
        aihubProvisioning: {
          lookupField: '',
          managedTokenName: ' ',
          userGroup: ' ',
        },
      }).aihubProvisioning,
    ).toEqual(defaultEnterpriseWecomBlocks.aihubProvisioning);
  });

  it('rejects negative aihub provisioning quotas', () => {
    expect(() =>
      validateWecomSsoConfig({ aihubProvisioning: { initialQuota: -1 } }),
    ).toThrow();
    expect(() =>
      validateWecomSsoConfig({ aihubProvisioning: { managedTokenQuota: -1 } }),
    ).toThrow();
  });

  it('rejects unsupported aihub provisioning lookup fields', () => {
    expect(() => validateWecomSsoConfig({ aihubProvisioning: { lookupField: 'mobile' } })).toThrow();
    expect(() => validateWecomSsoConfig({ aihubProvisioning: { lookupField: 'department' } })).toThrow();
  });

  it('rejects invalid redirectUri and enabledModes values', () => {
    expect(() => validateWecomSsoConfig({ redirectUri: 'not-a-url' })).toThrow();
    expect(() => validateWecomSsoConfig({ enabledModes: ['mobile'] })).toThrow();
  });

  it('rejects enabled configs without required fields or a configured secret', async () => {
    expect(() => validateWecomSsoConfig({ enabled: true })).toThrow();

    const { db } = createMockDb();

    await expect(
      upsertWecomSsoConfig(
        db as never,
        {
          config: {
            agentId: '1000002',
            corpId: 'ww-corp',
            enabled: true,
            enabledModes: ['web_qr'],
            redirectUri: 'https://example.com/api/auth/oauth2/callback/wecom',
          },
        },
        'user-admin',
      ),
    ).rejects.toThrow('Corp Secret');
  });

  it('redacts corpSecret and reports whether a secret is configured', () => {
    const redacted = redactWecomSecrets(
      { ...validateWecomSsoConfig({ corpId: 'ww-corp' }), corpSecret: 'plain-secret' },
      { corpSecret: 'encrypted-secret' },
    );

    expect(redacted.corpSecret).toBeUndefined();
    expect(redacted.corpSecretConfigured).toBe(true);
  });

  it('returns a default config when no WeCom SSO row exists', async () => {
    const { db } = createMockDb();

    await expect(getWecomSsoConfig(db as never)).resolves.toEqual({
      config: {
        agentId: '',
        autoProvision: true,
        corpId: '',
        defaultRole: 'member',
        defaultWorkspaceId: undefined,
        enabled: false,
        enabledModes: ['web_qr', 'workbench'],
        redirectUri: '',
        trustedDomains: [],
        ...defaultEnterpriseWecomBlocks,
      },
      corpSecretConfigured: false,
      displayName: '企业微信',
      enabled: false,
      provider: 'wecom',
    });
  });

  it('does not report env secret as configured when a DB row exists without encrypted secret', async () => {
    mockAuthEnv.AUTH_WECOM_CORP_SECRET = 'env-secret';

    const { db } = createMockDb({
      config: validateWecomSsoConfig({ enabled: false }),
      displayName: '企业微信',
      enabled: false,
      encryptedSecrets: {},
      provider: 'wecom',
    });

    await expect(getWecomSsoConfig(db as never)).resolves.toMatchObject({
      corpSecretConfigured: false,
    });
  });

  it('encrypts corpSecret on upsert and never stores it in plaintext config', async () => {
    const mockGateKeeper = {
      encrypt: vi.fn(async () => 'ciphertext'),
    };
    vi.mocked(KeyVaultsGateKeeper.initWithEnvKey).mockResolvedValue(mockGateKeeper as never);

    const { db, getInsertValues } = createMockDb();

    const result = await upsertWecomSsoConfig(
      db as never,
      {
        config: {
          agentId: '1000002',
          autoProvision: true,
          corpId: 'ww-corp',
          defaultRole: 'admin',
          defaultWorkspaceId: 'workspace-1',
          enabled: true,
          enabledModes: ['web_qr', 'workbench'],
          redirectUri: 'https://example.com/api/auth/oauth2/callback/wecom',
          trustedDomains: ['example.com'],
        },
        corpSecret: 'plain-secret',
      },
      'user-admin',
    );

    const saved = getInsertValues() as Record<string, unknown>;

    expect(KeyVaultsGateKeeper.initWithEnvKey).toHaveBeenCalled();
    expect(mockGateKeeper.encrypt).toHaveBeenCalledWith('plain-secret');
    expect(saved).toMatchObject({
      displayName: '企业微信',
      enabled: true,
      encryptedSecrets: { corpSecret: 'ciphertext' },
      provider: 'wecom',
      updatedBy: 'user-admin',
    });
    expect(saved.config).not.toHaveProperty('corpSecret');
    expect(JSON.stringify(saved)).not.toContain('plain-secret');
    expect(result.corpSecretConfigured).toBe(true);
  });

  it('rejects enabling WeCom SSO when AUTH_SSO_PROVIDERS does not register wecom', async () => {
    mockAuthEnv.AUTH_SSO_PROVIDERS = '';

    const mockGateKeeper = {
      encrypt: vi.fn(async () => 'ciphertext'),
    };
    vi.mocked(KeyVaultsGateKeeper.initWithEnvKey).mockResolvedValue(mockGateKeeper as never);

    const { db } = createMockDb();

    let error: unknown;
    await upsertWecomSsoConfig(
      db as never,
      {
        config: {
          agentId: '1000002',
          corpId: 'ww-corp',
          enabled: true,
          enabledModes: ['web_qr'],
          redirectUri: 'https://example.com/api/auth/oauth2/callback/wecom',
        },
        corpSecret: 'plain-secret',
      },
      'user-admin',
    ).catch((caught) => {
      error = caught;
    });

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('AUTH_SSO_PROVIDERS');
    expect((error as Error).message).toContain('wecom');
    expect(KeyVaultsGateKeeper.initWithEnvKey).not.toHaveBeenCalled();
    expect(mockGateKeeper.encrypt).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it.each(['enterprise-wechat', 'wework'])(
    'allows enabling WeCom SSO when AUTH_SSO_PROVIDERS registers historical alias %s',
    async (providerAlias) => {
      mockAuthEnv.AUTH_SSO_PROVIDERS = providerAlias;

      const mockGateKeeper = {
        encrypt: vi.fn(async () => 'ciphertext'),
      };
      vi.mocked(KeyVaultsGateKeeper.initWithEnvKey).mockResolvedValue(mockGateKeeper as never);

      const { db, getInsertValues } = createMockDb();

      await upsertWecomSsoConfig(
        db as never,
        {
          config: {
            agentId: '1000002',
            corpId: 'ww-corp',
            enabled: true,
            enabledModes: ['web_qr'],
            redirectUri: 'https://example.com/api/auth/oauth2/callback/wecom',
          },
          corpSecret: 'plain-secret',
        },
        'user-admin',
      );

      expect(getInsertValues()).toMatchObject({
        enabled: true,
        encryptedSecrets: { corpSecret: 'ciphertext' },
        provider: 'wecom',
      });
      expect(mockGateKeeper.encrypt).toHaveBeenCalledWith('plain-secret');
    },
  );

  it('preserves enterprise identity, department sync, and aihub provisioning blocks on upsert', async () => {
    const { db, getInsertValues } = createMockDb();

    await upsertWecomSsoConfig(
      db as never,
      {
        config: {
          agentId: '1000002',
          aihubProvisioning: {
            autoCreateUser: false,
            enabled: true,
            initialQuota: 100,
            lookupField: 'email',
            managedTokenName: 'corp-managed',
            managedTokenQuota: 500,
            managedTokenUnlimitedQuota: false,
            userGroup: 'aihub-beta',
          },
          corpId: 'ww-corp',
          departmentSync: {
            enabled: true,
            mode: 'manual',
          },
          enabled: false,
          identityMapping: {
            departmentField: 'dept_ids',
            emailField: 'work_email',
            employeeNumberField: 'employee_no',
            mobileField: 'phone',
            nameField: 'display_name',
            positionField: 'job_title',
          },
        },
      },
      'user-admin',
    );

    expect((getInsertValues() as Record<string, unknown>).config).toMatchObject({
      aihubProvisioning: {
        autoCreateUser: false,
        enabled: true,
        initialQuota: 100,
        lookupField: 'email',
        managedTokenName: 'corp-managed',
        managedTokenQuota: 500,
        managedTokenUnlimitedQuota: false,
        userGroup: 'aihub-beta',
      },
      departmentSync: {
        enabled: true,
        mode: 'manual',
      },
      identityMapping: {
        departmentField: 'dept_ids',
        emailField: 'work_email',
        employeeNumberField: 'employee_no',
        mobileField: 'phone',
        nameField: 'display_name',
        positionField: 'job_title',
      },
    });
  });

  it('inherits existing enterprise blocks when updating with partial legacy input', async () => {
    const existingEnterpriseBlocks = {
      aihubProvisioning: {
        autoCreateUser: false,
        enabled: true,
        initialQuota: 100,
        lookupField: 'email',
        managedTokenName: 'corp-managed',
        managedTokenQuota: 500,
        managedTokenUnlimitedQuota: false,
        userGroup: 'aihub-beta',
      },
      departmentSync: {
        enabled: true,
        mode: 'manual' as const,
      },
      identityMapping: {
        departmentField: 'dept_ids',
        emailField: 'work_email',
        employeeNumberField: 'employee_no',
        mobileField: 'phone',
        nameField: 'display_name',
        positionField: 'job_title',
      },
    };
    const existingRow = {
      config: validateWecomSsoConfig({
        agentId: 'old-agent',
        corpId: 'old-corp',
        enabled: false,
        ...existingEnterpriseBlocks,
      }),
      displayName: '企业微信',
      enabled: false,
      encryptedSecrets: { corpSecret: 'old-ciphertext' },
      provider: 'wecom',
    };
    const { db, getUpdateValues } = createMockDb(existingRow);

    await upsertWecomSsoConfig(
      db as never,
      {
        config: {
          agentId: 'new-agent',
          corpId: 'new-corp',
          defaultRole: 'admin',
          enabled: false,
        },
      },
      'user-admin',
    );

    expect((getUpdateValues() as Record<string, unknown>).config).toMatchObject({
      agentId: 'new-agent',
      corpId: 'new-corp',
      defaultRole: 'admin',
      ...existingEnterpriseBlocks,
    });
  });

  it('preserves existing encryptedSecrets when update omits corpSecret', async () => {
    const existingRow = {
      config: validateWecomSsoConfig({
        agentId: 'old-agent',
        corpId: 'old-corp',
        enabled: false,
      }),
      displayName: '企业微信',
      enabled: true,
      encryptedSecrets: { corpSecret: 'old-ciphertext' },
      provider: 'wecom',
    };
    const { db, getUpdateValues } = createMockDb(existingRow);

    await upsertWecomSsoConfig(
      db as never,
      {
        config: {
          agentId: 'new-agent',
          corpId: 'new-corp',
          enabled: false,
        },
      },
      'user-admin',
    );

    expect(KeyVaultsGateKeeper.initWithEnvKey).not.toHaveBeenCalled();
    expect(getUpdateValues()).toMatchObject({
      encryptedSecrets: { corpSecret: 'old-ciphertext' },
      updatedBy: 'user-admin',
    });
  });

  it('rejects enabling an existing DB row without DB or input secret even when env secret exists', async () => {
    mockAuthEnv.AUTH_WECOM_CORP_SECRET = 'env-secret';

    const { db } = createMockDb({
      config: validateWecomSsoConfig({
        agentId: 'old-agent',
        corpId: 'old-corp',
        enabled: false,
      }),
      displayName: '企业微信',
      enabled: false,
      encryptedSecrets: {},
      provider: 'wecom',
    });

    await expect(
      upsertWecomSsoConfig(
        db as never,
        {
          config: {
            agentId: '1000002',
            corpId: 'ww-corp',
            enabled: true,
            enabledModes: ['web_qr'],
            redirectUri: 'https://example.com/api/auth/oauth2/callback/wecom',
          },
        },
        'user-admin',
      ),
    ).rejects.toThrow('Corp Secret');
  });

  it('returns runtime config from DB first and decrypts the DB secret', async () => {
    mockAuthEnv.AUTH_WECOM_AGENT_ID = 'env-agent';
    mockAuthEnv.AUTH_WECOM_CORP_ID = 'env-corp';
    mockAuthEnv.AUTH_WECOM_CORP_SECRET = 'env-secret';

    const mockGateKeeper = {
      decrypt: vi.fn(async () => ({ plaintext: 'db-secret', wasAuthentic: true })),
    };
    vi.mocked(KeyVaultsGateKeeper.initWithEnvKey).mockResolvedValue(mockGateKeeper as never);

    const { db } = createMockDb({
      config: validateWecomSsoConfig({
        agentId: 'db-agent',
        corpId: 'db-corp',
        enabled: true,
        enabledModes: ['web_qr'],
        redirectUri: 'https://external.example.com/callback',
      }),
      displayName: '企业微信',
      enabled: true,
      encryptedSecrets: { corpSecret: 'ciphertext' },
      provider: 'wecom',
    });

    await expect(getWecomSsoRuntimeConfig(db as never)).resolves.toEqual({
      agentId: 'db-agent',
      corpId: 'db-corp',
      corpSecret: 'db-secret',
      enabled: true,
      enabledModes: ['web_qr'],
      redirectUri: 'https://app.example.com/api/auth/oauth2/callback/wecom',
    });
    expect(mockGateKeeper.decrypt).toHaveBeenCalledWith('ciphertext');
  });

  it('does not fallback to env secret when a DB row exists without encrypted secret', async () => {
    mockAuthEnv.AUTH_WECOM_AGENT_ID = 'env-agent';
    mockAuthEnv.AUTH_WECOM_CORP_ID = 'env-corp';
    mockAuthEnv.AUTH_WECOM_CORP_SECRET = 'env-secret';

    const { db } = createMockDb({
      config: validateWecomSsoConfig({
        agentId: 'db-agent',
        corpId: 'db-corp',
        enabled: true,
        enabledModes: ['web_qr'],
        redirectUri: 'https://app.example.com/api/auth/oauth2/callback/wecom',
      }),
      displayName: '企业微信',
      enabled: true,
      encryptedSecrets: {},
      provider: 'wecom',
    });

    await expect(getWecomSsoRuntimeConfig(db as never)).rejects.toThrow(
      'WeCom Corp Secret is not configured',
    );
  });

  it('does not fallback to env when a DB row exists but is disabled', async () => {
    mockAuthEnv.AUTH_WECOM_AGENT_ID = 'env-agent';
    mockAuthEnv.AUTH_WECOM_CORP_ID = 'env-corp';
    mockAuthEnv.AUTH_WECOM_CORP_SECRET = 'env-secret';

    const { db } = createMockDb({
      config: validateWecomSsoConfig({ enabled: false }),
      displayName: '企业微信',
      enabled: false,
      encryptedSecrets: {},
      provider: 'wecom',
    });

    await expect(getWecomSsoRuntimeConfig(db as never)).rejects.toThrow('disabled');
  });

  it('falls back to env runtime config when no DB row exists', async () => {
    mockAuthEnv.AUTH_WECOM_AGENT_ID = 'env-agent';
    mockAuthEnv.AUTH_WECOM_CORP_ID = 'env-corp';
    mockAuthEnv.AUTH_WECOM_CORP_SECRET = 'env-secret';

    const { db } = createMockDb();

    await expect(getWecomSsoRuntimeConfig(db as never)).resolves.toEqual({
      agentId: 'env-agent',
      corpId: 'env-corp',
      corpSecret: 'env-secret',
      enabled: true,
      enabledModes: ['web_qr', 'workbench'],
      redirectUri: 'https://app.example.com/api/auth/oauth2/callback/wecom',
    });
  });
});
