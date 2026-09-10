import { randomUUID, timingSafeEqual } from 'node:crypto';

import { type Context, Hono } from 'hono';
import { Redis } from 'ioredis';

import { getAgentAvatar } from './agentAvatars.js';
import { type AuthEnv, requireRole, trustedClientAuth } from './auth.js';
import type { MarketConfig } from './config.js';
import { splitCsv } from './config.js';
import {
  AdminResourceListQuerySchema,
  CredentialInputSchema,
  OfflineImportSchema,
  ResourceInputSchema,
  type ResourceType,
  ReviewActionSchema,
} from './contracts.js';
import {
  sha256,
  validateArtifactManifest,
  validateZipArchive,
  verifyImportSignature,
} from './crypto.js';
import { MarketObjectStorage } from './objectStorage.js';
import {
  ONBOARDING_AGENT_CATALOG,
  ONBOARDING_AGENT_IDENTIFIERS,
  resolveMarketAvatar,
} from './onboardingCatalog.js';
import type { Account, MarketRepository } from './repository.js';
import { runCuratedSeed } from './seed.js';
import { CredentialVault } from './vault.js';

interface AppEnv extends AuthEnv {
  Variables: AuthEnv['Variables'] & { account: Account };
}

const queryOptions = (c: Context<AppEnv>) => ({
  category: c.req.query('category'),
  locale: c.req.query('locale'),
  page: Number(c.req.query('page') || 1),
  pageSize: Number(c.req.query('pageSize') || 20),
  q: c.req.query('q'),
  sort: c.req.query('sort'),
});

const actorScope = (c: Context<AppEnv>) => ({
  account: c.get('account'),
  workspaceId: c.get('actor').workspaceId,
});

const jsonBody = async (c: Context<AppEnv>): Promise<Record<string, any>> => {
  const value = await c.req.json();
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('JSON object required');
  return value;
};

const identifierList = (items: Array<{ identifier: string; updatedAt?: string }>) =>
  items.map((item) => ({ identifier: item.identifier, lastModified: item.updatedAt }));

export const createMarketApp = (options: {
  config: MarketConfig;
  redis?: Redis;
  repository: MarketRepository;
  storage?: MarketObjectStorage;
}) => {
  const { config, repository } = options;
  const adminIds = splitCsv(config.MARKET_ADMIN_USER_IDS);
  const auth = trustedClientAuth({
    adminIds,
    clientIds: splitCsv(config.MARKET_TRUSTED_CLIENT_IDS),
    secret: config.MARKET_TRUSTED_CLIENT_SECRET,
  });
  const redis =
    options.redis ||
    new Redis(config.MARKET_REDIS_URL, { keyPrefix: 'masterino:market:', lazyConnect: true });
  const storage = options.storage || new MarketObjectStorage(config);
  const vault = new CredentialVault(repository.getPool(), config.MARKET_CREDENTIAL_ENCRYPTION_KEY);
  const oauthClients = JSON.parse(config.MARKET_OAUTH_CLIENTS_JSON) as Record<
    string,
    { clientId: string; clientSecret: string }
  >;
  const oauthRedirectOrigins = splitCsv(config.MARKET_OAUTH_REDIRECT_ORIGINS);
  const publicBaseUrl = config.MARKET_PUBLIC_BASE_URL.replace(/\/$/, '');
  const marketUiUrl = new URL('/community', publicBaseUrl).toString();
  const withPublicAvatar = <T extends Record<string, any>>(item: T): T => ({
    ...item,
    avatar: resolveMarketAvatar(item.avatar, publicBaseUrl),
  });
  const withPublicListAvatars = <T extends { items: Record<string, any>[] }>(result: T) => ({
    ...result,
    items: result.items.map(withPublicAvatar),
  });
  const app = new Hono<AppEnv>();

  app.onError((error, c) => {
    console.error('Market request failed', error);
    const status = /not found/i.test(error.message)
      ? 404
      : /owned|forbidden|transition/i.test(error.message)
        ? 403
        : 400;
    return c.json({ error: error.message }, status);
  });

  app.get('/', (c) => c.redirect(marketUiUrl));
  app.get('/assets/agent-avatars/v1/:name', (c) => {
    const svg = getAgentAvatar(c.req.param('name'));
    if (!svg) return c.notFound();
    c.header('Content-Type', 'image/svg+xml');
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Content-Security-Policy', "default-src 'none'; sandbox");
    return c.body(svg);
  });
  app.get('/health', (c) => c.json({ service: 'masterino-market', status: 'ok' }));
  app.post('/api/internal/curated-seed', async (c) => {
    const supplied = Buffer.from(c.req.header('x-market-internal-token') || '');
    const expected = Buffer.from(config.MARKET_RUNNER_INTERNAL_TOKEN);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    return c.json({ counts: await runCuratedSeed(config), success: true });
  });
  app.get('/connect/success', (c) => c.json({ status: 'connected', success: true }));
  app.get('/connect/:provider/start', async (c) => {
    const code = c.req.query('code');
    const raw = code ? await redis.get(`oauth:code:${code}`) : null;
    if (!raw) return c.json({ error: 'oauth_code_expired' }, 400);
    const state = JSON.parse(raw) as any;
    if (state.provider !== c.req.param('provider'))
      return c.json({ error: 'oauth_provider_mismatch' }, 400);
    const client = oauthClients[state.provider];
    if (!client) return c.json({ error: 'oauth_provider_not_configured' }, 400);
    const oauthState = randomUUID();
    await redis.set(`oauth:state:${oauthState}`, raw, 'EX', 300);
    await redis.del(`oauth:code:${code}`);
    const callbackUrl = `${publicBaseUrl}/connect/${encodeURIComponent(state.provider)}/callback`;
    const authorizationUrl = new URL(state.authorizationUrl);
    authorizationUrl.searchParams.set('client_id', state.clientId);
    authorizationUrl.searchParams.set('redirect_uri', callbackUrl);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('state', oauthState);
    if (state.scopes?.length) authorizationUrl.searchParams.set('scope', state.scopes.join(' '));
    return c.redirect(authorizationUrl.toString());
  });
  app.get('/connect/:provider/callback', async (c) => {
    const oauthState = c.req.query('state');
    const raw = oauthState ? await redis.get(`oauth:state:${oauthState}`) : null;
    if (!raw) return c.json({ error: 'oauth_state_expired' }, 400);
    await redis.del(`oauth:state:${oauthState}`);
    const state = JSON.parse(raw) as any;
    if (state.provider !== c.req.param('provider'))
      return c.json({ error: 'oauth_provider_mismatch' }, 400);
    const client = oauthClients[state.provider];
    if (!client) return c.json({ error: 'oauth_provider_not_configured' }, 400);
    if (c.req.query('error'))
      return c.json(
        { error: c.req.query('error'), message: c.req.query('error_description') },
        400,
      );
    const authorizationCode = c.req.query('code');
    if (!authorizationCode) return c.json({ error: 'oauth_authorization_code_required' }, 400);
    const tokenResponse = await fetch(`${config.MARKET_RUNNER_INTERNAL_URL}/internal/run`, {
      body: JSON.stringify({
        body: {
          client_id: state.clientId,
          client_secret: client.clientSecret,
          code: authorizationCode,
          grant_type: 'authorization_code',
          redirect_uri: `${publicBaseUrl}/connect/${encodeURIComponent(state.provider)}/callback`,
        },
        bodyEncoding: 'form',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        },
        method: 'POST',
        provider: state.provider,
        url: state.tokenUrl,
      }),
      headers: {
        'content-type': 'application/json',
        'x-market-runner-token': config.MARKET_RUNNER_INTERNAL_TOKEN,
      },
      method: 'POST',
      signal: AbortSignal.timeout(35_000),
    });
    const tokenResult = (await tokenResponse.json()) as any;
    const tokenData =
      typeof tokenResult.data === 'string'
        ? Object.fromEntries(new URLSearchParams(tokenResult.data))
        : tokenResult.data;
    if (!tokenResponse.ok || !tokenResult.success || !tokenData?.access_token) {
      return c.json({ error: 'oauth_token_exchange_failed' }, 502);
    }
    const accountResult = await repository
      .getPool()
      .query(`SELECT * FROM market_accounts WHERE id=$1`, [state.accountId]);
    if (!accountResult.rowCount) return c.json({ error: 'oauth_account_not_found' }, 404);
    const row = accountResult.rows[0];
    const oauthAccount: Account = {
      email: row.email,
      externalUserId: row.external_user_id,
      id: Number(row.id),
      name: row.name,
      role: row.role,
    };
    const credential = await vault.create(
      {
        key: `oauth:${state.provider}`,
        metadata: { provider: state.provider },
        name: `${state.provider} OAuth`,
        type: 'oauth',
        value: tokenData,
      },
      oauthAccount,
      state.workspaceId,
    );
    await repository.getPool().query(
      `INSERT INTO market_connections(account_id,workspace_id,provider,credential_id,status,metadata)
       VALUES ($1,$2,$3,$4,'active',$5)
       ON CONFLICT(account_id,scope_key,provider) DO UPDATE SET credential_id=excluded.credential_id,
         status='active', metadata=excluded.metadata, updated_at=now()`,
      [
        state.accountId,
        state.workspaceId || null,
        state.provider,
        credential.id,
        JSON.stringify({ scopes: state.scopes || [] }),
      ],
    );
    await repository.audit(
      oauthAccount,
      state.workspaceId,
      'connection.authorized',
      'provider',
      state.provider,
      { scopes: state.scopes || [] },
    );
    const redirect = new URL(state.redirectUri || `${publicBaseUrl}/connect/success`);
    redirect.searchParams.set('market_oauth', 'success');
    redirect.searchParams.set('provider', state.provider);
    return c.redirect(redirect.toString());
  });
  app.get('/ready', async (c) => {
    try {
      await Promise.all([repository.ping(), redis.ping(), storage.ping()]);
      const migration = await repository
        .getPool()
        .query(`SELECT version FROM market_schema_migrations ORDER BY version DESC LIMIT 1`);
      if (!migration.rowCount) throw new Error('database migrations not applied');
      return c.json({ migration: migration.rows[0].version, status: 'ready' });
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : 'dependency unavailable',
          status: 'not-ready',
        },
        503,
      );
    }
  });

  app.get('/indexes/:type/:file', async (c) => {
    const type = c.req.param('type') === 'agents' ? 'agent' : 'plugin';
    const file = c.req.param('file');
    const result = await repository.getPool().query(
      `SELECT r.*, v.config, v.manifest, v.version FROM market_resources r
       JOIN market_versions v ON v.id=r.current_version_id
       WHERE r.type=$1 AND r.status='published' AND v.workflow_state='published' ORDER BY r.updated_at DESC`,
      [type],
    );
    const items = result.rows.map((row) => ({
      ...row.metadata,
      avatar: resolveMarketAvatar(row.avatar, publicBaseUrl),
      category: row.category,
      config: row.config,
      description: row.description,
      identifier: row.identifier,
      manifest: row.manifest,
      meta: {
        avatar: resolveMarketAvatar(row.avatar, publicBaseUrl),
        description: row.description,
        tags: row.tags,
        title: row.name,
      },
      name: row.name,
      tags: row.tags,
      version: row.version,
    }));
    if (file.startsWith('index.'))
      return c.json(type === 'agent' ? { agents: items } : { plugins: items });
    const identifier = file.replace(/\.[^.]+\.json$/, '').replace(/\.json$/, '');
    const item = items.find((candidate) => candidate.identifier === identifier);
    return item ? c.json(item) : c.json({ error: 'not_found' }, 404);
  });

  const syncAccount = async (c: Context<AppEnv>, next: () => Promise<void>) => {
    const account = await repository.syncAccount(c.get('actor'), adminIds);
    c.set('account', account);
    c.set('role', account.role);
    await next();
  };
  app.use('/api/*', auth, syncAccount);
  app.use('/lobehub-oidc/*', auth, syncAccount);

  app.get('/lobehub-oidc/userinfo', (c) => {
    const actor = c.get('actor');
    const account = c.get('account');
    return c.json({
      accountId: account.id,
      email: actor.email,
      name: actor.name,
      sub: actor.userId,
      userId: actor.userId,
      username: actor.email?.split('@')[0] || actor.userId,
      workspaceId: actor.workspaceId,
    });
  });

  const registerCatalog = (
    prefix: string,
    type: ResourceType,
    detailStyle: 'path' | 'query' = 'path',
  ) => {
    app.get(`/api/v1/${prefix}`, async (c) =>
      c.json(
        withPublicListAvatars(
          await repository.list(
            type,
            queryOptions(c),
            ...(Object.values(actorScope(c)) as [Account, string | undefined]),
          ),
        ),
      ),
    );
    app.get(`/api/v1/${prefix}/own`, async (c) =>
      c.json(
        withPublicListAvatars(
          await repository.list(
            type,
            queryOptions(c),
            ...(Object.values(actorScope(c)) as [Account, string | undefined]),
          ),
        ),
      ),
    );
    app.get(`/api/v1/${prefix}/categories`, async (c) => c.json(await repository.categories(type)));
    app.get(`/api/v1/${prefix}/identifiers`, async (c) => {
      const result = await repository.list(
        type,
        { pageSize: 100 },
        ...(Object.values(actorScope(c)) as [Account, string | undefined]),
      );
      return c.json(identifierList(result.items));
    });
    app.get(`/api/v1/${prefix}/sitemap`, async (c) => {
      const result = await repository.list(
        type,
        queryOptions(c),
        ...(Object.values(actorScope(c)) as [Account, string | undefined]),
      );
      return c.json({ ...result, items: identifierList(result.items) });
    });
    if (detailStyle === 'path') {
      app.get(`/api/v1/${prefix}/detail/:identifier`, async (c) => {
        const value = await repository.detail(
          type,
          c.req.param('identifier'),
          ...(Object.values(actorScope(c)) as [Account, string | undefined]),
          c.req.query('version'),
        );
        return value ? c.json(withPublicAvatar(value)) : c.json({ error: 'not_found' }, 404);
      });
    } else {
      app.get(`/api/v1/${prefix}/detail`, async (c) => {
        const value = await repository.detail(
          type,
          c.req.query('identifier') || '',
          ...(Object.values(actorScope(c)) as [Account, string | undefined]),
          c.req.query('version'),
        );
        return value ? c.json(withPublicAvatar(value)) : c.json({ error: 'not_found' }, 404);
      });
    }
  };

  registerCatalog('agents', 'agent');
  registerCatalog('agent-groups', 'agent-group', 'query');
  registerCatalog('skills', 'skill');
  registerCatalog('plugins', 'mcp');

  app.get('/api/v1/agents/onboarding-full', async (c) => {
    const result = await repository.list(
      'agent',
      {
        identifiers: ONBOARDING_AGENT_IDENTIFIERS,
        pageSize: ONBOARDING_AGENT_IDENTIFIERS.length,
        publishedOriginalsOnly: true,
      },
      ...(Object.values(actorScope(c)) as [Account, string | undefined]),
    );
    const itemByIdentifier = new Map(result.items.map((item) => [item.identifier, item]));
    const grouped: Record<string, unknown[]> = {};
    for (const entry of ONBOARDING_AGENT_CATALOG) {
      const item = itemByIdentifier.get(entry.identifier);
      if (!item) continue;
      (grouped[entry.category] ||= []).push(
        withPublicAvatar({ ...item, avatar: entry.avatar, category: entry.category }),
      );
    }
    return c.json(grouped);
  });
  app.get('/api/v1/agents/by-plugin', async (c) => {
    const pluginId = c.req.query('pluginId') || '';
    const result = await repository.list(
      'agent',
      { pageSize: 100 },
      ...(Object.values(actorScope(c)) as [Account, string | undefined]),
    );
    const items = result.items.filter((item: any) => {
      const plugins = item.config?.plugins || item.config?.pluginIds || [];
      return (
        Array.isArray(plugins) &&
        plugins.some((plugin: any) => plugin === pluginId || plugin?.identifier === pluginId)
      );
    });
    return c.json({
      currentPage: 1,
      items,
      pageSize: 100,
      totalCount: items.length,
      totalPages: items.length ? 1 : 0,
    });
  });

  const createResource = (type: ResourceType) => async (c: Context<AppEnv>) => {
    const input = ResourceInputSchema.parse(await c.req.json());
    return c.json(
      await repository.createResource(
        type,
        input,
        ...(Object.values(actorScope(c)) as [Account, string | undefined]),
      ),
      201,
    );
  };
  const createVersion = (type: ResourceType) => async (c: Context<AppEnv>) => {
    const input = ResourceInputSchema.parse(await c.req.json());
    return c.json(
      await repository.createVersion(
        type,
        input,
        ...(Object.values(actorScope(c)) as [Account, string | undefined]),
      ),
      201,
    );
  };
  const modifyResource = (type: ResourceType) => async (c: Context<AppEnv>) => {
    const input = await jsonBody(c);
    return c.json(
      await repository.updateResource(
        type,
        input,
        ...(Object.values(actorScope(c)) as [Account, string | undefined]),
      ),
    );
  };

  app.post('/api/v1/agents/create', createResource('agent'));
  app.post('/api/v1/agents/version/create', createVersion('agent'));
  app.post('/api/v1/agents/modify', modifyResource('agent'));
  app.post('/api/v1/agents/version/modify', createVersion('agent'));
  app.post('/api/v1/agent-groups/create', createResource('agent-group'));
  app.post('/api/v1/agent-groups/version-create', createVersion('agent-group'));
  app.post('/api/v1/agent-groups/modify', modifyResource('agent-group'));
  app.get('/api/v1/agent-groups/list', async (c) =>
    c.json(
      await repository.list(
        'agent-group',
        queryOptions(c),
        ...(Object.values(actorScope(c)) as [Account, string | undefined]),
      ),
    ),
  );
  for (const [action, status] of [
    ['publish', 'published'],
    ['unpublish', 'unpublished'],
    ['deprecate', 'deprecated'],
  ] as const) {
    app.post(`/api/v1/agent-groups/:identifier/${action}`, async (c) =>
      c.json(
        await repository.requestStatus(
          'agent-group',
          c.req.param('identifier'),
          status,
          ...(Object.values(actorScope(c)) as [Account, string | undefined]),
        ),
      ),
    );
  }

  app.post('/api/v1/agents/:identifier/fork', async (c) =>
    c.json(
      await repository.fork(
        'agent',
        c.req.param('identifier'),
        await jsonBody(c),
        ...(Object.values(actorScope(c)) as [Account, string | undefined]),
      ),
      201,
    ),
  );
  app.get('/api/v1/agents/:identifier/forks', async (c) =>
    c.json(await repository.forks('agent', c.req.param('identifier'))),
  );
  app.get('/api/v1/agents/:identifier/fork-source', async (c) =>
    c.json(await repository.forkSource('agent', c.req.param('identifier'))),
  );
  app.post('/api/v1/agent-groups/:identifier/fork', async (c) =>
    c.json(
      await repository.fork(
        'agent-group',
        c.req.param('identifier'),
        await jsonBody(c),
        ...(Object.values(actorScope(c)) as [Account, string | undefined]),
      ),
      201,
    ),
  );
  app.get('/api/v1/agent-groups/:identifier/forks', async (c) =>
    c.json(await repository.forks('agent-group', c.req.param('identifier'))),
  );
  app.get('/api/v1/agent-groups/:identifier/fork-source', async (c) =>
    c.json(await repository.forkSource('agent-group', c.req.param('identifier'))),
  );

  app.post('/api/v1/agents/install-count', async (c) => {
    const input = await jsonBody(c);
    return c.json(
      await repository.install(
        input.identifier,
        ...(Object.values(actorScope(c)) as [Account, string | undefined]),
      ),
    );
  });
  app.post('/api/v1/agents/events', async (c) => {
    const input = await jsonBody(c);
    await repository.audit(
      c.get('account'),
      c.get('actor').workspaceId,
      `agent.${input.event}`,
      'agent',
      input.identifier,
      input,
    );
    return c.body(null, 204);
  });
  for (const endpoint of [
    'plugins/events',
    'plugins/report/installation',
    'plugins/report/call',
    'skills/report/installation',
    'skills/report/github',
  ]) {
    app.post(`/api/v1/${endpoint}`, async (c) => {
      const input = await jsonBody(c);
      await repository.audit(
        c.get('account'),
        c.get('actor').workspaceId,
        endpoint.replaceAll('/', '.'),
        undefined,
        input.identifier,
        input,
      );
      return c.json({ success: true });
    });
  }
  app.post('/api/v1/user/feedback', async (c) => {
    const input = await jsonBody(c);
    const result = await repository
      .getPool()
      .query(
        `INSERT INTO market_events(account_id,workspace_id,event_type,payload) VALUES ($1,$2,'feedback.submitted',$3) RETURNING id`,
        [c.get('account').id, c.get('actor').workspaceId || null, JSON.stringify(input)],
      );
    await repository.audit(
      c.get('account'),
      c.get('actor').workspaceId,
      'feedback.submit',
      'feedback',
      String(result.rows[0].id),
      { title: input.title },
    );
    return c.json(
      {
        issueId: String(result.rows[0].id),
        issueUrl: `market://feedback/${result.rows[0].id}`,
        success: true,
      },
      201,
    );
  });
  app.post('/api/v1/task-templates/recommendations', async (c) => {
    await repository.audit(
      c.get('account'),
      c.get('actor').workspaceId,
      'task-template.recommend',
      'task-template',
      undefined,
      await jsonBody(c),
    );
    return c.json({ items: [] });
  });

  app.get('/api/v1/plugins/:identifier/manifest', async (c) => {
    const detail = await repository.detail(
      'mcp',
      c.req.param('identifier'),
      ...(Object.values(actorScope(c)) as [Account, string | undefined]),
      c.req.query('version'),
    );
    return detail ? c.json(detail.manifest || {}) : c.json({ error: 'not_found' }, 404);
  });
  app.get('/api/v1/plugins/:identifier', async (c) => {
    const detail = await repository.detail(
      'mcp',
      c.req.param('identifier'),
      ...(Object.values(actorScope(c)) as [Account, string | undefined]),
      c.req.query('version'),
    );
    return detail ? c.json(detail) : c.json({ error: 'not_found' }, 404);
  });
  app.get('/api/v1/skills/:identifier', async (c) => {
    const detail = await repository.detail(
      'skill',
      c.req.param('identifier'),
      ...(Object.values(actorScope(c)) as [Account, string | undefined]),
      c.req.query('version'),
    );
    return detail ? c.json(detail) : c.json({ error: 'not_found' }, 404);
  });
  app.get('/api/v1/skills/:identifier/versions', async (c) => {
    const result = await repository.getPool().query(
      `SELECT v.version, v.workflow_state AS "workflowState", v.created_at AS "createdAt", v.changelog
       FROM market_versions v JOIN market_resources r ON r.id=v.resource_id
       WHERE r.type='skill' AND r.identifier=$1 AND (v.workflow_state='published' OR r.owner_account_id=$2) ORDER BY v.created_at DESC`,
      [c.req.param('identifier'), c.get('account').id],
    );
    return c.json({ items: result.rows, totalCount: result.rowCount || 0 });
  });
  app.get('/api/v1/skills/:identifier/versions/:version', async (c) => {
    const detail = await repository.detail(
      'skill',
      c.req.param('identifier'),
      ...(Object.values(actorScope(c)) as [Account, string | undefined]),
      c.req.param('version'),
    );
    return detail ? c.json(detail) : c.json({ error: 'not_found' }, 404);
  });
  app.get('/api/v1/skills/:identifier/download', async (c) => {
    const result = await repository.getPool().query(
      `SELECT v.artifact_key FROM market_versions v JOIN market_resources r ON r.id=v.resource_id
       WHERE r.type='skill' AND r.identifier=$1 AND v.workflow_state='published'
         AND ($2::text IS NULL OR v.version=$2) ORDER BY v.created_at DESC LIMIT 1`,
      [c.req.param('identifier'), c.req.query('version') || null],
    );
    if (!result.rowCount || !result.rows[0].artifact_key)
      return c.json({ error: 'artifact_not_found' }, 404);
    return c.redirect(await storage.signedDownloadUrl(result.rows[0].artifact_key));
  });

  for (const type of ['model', 'provider', 'plugin'] as const) {
    const prefix = `${type}s`;
    app.get(`/api/v1/${prefix}`, async (c) =>
      c.json(
        await repository.list(
          type,
          queryOptions(c),
          ...(Object.values(actorScope(c)) as [Account, string | undefined]),
        ),
      ),
    );
    app.get(`/api/v1/${prefix}/categories`, async (c) => c.json(await repository.categories(type)));
    app.get(`/api/v1/${prefix}/identifiers`, async (c) => {
      const result = await repository.list(
        type,
        { pageSize: 100 },
        ...(Object.values(actorScope(c)) as [Account, string | undefined]),
      );
      return c.json(identifierList(result.items));
    });
    app.get(`/api/v1/${prefix}/:identifier`, async (c) => {
      const detail = await repository.detail(
        type,
        c.req.param('identifier'),
        ...(Object.values(actorScope(c)) as [Account, string | undefined]),
      );
      return detail ? c.json(detail) : c.json({ error: 'not_found' }, 404);
    });
  }

  app.get('/api/v1/user/creds', async (c) =>
    c.json({
      data: await vault.list(...(Object.values(actorScope(c)) as [Account, string | undefined])),
    }),
  );
  for (const [path, type] of [
    ['skills', 'skill'],
    ['plugins', 'mcp'],
  ] as const) {
    app.get(`/api/v1/user/${path}`, async (c) => {
      const result = await repository.list(
        type,
        { pageSize: 100 },
        ...(Object.values(actorScope(c)) as [Account, string | undefined]),
      );
      return c.json({ data: result.items, totalCount: result.totalCount });
    });
    app.patch(`/api/v1/user/${path}/:identifier/status`, async (c) => {
      const input = await jsonBody(c);
      return c.json(
        await repository.requestStatus(
          type,
          c.req.param('identifier'),
          input.status,
          ...(Object.values(actorScope(c)) as [Account, string | undefined]),
        ),
      );
    });
    app.delete(`/api/v1/user/${path}/:identifier`, async (c) =>
      c.json(
        await repository.requestStatus(
          type,
          c.req.param('identifier'),
          'archived',
          ...(Object.values(actorScope(c)) as [Account, string | undefined]),
        ),
      ),
    );
  }
  app.post('/api/v1/user/plugins/:identifier/versions', async (c) => {
    const input = await jsonBody(c);
    const existing = await repository
      .getPool()
      .query(
        `SELECT 1 FROM market_resources WHERE type='mcp' AND identifier=$1 AND owner_account_id=$2`,
        [c.req.param('identifier'), c.get('account').id],
      );
    if (!existing.rowCount)
      await repository.createResource(
        'mcp',
        {
          ...input,
          identifier: c.req.param('identifier'),
          name: input.name || c.req.param('identifier'),
        },
        ...(Object.values(actorScope(c)) as [Account, string | undefined]),
      );
    return c.json(
      await repository.createVersion(
        'mcp',
        { ...input, identifier: c.req.param('identifier') },
        ...(Object.values(actorScope(c)) as [Account, string | undefined]),
      ),
      201,
    );
  });
  app.post('/api/v1/user/skills/:identifier/versions', async (c) => {
    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return c.json({ error: 'skill_zip_required' }, 400);
    if (file.size > 16 * 1024 * 1024) return c.json({ error: 'skill_zip_too_large' }, 413);
    const manifest = JSON.parse(String(form.get('manifest') || '{}')) as Record<string, unknown>;
    const metadata = JSON.parse(String(form.get('metadata') || '{}')) as Record<string, unknown>;
    const manifestErrors = validateArtifactManifest(manifest);
    if (!Array.isArray(manifest.files) || manifestErrors.length)
      return c.json({ error: 'unsafe_or_missing_manifest', details: manifestErrors }, 400);
    const content = Buffer.from(await file.arrayBuffer());
    const archiveErrors = validateZipArchive(content);
    if (archiveErrors.length)
      return c.json({ error: 'unsafe_archive', details: archiveErrors }, 400);
    const artifactHash = sha256(content);
    const identifier = c.req.param('identifier');
    const version = String(form.get('version') || '1.0.0');
    const artifactKey = `skill/${identifier}/${version}/${artifactHash}.zip`;
    await storage.put(artifactKey, content, artifactHash);
    const existing = await repository
      .getPool()
      .query(
        `SELECT 1 FROM market_resources WHERE type='skill' AND identifier=$1 AND owner_account_id=$2`,
        [identifier, c.get('account').id],
      );
    if (!existing.rowCount) {
      await repository.createResource(
        'skill',
        {
          description: String(form.get('description') || ''),
          identifier,
          manifest,
          metadata,
          name: String(form.get('name') || identifier),
        },
        ...(Object.values(actorScope(c)) as [Account, string | undefined]),
      );
    } else {
      await repository.getPool().query(
        `UPDATE market_resources SET metadata=$1, name=$2, description=$3, updated_at=now()
         WHERE type='skill' AND identifier=$4 AND owner_account_id=$5`,
        [
          JSON.stringify(metadata),
          String(form.get('name') || identifier),
          String(form.get('description') || ''),
          identifier,
          c.get('account').id,
        ],
      );
    }
    const created = await repository.createVersion(
      'skill',
      { identifier, manifest, version },
      ...(Object.values(actorScope(c)) as [Account, string | undefined]),
    );
    await repository
      .getPool()
      .query(`UPDATE market_versions SET artifact_key=$1, artifact_sha256=$2 WHERE id=$3`, [
        artifactKey,
        artifactHash,
        created.id,
      ]);
    return c.json(created, 201);
  });
  app.get('/api/v1/user/claims/scan/:assetType', (c) => c.json({ data: [] }));
  app.get('/api/v1/user/claims/scan', (c) => c.json({ data: [] }));
  app.post('/api/v1/user/claims', async (c) => {
    await repository.audit(
      c.get('account'),
      c.get('actor').workspaceId,
      'claim.create',
      'resource',
      undefined,
      await jsonBody(c),
    );
    return c.json({ success: true });
  });
  app.post('/api/v1/user/claims/submit-repo', async (c) => {
    await repository.audit(
      c.get('account'),
      c.get('actor').workspaceId,
      'claim.submit-repo',
      'repository',
      undefined,
      await jsonBody(c),
    );
    return c.json({ success: true });
  });
  app.get('/api/v1/user/creds/:id', async (c) => {
    const value = await vault.get(
      c.req.param('id'),
      ...(Object.values(actorScope(c)) as [Account, string | undefined]),
      c.req.query('decrypt') === 'true',
    );
    return value ? c.json(value) : c.json({ error: 'not_found' }, 404);
  });
  for (const type of ['kv', 'oauth', 'file'])
    app.post(`/api/v1/user/creds/${type}`, async (c) => {
      const raw = await jsonBody(c);
      const input = CredentialInputSchema.parse({
        ...raw,
        type: raw.type || (type === 'kv' ? 'kv-env' : type),
        value: raw.value ?? raw.values ?? raw.payload ?? raw.data ?? raw,
      });
      return c.json(
        await vault.create(
          input,
          ...(Object.values(actorScope(c)) as [Account, string | undefined]),
        ),
        201,
      );
    });
  app.patch('/api/v1/user/creds/:id', async (c) => {
    const current = (await vault.get(
      c.req.param('id'),
      ...(Object.values(actorScope(c)) as [Account, string | undefined]),
      true,
    )) as any;
    if (!current) return c.json({ error: 'not_found' }, 404);
    const input = await jsonBody(c);
    return c.json(
      await vault.create(
        {
          ...current,
          ...input,
          value: input.values ?? input.value ?? current.plaintext,
        },
        ...(Object.values(actorScope(c)) as [Account, string | undefined]),
      ),
    );
  });
  app.delete('/api/v1/user/creds/:id', async (c) =>
    c.json(
      await vault.delete(
        c.req.param('id'),
        ...(Object.values(actorScope(c)) as [Account, string | undefined]),
      ),
    ),
  );
  app.delete('/api/v1/user/creds/key/:key', async (c) =>
    c.json(
      await vault.deleteByKey(
        c.req.param('key'),
        ...(Object.values(actorScope(c)) as [Account, string | undefined]),
      ),
    ),
  );
  app.post('/api/v1/plugins/run-buildin-tools/inject-creds', async (c) => {
    const input = await jsonBody(c);
    return c.json(
      await vault.inject(
        input.keys || [],
        ...(Object.values(actorScope(c)) as [Account, string | undefined]),
      ),
    );
  });
  app.post('/api/v1/plugins/run-buildin-tools/inject-creds-for-skill', async (c) => {
    const input = await jsonBody(c);
    const detail = await repository.detail(
      'skill',
      input.skillIdentifier,
      ...(Object.values(actorScope(c)) as [Account, string | undefined]),
    );
    const keys = Array.isArray(detail?.manifest?.credentials)
      ? detail.manifest.credentials.map((item: any) => item.key)
      : [];
    return c.json(
      await vault.inject(keys, ...(Object.values(actorScope(c)) as [Account, string | undefined])),
    );
  });
  app.post('/api/v1/plugins/run-buildin-tools', (c) =>
    c.json(
      {
        error: {
          code: 'BUILTIN_SANDBOX_UNAVAILABLE',
          message: 'Built-in sandbox tools are not provided by the internal Market service.',
        },
        success: false,
      },
      501,
    ),
  );
  app.get('/api/v1/skills/:identifier/creds/status', async (c) => {
    const detail = await repository.detail(
      'skill',
      c.req.param('identifier'),
      ...(Object.values(actorScope(c)) as [Account, string | undefined]),
    );
    const required = Array.isArray(detail?.manifest?.credentials)
      ? detail.manifest.credentials
      : [];
    const resolved = await vault.resolve(
      required.map((item: any) => item.key),
      ...(Object.values(actorScope(c)) as [Account, string | undefined]),
    );
    return c.json(
      required.map((item: any) => ({
        ...item,
        satisfied: !resolved.missingKeys.includes(item.key),
      })),
    );
  });

  app.get('/api/connect/connections', async (c) => {
    const result = await repository.getPool().query(
      `SELECT provider AS "providerId", status, metadata, updated_at AS "updatedAt" FROM market_connections
       WHERE account_id=$1 AND workspace_id IS NOT DISTINCT FROM $2`,
      [c.get('account').id, c.get('actor').workspaceId || null],
    );
    return c.json({ connections: result.rows, success: true });
  });
  app.get('/api/connect/providers', async (c) => {
    const result = await repository.list(
      'provider',
      { pageSize: 100 },
      ...(Object.values(actorScope(c)) as [Account, string | undefined]),
    );
    return c.json({ providers: result.items, success: true });
  });
  app.get('/api/connect/providers/:provider', async (c) =>
    c.json({ provider: { id: c.req.param('provider'), status: 'available' }, success: true }),
  );
  app.post('/api/connect/:provider/authorize', async (c) => {
    const input = await jsonBody(c);
    const provider = c.req.param('provider');
    if (input.credentialId) {
      const result = await repository.getPool().query(
        `INSERT INTO market_connections(account_id, workspace_id, provider, credential_id, status, metadata)
         VALUES ($1,$2,$3,$4,'active',$5)
         ON CONFLICT(account_id,scope_key,provider) DO UPDATE SET credential_id=excluded.credential_id,
           status='active', metadata=excluded.metadata, updated_at=now()
         RETURNING id, provider AS "providerId", status, metadata`,
        [
          c.get('account').id,
          c.get('actor').workspaceId || null,
          provider,
          input.credentialId,
          JSON.stringify(input.metadata || {}),
        ],
      );
      return c.json({ connection: result.rows[0], connected: true, success: true });
    }
    const detail = await repository.detail(
      'provider',
      provider,
      ...(Object.values(actorScope(c)) as [Account, string | undefined]),
    );
    const oauth = detail?.manifest?.oauth || detail?.config?.oauth;
    const client = oauthClients[provider];
    if (
      !oauth?.authorizationUrl ||
      !oauth?.tokenUrl ||
      !client?.clientId ||
      !client?.clientSecret
    ) {
      return c.json({ error: 'oauth_provider_not_configured' }, 400);
    }
    for (const targetValue of [oauth.authorizationUrl, oauth.tokenUrl]) {
      const target = new URL(targetValue);
      const port = target.port ? Number(target.port) : target.protocol === 'https:' ? 443 : 80;
      const allowed = await repository.getPool().query(
        `SELECT 1 FROM market_connector_allowlist WHERE provider=$1 AND protocol=$2 AND lower(hostname)=lower($3)
          AND (port IS NULL OR port=$4) AND enabled=true`,
        [provider, target.protocol, target.hostname, port],
      );
      if (!allowed.rowCount)
        return c.json({ error: 'oauth_target_not_allowlisted', hostname: target.hostname }, 403);
    }
    let redirectUri: string | undefined;
    if (input.redirect_uri) {
      const requestedRedirect = new URL(input.redirect_uri);
      if (!oauthRedirectOrigins.has(requestedRedirect.origin))
        return c.json({ error: 'oauth_redirect_not_allowed' }, 400);
      redirectUri = requestedRedirect.toString();
    }
    const code = randomUUID();
    const approvedScopes = Array.isArray(oauth.scopes) ? oauth.scopes : [];
    const scopes =
      Array.isArray(input.scopes) && input.scopes.length ? input.scopes : approvedScopes;
    if (scopes.some((scope: string) => !approvedScopes.includes(scope)))
      return c.json({ error: 'oauth_scope_not_approved' }, 403);
    await redis.set(
      `oauth:code:${code}`,
      JSON.stringify({
        accountId: c.get('account').id,
        authorizationUrl: oauth.authorizationUrl,
        clientId: client.clientId,
        provider,
        redirectUri,
        scopes,
        tokenUrl: oauth.tokenUrl,
        workspaceId: c.get('actor').workspaceId,
      }),
      'EX',
      300,
    );
    return c.json({
      authorize_url: `${publicBaseUrl}/connect/${encodeURIComponent(provider)}/start?code=${encodeURIComponent(code)}`,
      code,
      expires_in: 300,
      success: true,
    });
  });
  app.get('/api/connect/:provider/status', async (c) => {
    const result = await repository
      .getPool()
      .query(
        `SELECT id, status, metadata FROM market_connections WHERE account_id=$1 AND workspace_id IS NOT DISTINCT FROM $2 AND provider=$3 ORDER BY updated_at DESC LIMIT 1`,
        [c.get('account').id, c.get('actor').workspaceId || null, c.req.param('provider')],
      );
    return c.json({
      connected: Boolean(result.rowCount && result.rows[0].status === 'active'),
      connection: result.rows[0] || null,
      success: true,
    });
  });
  app.get('/api/connect/:provider/health', async (c) => {
    const result = await repository
      .getPool()
      .query(
        `SELECT 1 FROM market_connections WHERE account_id=$1 AND workspace_id IS NOT DISTINCT FROM $2 AND provider=$3 AND status='active' LIMIT 1`,
        [c.get('account').id, c.get('actor').workspaceId || null, c.req.param('provider')],
      );
    const healthy = Boolean(result.rowCount);
    return c.json({
      healthy,
      provider: c.req.param('provider'),
      success: true,
      tokenStatus: healthy ? 'valid' : 'unknown',
    });
  });
  app.get('/api/connect/health', async (c) => {
    const result = await repository
      .getPool()
      .query(
        `SELECT count(*)::int AS total FROM market_connections WHERE account_id=$1 AND workspace_id IS NOT DISTINCT FROM $2 AND status='active'`,
        [c.get('account').id, c.get('actor').workspaceId || null],
      );
    return c.json({
      connections: [],
      success: true,
      summary: {
        expired: 0,
        expiringSoon: 0,
        healthy: result.rows[0].total,
        total: result.rows[0].total,
        unhealthy: 0,
      },
    });
  });
  app.post('/api/connect/:provider/refresh', async (c) => {
    const result = await repository
      .getPool()
      .query(
        `UPDATE market_connections SET updated_at=now() WHERE account_id=$1 AND workspace_id IS NOT DISTINCT FROM $2 AND provider=$3 RETURNING id`,
        [c.get('account').id, c.get('actor').workspaceId || null, c.req.param('provider')],
      );
    return c.json({
      connection: null,
      refreshed: Boolean(result.rowCount),
      success: Boolean(result.rowCount),
    });
  });
  app.delete('/api/connect/:provider', async (c) => {
    await repository
      .getPool()
      .query(
        `UPDATE market_connections SET status='revoked', updated_at=now() WHERE account_id=$1 AND workspace_id IS NOT DISTINCT FROM $2 AND provider=$3`,
        [c.get('account').id, c.get('actor').workspaceId || null, c.req.param('provider')],
      );
    return c.json({ success: true });
  });
  app.post('/api/v1/skill/:provider/call', async (c) => {
    const body = await jsonBody(c);
    const provider = c.req.param('provider');
    const detail = await repository.detail(
      'provider',
      provider,
      ...(Object.values(actorScope(c)) as [Account, string | undefined]),
    );
    const tools = Array.isArray(detail?.manifest?.tools) ? detail.manifest.tools : [];
    const tool = tools.find((item: any) => item.name === body.tool);
    const targetUrl =
      tool?.url ||
      (detail?.manifest?.baseUrl && tool?.path
        ? new URL(tool.path, detail.manifest.baseUrl).toString()
        : undefined);
    if (!targetUrl) return c.json({ error: 'approved_connector_target_missing' }, 400);
    const credentialKeys = Array.isArray(tool.credentialKeys) ? tool.credentialKeys : [];
    const injected = await vault.resolve(
      credentialKeys,
      ...(Object.values(actorScope(c)) as [Account, string | undefined]),
    );
    if (injected.missingKeys.length)
      return c.json({ error: 'credentials_required', missingKeys: injected.missingKeys }, 400);
    const credentialHeaders = Object.fromEntries(
      Object.entries(injected.credentials).flatMap(([key, value]) =>
        value && typeof value === 'object'
          ? Object.entries(value as Record<string, string>)
          : [[key, String(value)]],
      ),
    );
    await repository.audit(
      c.get('account'),
      c.get('actor').workspaceId,
      'connector.call',
      'provider',
      provider,
      {
        hostname: new URL(targetUrl).hostname,
        tool: body.tool,
      },
    );
    const response = await fetch(`${config.MARKET_RUNNER_INTERNAL_URL}/internal/run`, {
      body: JSON.stringify({
        body: body.args || {},
        headers: credentialHeaders,
        method: tool.method || 'POST',
        provider,
        url: targetUrl,
      }),
      headers: {
        'content-type': 'application/json',
        'x-market-runner-token': config.MARKET_RUNNER_INTERNAL_TOKEN,
      },
      method: 'POST',
      signal: AbortSignal.timeout(35_000),
    });
    return c.json(await response.json(), response.ok ? 200 : 502);
  });
  app.post('/api/v1/plugins/cloud-gateway', async (c) => {
    const input = await jsonBody(c);
    const detail = await repository.detail(
      'mcp',
      input.identifier,
      ...(Object.values(actorScope(c)) as [Account, string | undefined]),
    );
    const tools = Array.isArray(detail?.manifest?.tools) ? detail.manifest.tools : [];
    const tool = tools.find((item: any) => item.name === input.toolName);
    const targetUrl =
      tool?.url ||
      (detail?.manifest?.baseUrl && tool?.path
        ? new URL(tool.path, detail.manifest.baseUrl).toString()
        : undefined);
    if (!targetUrl) return c.json({ error: 'approved_connector_target_missing' }, 400);
    const credentialKeys = Array.isArray(tool.credentialKeys) ? tool.credentialKeys : [];
    const injected = await vault.resolve(
      credentialKeys,
      ...(Object.values(actorScope(c)) as [Account, string | undefined]),
    );
    if (injected.missingKeys.length)
      return c.json({ error: 'credentials_required', missingKeys: injected.missingKeys }, 400);
    const credentialHeaders = Object.fromEntries(
      Object.entries(injected.credentials).flatMap(([key, value]) =>
        value && typeof value === 'object'
          ? Object.entries(value as Record<string, string>)
          : [[key, String(value)]],
      ),
    );
    await repository.audit(
      c.get('account'),
      c.get('actor').workspaceId,
      'connector.call',
      'mcp',
      input.identifier,
      {
        hostname: new URL(targetUrl).hostname,
        tool: input.toolName,
      },
    );
    const response = await fetch(`${config.MARKET_RUNNER_INTERNAL_URL}/internal/run`, {
      body: JSON.stringify({
        body: input.apiParams || {},
        headers: credentialHeaders,
        method: tool.method || 'POST',
        provider: input.identifier,
        url: targetUrl,
      }),
      headers: {
        'content-type': 'application/json',
        'x-market-runner-token': config.MARKET_RUNNER_INTERNAL_TOKEN,
      },
      method: 'POST',
      signal: AbortSignal.timeout(35_000),
    });
    return c.json(await response.json(), response.ok ? 200 : 502);
  });
  app.get('/api/v1/skill/providers', async (c) => {
    const result = await repository.list(
      'provider',
      { pageSize: 100 },
      ...(Object.values(actorScope(c)) as [Account, string | undefined]),
    );
    return c.json({ providers: result.items });
  });
  app.get('/api/v1/skill/:provider/tools', async (c) => {
    const detail = await repository.detail(
      'provider',
      c.req.param('provider'),
      ...(Object.values(actorScope(c)) as [Account, string | undefined]),
    );
    return c.json({
      instruction: detail?.manifest?.instruction,
      tools: detail?.manifest?.tools || [],
    });
  });

  const socialTarget = async (c: Context<AppEnv>) => {
    const input = c.req.method === 'GET' ? c.req.query() : await jsonBody(c);
    return {
      targetType: input.targetType || (c.req.path.includes('follows') ? 'user' : 'agent'),
      targetValue:
        input.targetValue || input.followingId || input.targetUserId || input.identifier || '',
    };
  };
  for (const [path, relation] of [
    ['follows', 'follow'],
    ['favorites', 'favorite'],
    ['likes', 'like'],
  ] as const) {
    app.post(`/api/v1/user/${path}`, async (c) => {
      const target = await socialTarget(c);
      return c.json(
        await repository.social(
          relation,
          'add',
          target.targetType,
          target.targetValue,
          c.get('account'),
        ),
      );
    });
    app.delete(`/api/v1/user/${path}`, async (c) => {
      const target = await socialTarget(c);
      return c.json(
        await repository.social(
          relation,
          'remove',
          target.targetType,
          target.targetValue,
          c.get('account'),
        ),
      );
    });
    app.post(`/api/v1/user/${path}/toggle`, async (c) => {
      const target = await socialTarget(c);
      return c.json(
        await repository.social(
          relation,
          'toggle',
          target.targetType,
          target.targetValue,
          c.get('account'),
        ),
      );
    });
    app.get(`/api/v1/user/${path}/check`, async (c) => {
      const target = await socialTarget(c);
      return c.json(
        await repository.social(
          relation,
          'check',
          target.targetType,
          target.targetValue,
          c.get('account'),
        ),
      );
    });
    app.get(`/api/v1/user/${path}/me`, async (c) =>
      c.json(await repository.listSocial(relation, c.get('account').id)),
    );
    if (relation === 'follow') {
      app.get('/api/v1/user/follows/:userId/following', async (c) =>
        c.json(
          await repository.listFollowing(Number(c.req.param('userId')) || c.get('account').id),
        ),
      );
      app.get('/api/v1/user/follows/:userId/followers', async (c) =>
        c.json(
          await repository.listFollowers(Number(c.req.param('userId')) || c.get('account').id),
        ),
      );
    }
    app.get(`/api/v1/user/${path}/:userId`, async (c) =>
      c.json(
        await repository.listSocial(relation, Number(c.req.param('userId')) || c.get('account').id),
      ),
    );
    app.get(`/api/v1/user/${path}/:userId/agents`, async (c) =>
      c.json(
        await repository.listSocial(
          relation,
          Number(c.req.param('userId')) || c.get('account').id,
          'agent',
        ),
      ),
    );
    app.get(`/api/v1/user/${path}/:userId/plugins`, async (c) =>
      c.json(
        await repository.listSocial(
          relation,
          Number(c.req.param('userId')) || c.get('account').id,
          'plugin',
        ),
      ),
    );
  }

  app.get('/api/v1/user/info/:id', async (c) => {
    const result = await repository.getPool().query(
      `SELECT a.*,
        (SELECT count(*)::int FROM market_social s WHERE s.relation='follow' AND s.target_type='user' AND s.target_value=a.id::text) AS follower_count,
        (SELECT count(*)::int FROM market_social s WHERE s.relation='follow' AND s.account_id=a.id) AS following_count
       FROM market_accounts a WHERE a.external_user_id=$1 OR a.id::text=$1 OR lower(a.username)=lower($1)`,
      [c.req.param('id')],
    );
    if (!result.rowCount) return c.json({ error: 'not_found' }, 404);
    const account = result.rows[0];
    const resources = await repository.getPool().query(
      `SELECT id, type, identifier, name, description, avatar, category, tags, install_count AS "installCount",
        metadata, created_at AS "createdAt", updated_at AS "updatedAt", forked_from_id
       FROM market_resources WHERE owner_account_id=$1 AND status='published' ORDER BY updated_at DESC`,
      [account.id],
    );
    const owned = (type: string) =>
      resources.rows
        .filter((item) => item.type === type)
        .map((item) => ({
          ...item,
          id: String(item.id),
          isClaimed: true,
          isFeatured: Boolean(item.metadata?.isFeatured),
          isOfficial: Boolean(item.metadata?.isOfficial),
          isValidated: true,
        }));
    return c.json({
      agentGroups: owned('agent-group').filter((item) => !item.forked_from_id),
      agents: owned('agent').filter((item) => !item.forked_from_id),
      favoriteAgentGroups: [],
      favoriteAgents: [],
      forkedAgentGroups: owned('agent-group').filter((item) => item.forked_from_id),
      forkedAgents: owned('agent').filter((item) => item.forked_from_id),
      plugins: owned('mcp'),
      skills: owned('skill'),
      user: {
        avatarUrl: account.avatar_url,
        createdAt: account.created_at,
        displayName: account.name,
        followerCount: account.follower_count,
        followingCount: account.following_count,
        id: Number(account.id),
        meta: account.metadata,
        namespace: account.username || account.external_user_id,
        type: 'user',
        userName: account.username || account.external_user_id,
      },
    });
  });
  app.post('/api/v1/user/update', async (c) => {
    const input = await jsonBody(c);
    const result = await repository.getPool().query(
      `UPDATE market_accounts SET name=coalesce($1,name), username=coalesce($2,username), avatar_url=coalesce($3,avatar_url),
        metadata=coalesce($4,metadata), updated_at=now() WHERE id=$5 RETURNING *`,
      [
        input.displayName || input.name || null,
        input.userName || input.username || null,
        input.avatarUrl || null,
        input.meta ? JSON.stringify(input.meta) : null,
        c.get('account').id,
      ],
    );
    const account = result.rows[0];
    return c.json({
      success: true,
      user: {
        avatarUrl: account.avatar_url,
        createdAt: account.created_at,
        displayName: account.name,
        followerCount: 0,
        followingCount: 0,
        id: Number(account.id),
        meta: account.metadata,
        namespace: account.username || account.external_user_id,
        type: 'user',
        userName: account.username || account.external_user_id,
      },
    });
  });
  app.post('/api/v1/user/register', async (c) => {
    const input = await jsonBody(c);
    if (input.registerUserId !== c.get('actor').userId)
      return c.json({ error: 'identity_mismatch' }, 403);
    return c.json({
      created: false,
      success: true,
      user: { clerkId: c.get('actor').userId, id: c.get('account').id },
    });
  });

  app.post('/api/internal/import', requireRole('admin'), async (c) => {
    const input = OfflineImportSchema.parse(await c.req.json());
    if (!verifyImportSignature(input.payload, input.signature, config.MARKET_IMPORT_SIGNING_KEY))
      return c.json({ error: 'invalid_import_signature' }, 400);
    const imported: Array<{ identifier: string; type: ResourceType }> = [];
    for (const entry of input.payload.resources) {
      const manifestErrors = validateArtifactManifest(entry.resource.manifest || {});
      if (manifestErrors.length)
        return c.json({ error: 'unsafe_artifact', details: manifestErrors }, 400);
      let artifactKey: string | undefined;
      let artifactHash: string | undefined;
      if (entry.artifact?.contentBase64) {
        const content = Buffer.from(entry.artifact.contentBase64, 'base64');
        const archiveErrors = validateZipArchive(content);
        if (archiveErrors.length)
          return c.json({ error: 'unsafe_archive', details: archiveErrors }, 400);
        artifactHash = sha256(content);
        if (entry.artifact.sha256 && artifactHash !== entry.artifact.sha256.toLowerCase())
          return c.json({ error: 'artifact_hash_mismatch' }, 400);
        artifactKey = `${entry.type}/${entry.resource.identifier}/${entry.resource.version || '1.0.0'}/${artifactHash}.zip`;
        await storage.put(artifactKey, content, artifactHash);
      }
      await repository.createResource(
        entry.type,
        entry.resource,
        c.get('account'),
        c.get('actor').workspaceId,
      );
      await repository.createVersion(
        entry.type,
        entry.resource,
        c.get('account'),
        c.get('actor').workspaceId,
      );
      if (artifactKey)
        await repository.getPool().query(
          `UPDATE market_versions v SET artifact_key=$1, artifact_sha256=$2, artifact_signature=$3
         FROM market_resources r WHERE v.id=r.current_version_id AND r.type=$4 AND r.identifier=$5`,
          [artifactKey, artifactHash, input.signature, entry.type, entry.resource.identifier],
        );
      await repository.review(
        entry.type,
        entry.resource.identifier,
        'submit',
        undefined,
        c.get('account'),
      );
      imported.push({ identifier: entry.resource.identifier, type: entry.type });
    }
    return c.json({ imported, success: true }, 201);
  });

  app.get('/api/internal/reviews', requireRole('reviewer', 'admin'), async (c) => {
    const result = await repository.getPool().query(
      `SELECT r.type, r.identifier, r.name, r.metadata, v.version,
        v.workflow_state AS "workflowState", v.scan_result AS "scanResult",
        jsonb_build_object('config', v.config, 'manifest', v.manifest) AS "currentConfig",
        (SELECT jsonb_build_object('config', pv.config, 'manifest', pv.manifest)
         FROM market_versions pv WHERE pv.resource_id=r.id AND pv.id<>v.id
         ORDER BY pv.created_at DESC LIMIT 1) AS "previousConfig",
        v.submitted_at AS "submittedAt", a.name AS "ownerName"
       FROM market_resources r JOIN market_versions v ON v.id=r.current_version_id JOIN market_accounts a ON a.id=r.owner_account_id
       WHERE v.workflow_state IN ('submitted','scanning','in_review','approved','rejected') ORDER BY v.created_at`,
    );
    return c.json({ items: result.rows, totalCount: result.rowCount || 0 });
  });
  app.get('/api/internal/resources', requireRole('reviewer', 'admin'), async (c) => {
    const input = AdminResourceListQuerySchema.parse({
      clientVisible: c.req.query('clientVisible'),
      page: c.req.query('page'),
      pageSize: c.req.query('pageSize'),
      q: c.req.query('q'),
      status: c.req.query('status'),
      type: c.req.query('type'),
      visibility: c.req.query('visibility'),
      workflowState: c.req.query('workflowState'),
    });
    const values: unknown[] = [];
    const filters: string[] = [];

    const addFilter = (column: string, value: unknown) => {
      if (value === undefined || value === '') return;
      values.push(value);
      filters.push(`${column}=$${values.length}`);
    };

    addFilter('r.type', input.type);
    addFilter('r.status', input.status);
    addFilter('r.visibility', input.visibility);
    addFilter('v.workflow_state', input.workflowState);
    if (input.q) {
      values.push(`%${input.q}%`);
      filters.push(
        `(r.name ILIKE $${values.length} OR r.description ILIKE $${values.length} OR r.identifier ILIKE $${values.length})`,
      );
    }
    if (input.clientVisible === true) {
      filters.push(
        `r.status='published' AND v.workflow_state='published' AND r.visibility IN ('internal','public')`,
      );
    } else if (input.clientVisible === false) {
      filters.push(
        `NOT (r.status='published' AND v.workflow_state='published' AND r.visibility IN ('internal','public'))`,
      );
    }

    values.push(input.pageSize, (input.page - 1) * input.pageSize);
    const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const result = await repository.getPool().query(
      `SELECT r.type, r.identifier, r.name, r.description, r.category, r.status, r.visibility,
        r.tags, r.updated_at AS "updatedAt", v.version,
        v.workflow_state AS "workflowState", a.external_user_id AS "ownerUserId",
        COALESCE(a.name, a.email, a.external_user_id) AS "ownerName",
        count(*) OVER()::int AS "totalCount"
       FROM market_resources r
       LEFT JOIN market_versions v ON v.id=r.current_version_id
       JOIN market_accounts a ON a.id=r.owner_account_id
       ${where}
       ORDER BY r.updated_at DESC, r.id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    const totalCount = Number(result.rows[0]?.totalCount || 0);
    return c.json({
      currentPage: input.page,
      items: result.rows.map(({ totalCount: _totalCount, ...item }) => ({
        ...item,
        clientVisible:
          item.status === 'published' &&
          item.workflowState === 'published' &&
          (item.visibility === 'internal' || item.visibility === 'public'),
      })),
      pageSize: input.pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / input.pageSize),
    });
  });
  app.get('/api/internal/resources/summary', requireRole('reviewer', 'admin'), async (c) => {
    const result = await repository.getPool().query(
      `SELECT r.type, r.status, r.visibility, count(*)::int AS count,
        count(*) FILTER (
          WHERE r.status='published'
            AND v.workflow_state='published'
            AND r.visibility IN ('internal', 'public')
        )::int AS "clientVisibleCount"
       FROM market_resources r
       LEFT JOIN market_versions v ON v.id=r.current_version_id
       GROUP BY r.type, r.status, r.visibility
       ORDER BY r.type, r.status, r.visibility`,
    );
    return c.json({ items: result.rows });
  });
  app.post(
    '/api/internal/resources/:type/:identifier/review',
    requireRole('reviewer', 'admin'),
    async (c) => {
      const type = c.req.param('type') as ResourceType;
      const input = ReviewActionSchema.parse(await c.req.json());
      return c.json(
        await repository.review(
          type,
          c.req.param('identifier') || '',
          input.action,
          input.reason,
          c.get('account'),
          input.scanResult,
        ),
      );
    },
  );
  app.post(
    '/api/internal/resources/:type/:identifier/rollback',
    requireRole('admin'),
    async (c) => {
      const input = await jsonBody(c);
      const result = await repository.getPool().query(
        `UPDATE market_resources r SET current_version_id=v.id, status='published', updated_at=now()
       FROM market_versions v WHERE v.resource_id=r.id AND r.type=$1 AND r.identifier=$2
         AND v.version=$3 AND v.workflow_state IN ('published','deprecated') RETURNING r.identifier`,
        [c.req.param('type'), c.req.param('identifier'), input.version],
      );
      if (!result.rowCount) return c.json({ error: 'eligible_version_not_found' }, 404);
      await repository.audit(
        c.get('account'),
        undefined,
        'version.rollback',
        c.req.param('type'),
        c.req.param('identifier'),
        { version: input.version },
      );
      return c.json({
        identifier: c.req.param('identifier'),
        success: true,
        version: input.version,
      });
    },
  );
  app.get('/api/internal/audit', requireRole('admin'), async (c) => {
    const result = await repository
      .getPool()
      .query(`SELECT * FROM market_audit_logs ORDER BY created_at DESC LIMIT $1`, [
        Math.min(500, Number(c.req.query('limit') || 100)),
      ]);
    return c.json({ items: result.rows, totalCount: result.rowCount || 0 });
  });
  app.get('/api/internal/allowlist', requireRole('admin'), async (c) => {
    const result = await repository
      .getPool()
      .query(`SELECT * FROM market_connector_allowlist ORDER BY provider, hostname`);
    return c.json({ items: result.rows });
  });
  app.get('/api/internal/categories', requireRole('admin'), async (c) => {
    const result = await repository
      .getPool()
      .query(`SELECT * FROM market_categories ORDER BY resource_type, sort_order, slug`);
    return c.json({ items: result.rows });
  });
  app.post('/api/internal/categories', requireRole('admin'), async (c) => {
    const input = await jsonBody(c);
    const result = await repository.getPool().query(
      `INSERT INTO market_categories(resource_type,slug,sort_order,localizations) VALUES ($1,$2,$3,$4)
       ON CONFLICT(resource_type,slug) DO UPDATE SET sort_order=excluded.sort_order, localizations=excluded.localizations RETURNING *`,
      [
        input.resourceType,
        input.slug,
        input.sortOrder || 0,
        JSON.stringify(input.localizations || {}),
      ],
    );
    await repository.audit(
      c.get('account'),
      undefined,
      'category.upsert',
      input.resourceType,
      input.slug,
      input,
    );
    return c.json(result.rows[0], 201);
  });
  app.get('/api/internal/accounts', requireRole('admin'), async (c) => {
    const result = await repository
      .getPool()
      .query(
        `SELECT id, external_user_id AS "userId", email, name, role, updated_at AS "updatedAt" FROM market_accounts ORDER BY updated_at DESC`,
      );
    return c.json({ items: result.rows });
  });
  app.post('/api/internal/accounts/:userId/role', requireRole('admin'), async (c) => {
    const input = await jsonBody(c);
    if (!['submitter', 'reviewer', 'admin'].includes(input.role))
      return c.json({ error: 'invalid_role' }, 400);
    const result = await repository
      .getPool()
      .query(
        `UPDATE market_accounts SET role=$1, updated_at=now() WHERE external_user_id=$2 RETURNING id, external_user_id AS "userId", email, name, role`,
        [input.role, c.req.param('userId')],
      );
    if (!result.rowCount) return c.json({ error: 'account_not_found' }, 404);
    await repository.audit(
      c.get('account'),
      undefined,
      'account.role.update',
      'account',
      c.req.param('userId'),
      { role: input.role },
    );
    return c.json(result.rows[0]);
  });
  app.post('/api/internal/allowlist', requireRole('admin'), async (c) => {
    const input = await jsonBody(c);
    const url = new URL(input.url);
    const result = await repository.getPool().query(
      `INSERT INTO market_connector_allowlist(provider,protocol,hostname,port,allow_private,created_by) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT(provider,protocol,hostname,port) DO UPDATE SET enabled=true, allow_private=excluded.allow_private RETURNING *`,
      [
        input.provider,
        url.protocol,
        url.hostname,
        url.port ? Number(url.port) : null,
        Boolean(input.allowPrivate),
        c.get('account').id,
      ],
    );
    await repository.audit(
      c.get('account'),
      undefined,
      'allowlist.upsert',
      'connector',
      input.provider,
      { url: input.url },
    );
    return c.json(result.rows[0], 201);
  });
  app.patch('/api/internal/allowlist/:id', requireRole('admin'), async (c) => {
    const input = await jsonBody(c);
    const result = await repository
      .getPool()
      .query(`UPDATE market_connector_allowlist SET enabled=$1 WHERE id=$2 RETURNING *`, [
        Boolean(input.enabled),
        c.req.param('id'),
      ]);
    if (!result.rowCount) return c.json({ error: 'allowlist_entry_not_found' }, 404);
    await repository.audit(
      c.get('account'),
      undefined,
      'allowlist.status.update',
      'connector',
      c.req.param('id'),
      { enabled: Boolean(input.enabled) },
    );
    return c.json(result.rows[0]);
  });

  return app;
};
