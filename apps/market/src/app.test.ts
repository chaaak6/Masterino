import {
  buildTrustedClientPayload,
  createTrustedClientToken,
  MarketSDK,
} from '@lobehub/market-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMarketApp } from './app.js';
import type { MarketConfig } from './config.js';
import { encryptJson } from './crypto.js';
import { ONBOARDING_AGENT_CATALOG, ONBOARDING_AGENT_IDENTIFIERS } from './onboardingCatalog.js';

const secret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const actor = {
  email: 'employee@example.com',
  name: 'Employee',
  userId: 'user-1',
  workspaceId: 'workspace-1',
};
const token = createTrustedClientToken(
  buildTrustedClientPayload({ ...actor, clientId: 'masterino' }),
  secret,
);

const config: MarketConfig = {
  MARKET_ADMIN_USER_IDS: 'user-1',
  MARKET_CREDENTIAL_ENCRYPTION_KEY: 'credential-key-at-least-thirty-two-bytes',
  MARKET_DATABASE_URL: 'postgres://unused',
  MARKET_IMPORT_SIGNING_KEY: 'import-key-at-least-thirty-two-bytes',
  MARKET_OBJECT_STORAGE_ACCESS_KEY_ID: 'unused',
  MARKET_OBJECT_STORAGE_BUCKET: 'market',
  MARKET_OBJECT_STORAGE_ENDPOINT: 'http://oss.local',
  MARKET_OBJECT_STORAGE_FORCE_PATH_STYLE: '1',
  MARKET_OBJECT_STORAGE_REGION: 'us-east-1',
  MARKET_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'unused',
  MARKET_OAUTH_CLIENTS_JSON: '{}',
  MARKET_OAUTH_REDIRECT_ORIGINS: 'https://masterino.example.com',
  MARKET_PORT: 3220,
  MARKET_PUBLIC_BASE_URL: 'https://masterino.example.com/market',
  MARKET_REDIS_URL: 'redis://unused',
  MARKET_RUNNER_INTERNAL_TOKEN: 'runner-token-at-least-thirty-two-bytes',
  MARKET_RUNNER_INTERNAL_URL: 'http://runner.local',
  MARKET_TRUSTED_CLIENT_IDS: 'masterino',
  MARKET_TRUSTED_CLIENT_SECRET: secret,
};

const account = {
  email: actor.email,
  externalUserId: actor.userId,
  id: 7,
  name: actor.name,
  role: 'admin' as const,
};

const createRepository = () => ({
  audit: vi.fn(async () => undefined),
  categories: vi.fn(async () => []),
  detail: vi.fn(async (_type, identifier) => ({
    config: { model: 'internal-model' },
    identifier,
    name: 'Internal Assistant',
  })),
  getPool: () => ({
    query: vi.fn(async (sql: string) =>
      sql.includes('INSERT INTO market_events')
        ? { rowCount: 1, rows: [{ id: 42 }] }
        : { rowCount: 0, rows: [] },
    ),
  }),
  list: vi.fn(async () => ({
    currentPage: 1,
    items: [{ identifier: 'internal-assistant', name: 'Internal Assistant' }],
    pageSize: 20,
    totalCount: 1,
    totalPages: 1,
  })),
  social: vi.fn(async () => ({ isFavorited: true, success: true })),
  syncAccount: vi.fn(async () => account),
});

afterEach(() => vi.restoreAllMocks());

describe('Market SDK compatibility', () => {
  it('rejects unauthenticated curated seed requests before touching storage', async () => {
    const app = createMarketApp({
      config,
      redis: { ping: vi.fn(async () => 'PONG') } as any,
      repository: createRepository() as any,
      storage: { ping: vi.fn(async () => undefined) } as any,
    });

    const response = await app.request('/api/internal/curated-seed', { method: 'POST' });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  it('redirects the public service root to the enabled skill market', async () => {
    const app = createMarketApp({
      config,
      redis: { ping: vi.fn(async () => 'PONG') } as any,
      repository: createRepository() as any,
      storage: { ping: vi.fn(async () => undefined) } as any,
    });

    const response = await app.request('/');

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://masterino.example.com/community');
  });

  it('serves the SDK agent list and detail routes with trusted-client identity', async () => {
    const repository = createRepository();
    const app = createMarketApp({
      config,
      redis: { ping: vi.fn(async () => 'PONG') } as any,
      repository: repository as any,
      storage: { ping: vi.fn(async () => undefined) } as any,
    });
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      app.request(input.toString(), init),
    );
    const sdk = new MarketSDK({ baseURL: 'http://market.local', trustedClientToken: token });

    const list = await sdk.agents.getAgentList({ locale: 'zh-CN' });
    const detail = await sdk.agents.getAgentDetail('internal-assistant');

    expect(list.items).toHaveLength(1);
    expect(detail.config).toEqual({ model: 'internal-model' });
    expect(repository.syncAccount).toHaveBeenCalledWith(
      expect.objectContaining({ userId: actor.userId, workspaceId: actor.workspaceId }),
      expect.any(Set),
    );
  });

  it('rejects forged trusted client tokens', async () => {
    const app = createMarketApp({
      config,
      redis: { ping: vi.fn(async () => 'PONG') } as any,
      repository: createRepository() as any,
      storage: { ping: vi.fn(async () => undefined) } as any,
    });
    const response = await app.request('/api/v1/agents', {
      headers: { 'x-lobe-trust-token': `${token}tampered` },
    });
    expect(response.status).toBe(401);
  });

  it('filters and paginates the internal Admin resource catalog', async () => {
    const query = vi.fn(async () => ({
      rowCount: 1,
      rows: [
        {
          category: 'office',
          description: 'Internal skill',
          identifier: 'internal-skill',
          name: 'Internal Skill',
          ownerName: 'Employee',
          ownerUserId: 'user-1',
          status: 'published',
          tags: [],
          totalCount: 21,
          type: 'skill',
          updatedAt: '2026-08-14T00:00:00.000Z',
          version: '1.0.0',
          visibility: 'internal',
          workflowState: 'published',
        },
      ],
    }));
    const repository = { ...createRepository(), getPool: () => ({ query }) };
    const app = createMarketApp({
      config,
      redis: { ping: vi.fn(async () => 'PONG') } as any,
      repository: repository as any,
      storage: { ping: vi.fn(async () => undefined) } as any,
    });

    const response = await app.request(
      '/api/internal/resources?type=skill&workflowState=published&visibility=internal&clientVisible=true&page=2&pageSize=20&q=office',
      { headers: { 'x-lobe-trust-token': token } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      currentPage: 2,
      items: [expect.objectContaining({ clientVisible: true, identifier: 'internal-skill' })],
      pageSize: 20,
      totalCount: 21,
      totalPages: 2,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("r.visibility IN ('internal','public')"),
      ['skill', 'internal', 'published', '%office%', 20, 20],
    );
  });

  it('denies internal Admin catalog access to Market submitters', async () => {
    const repository = {
      ...createRepository(),
      syncAccount: vi.fn(async () => ({ ...account, role: 'submitter' as const })),
    };
    const app = createMarketApp({
      config,
      redis: { ping: vi.fn(async () => 'PONG') } as any,
      repository: repository as any,
      storage: { ping: vi.fn(async () => undefined) } as any,
    });

    const response = await app.request('/api/internal/resources', {
      headers: { 'x-lobe-trust-token': token },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden' });
  });

  it('returns plaintext only on the authenticated server-side decrypt contract', async () => {
    const encryptedValue = encryptJson(
      { API_TOKEN: 'secret' },
      config.MARKET_CREDENTIAL_ENCRYPTION_KEY,
    );
    const pool = {
      query: vi.fn(async (sql: string) =>
        sql.includes('market_credentials')
          ? {
              rowCount: 1,
              rows: [
                {
                  created_at: new Date(),
                  encrypted_value: encryptedValue,
                  id: 9,
                  key: 'api',
                  metadata: {},
                  name: 'API',
                  type: 'kv-env',
                  updated_at: new Date(),
                },
              ],
            }
          : { rowCount: 0, rows: [] },
      ),
    };
    const repository = { ...createRepository(), getPool: () => pool };
    const app = createMarketApp({
      config,
      redis: { ping: vi.fn(async () => 'PONG') } as any,
      repository: repository as any,
      storage: { ping: vi.fn(async () => undefined) } as any,
    });

    const masked = await app.request('/api/v1/user/creds/9', {
      headers: { 'x-lobe-trust-token': token },
    });
    const decrypted = await app.request('/api/v1/user/creds/9?decrypt=true', {
      headers: { 'x-lobe-trust-token': token },
    });

    expect(await masked.json()).not.toHaveProperty('plaintext');
    expect(await decrypted.json()).toHaveProperty('plaintext.API_TOKEN', 'secret');
  });

  it('serves the current SDK catalog, connection, social, feedback, and task-template surfaces', async () => {
    const repository = createRepository();
    const app = createMarketApp({
      config,
      redis: { ping: vi.fn(async () => 'PONG') } as any,
      repository: repository as any,
      storage: { ping: vi.fn(async () => undefined) } as any,
    });
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      app.request(input.toString(), init),
    );
    const sdk = new MarketSDK({ baseURL: 'http://market.local', trustedClientToken: token });

    await expect(sdk.agentGroups.getAgentGroupList()).resolves.toHaveProperty('items');
    await expect(sdk.marketSkills.getSkillList()).resolves.toHaveProperty('items');
    await expect(sdk.marketSkills.getSkillDetail('internal-skill')).resolves.toHaveProperty(
      'identifier',
      'internal-skill',
    );
    await expect(sdk.plugins.getPluginList()).resolves.toHaveProperty('items');
    await expect(
      sdk.plugins.getPluginDetail({ identifier: 'internal-mcp' }),
    ).resolves.toHaveProperty('identifier', 'internal-mcp');
    await expect(sdk.connect.listConnections()).resolves.toEqual({
      connections: [],
      success: true,
    });
    await expect(sdk.favorites.addFavorite('agent', 'internal-assistant')).resolves.toHaveProperty(
      'success',
      true,
    );
    await expect(
      sdk.feedback.submitFeedback({
        email: actor.email,
        message: 'Test',
        title: 'Internal feedback',
      }),
    ).resolves.toMatchObject({ issueId: '42', success: true });
    await expect(
      sdk.taskTemplates.getTaskTemplateRecommendations({ interestKeys: ['coding'] }),
    ).resolves.toEqual({ items: [] });
  });

  it('creates a short-lived OAuth handoff without storing the client secret in Redis', async () => {
    const redis = {
      del: vi.fn(async (..._args: any[]) => 1),
      get: vi.fn(async (..._args: any[]) => null),
      ping: vi.fn(async () => 'PONG'),
      set: vi.fn(async (..._args: any[]) => 'OK'),
    };
    const repository = {
      ...createRepository(),
      detail: vi.fn(async () => ({
        config: {},
        identifier: 'linear',
        manifest: {
          oauth: {
            authorizationUrl: 'https://linear.example.com/oauth/authorize',
            scopes: ['read'],
            tokenUrl: 'https://linear.example.com/oauth/token',
          },
        },
      })),
      getPool: () => ({ query: vi.fn(async () => ({ rowCount: 1, rows: [{}] })) }),
    };
    const oauthConfig = {
      ...config,
      MARKET_OAUTH_CLIENTS_JSON: JSON.stringify({
        linear: { clientId: 'client-id', clientSecret: 'client-secret' },
      }),
    };
    const app = createMarketApp({
      config: oauthConfig,
      redis: redis as any,
      repository: repository as any,
      storage: { ping: vi.fn(async () => undefined) } as any,
    });
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      app.request(input.toString(), init),
    );
    const sdk = new MarketSDK({ baseURL: 'http://market.local', trustedClientToken: token });

    const response = await sdk.connect.authorize('linear', {
      redirect_uri: 'https://masterino.example.com/oauth/callback',
    });

    expect(response.authorize_url).toContain(
      'https://masterino.example.com/market/connect/linear/start?code=',
    );
    const storedState = String(redis.set.mock.calls[0][1]);
    expect(storedState).toContain('client-id');
    expect(storedState).not.toContain('client-secret');
  });
});

it('returns only the ordered onboarding allowlist with environment-correct avatars', async () => {
  const items = [
    { identifier: 'other-published-agent', name: 'Other Agent' },
    ...[...ONBOARDING_AGENT_CATALOG].reverse().map((entry) => ({
      avatar: 'https://wrong-environment.example.com/avatar.svg',
      category: 'office',
      identifier: entry.identifier,
      name: entry.identifier,
    })),
  ];
  const repository = {
    ...createRepository(),
    list: vi.fn(async () => ({
      currentPage: 1,
      items,
      pageSize: items.length,
      totalCount: items.length,
      totalPages: 1,
    })),
  };
  const app = createMarketApp({
    config,
    redis: { ping: vi.fn(async () => 'PONG') } as any,
    repository: repository as any,
    storage: { ping: vi.fn(async () => undefined) } as any,
  });
  const response = await app.request('/api/v1/agents/onboarding-full', {
    headers: { 'x-lobe-trust-token': token },
  });
  expect(response.status).toBe(200);
  expect(repository.list).toHaveBeenCalledWith(
    'agent',
    {
      identifiers: ONBOARDING_AGENT_IDENTIFIERS,
      pageSize: 8,
      publishedOriginalsOnly: true,
    },
    account,
    'workspace-1',
  );

  const data = (await response.json()) as Record<
    string,
    Array<{ avatar: string; category: string; identifier: string }>
  >;
  const returned = Object.values(data).flat();
  expect(returned).toHaveLength(8);
  expect(new Set(returned.map((item) => item.identifier))).toEqual(
    new Set(ONBOARDING_AGENT_IDENTIFIERS),
  );
  expect(returned.some((item) => item.identifier === 'other-published-agent')).toBe(false);
  for (const item of returned) {
    const contract = ONBOARDING_AGENT_CATALOG.find((entry) => entry.identifier === item.identifier);
    expect(item.category).toBe(contract?.category);
    expect(item.avatar).toBe(`https://masterino.example.com/market${contract?.avatar}`);
  }
});

it('serves only fixed versioned avatar artwork without authentication', async () => {
  const repository = createRepository();
  const app = createMarketApp({
    config,
    repository: repository as any,
    redis: { ping: vi.fn(async () => 'PONG') } as any,
    storage: { ping: vi.fn(async () => undefined) } as any,
  });
  for (const name of [
    'meeting',
    'writing',
    'translation',
    'research',
    'project',
    'code',
    'prompt',
    'business',
  ]) {
    const response = await app.request(`/assets/agent-avatars/v1/${name}.svg`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(response.headers.get('Cache-Control')).toContain('immutable');
    expect(await response.text()).toContain('<svg');
  }
  for (const name of ['unknown.svg', 'constructor', '__proto__']) {
    expect((await app.request(`/assets/agent-avatars/v1/${name}`)).status).toBe(404);
  }
  expect(repository.syncAccount).not.toHaveBeenCalled();
});
