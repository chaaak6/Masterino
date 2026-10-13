/** Isolated browser BDD backend: real catalog router/repository + explicit fake Aihub transport. */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { nodeHTTPRequestHandler } from '@trpc/server/adapters/node-http';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';

import * as schemaExports from '../../packages/database/src/schemas';
import { getServerDB } from '../../packages/database/src/core/db-adaptor';
import { withCurrentModelAccess } from '../../apps/server/src/services/modelCatalog/runtimeGuard';
import { publicProcedure, router } from '../../packages/trpc/src/lambda';
import { modelCatalogRouter } from '../../apps/server/src/routers/lambda/modelCatalog';

const schema = (schemaExports as any).default ?? schemaExports;
const port = 19327;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
for (const table of [
  schema.systemConfigs,
  schema.enterpriseAuditLogs,
  schema.newApiBindings,
  schema.aiModels,
  schema.users,
  schema.roles,
  schema.permissions,
  schema.rolePermissions,
  schema.userRoles,
]) {
  if (!table) throw new Error('Missing fixture schema table');
  const config = getTableConfig(table);
  const fields = config.columns.map((column) => {
    const raw = column.getSQLType();
    const type = column.enumValues ? 'text' : raw;
    return `"${column.name}" ${type}${column.primary ? ' PRIMARY KEY' : ''}`;
  });
  await pool.query(`CREATE TABLE IF NOT EXISTS "${config.name}" (${fields.join(',')})`);
}
await pool.query(
  'CREATE UNIQUE INDEX IF NOT EXISTS system_configs_key_scope_bdd ON system_configs(key,scope)',
);
await pool.query(
  await readFile('packages/database/migrations/0124_managed_model_catalog.sql', 'utf8'),
);
await pool.query(
  'TRUNCATE managed_model_catalog_revisions, managed_model_catalog, system_configs, enterprise_audit_logs, new_api_bindings, ai_models',
);
await pool.query(
  "INSERT INTO new_api_bindings (user_id,new_api_user_id,managed_token_id,status,updated_at,readiness_version) VALUES ('bdd-user',7,12,'active',now(),2)",
);

let accessible = ['bdd-chat', 'bdd-vision'];
let bridgeOffline = false;
let empty = false;
const calls: { path: string; method: string }[] = [];
const api = router({
  modelCatalog: modelCatalogRouter,
  admin: router({ me: publicProcedure.query(() => ({ isPlatformAdmin: true })) }),
});
const send = (res: any, data: unknown, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};
const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:19328');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'content-type,x-bdd-anonymous,x-bdd-member');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url!, `http://localhost:${port}`);
  if (url.pathname === '/api/auth/get-session')
    return send(res, {
      user: { id: 'bdd-user', name: 'BDD Admin', email: 'bdd@example.test' },
      session: { id: 'bdd-session', userId: 'bdd-user', expiresAt: '2030-01-01T00:00:00Z' },
    });
  if (url.pathname === '/bdd/reset' && req.method === 'POST') {
    await pool.query(
      'TRUNCATE managed_model_catalog_revisions, managed_model_catalog, system_configs, enterprise_audit_logs',
    );
    await pool.query(
      "INSERT INTO system_configs (id,key,scope,value) VALUES ('bdd-head','managed_model_catalog','global',$1)",
      [
        JSON.stringify({
          enabled: true,
          silentRefreshEnabled: true,
          generation: `bdd-${Date.now()}`,
        }),
      ],
    );
    accessible = ['bdd-chat', 'bdd-vision'];
    bridgeOffline = false;
    empty = false;
    calls.length = 0;
    return send(res, { ok: true });
  }
  if (url.pathname === '/bdd/call') {
    let body = '';
    for await (const part of req) body += part;
    const { model } = JSON.parse(body);
    const runtime = withCurrentModelAccess(
      { chat: async (payload: any) => ({ ok: true, model: payload.model }) } as any,
      await getServerDB(),
      'bdd-user',
      'newapi',
      'bdd-fixture-only',
    );
    try {
      return send(res, await runtime.chat({ model } as any));
    } catch (error: any) {
      return send(
        res,
        { code: error.code, message: error.message },
        error.code === 'FORBIDDEN' ? 403 : 503,
      );
    }
  }
  if (url.pathname === '/bdd/state') {
    if (req.method === 'POST') {
      let body = '';
      for await (const part of req) body += part;
      const patch = JSON.parse(body);
      if (patch.accessible) accessible = patch.accessible;
      if (patch.bridgeOffline !== undefined) bridgeOffline = patch.bridgeOffline;
      if (patch.empty !== undefined) empty = patch.empty;
    }
    return send(res, { accessible, bridgeOffline, calls });
  }
  if (url.pathname.startsWith('/trpc/lambda/')) {
    return nodeHTTPRequestHandler({
      req,
      res,
      path: url.pathname.slice('/trpc/lambda/'.length),
      router: api,
      createContext: async () =>
        ({
          userId: req.headers['x-bdd-anonymous'] ? undefined : 'bdd-user',
          user: { role: req.headers['x-bdd-member'] ? 'member' : 'platform_admin' },
          resHeaders: new Headers(),
        }) as any,
    });
  }
  if (
    url.pathname.startsWith('/v1/') &&
    (url.pathname !== '/v1/models' || !req.headers.authorization?.startsWith('Bearer sk-'))
  ) {
    calls.push({ path: url.pathname + url.search, method: req.method! });
    if (bridgeOffline)
      return send(res, { success: false, error: { message: 'BDD bridge unavailable' } }, 503);
    const data =
      url.pathname === '/v1/models'
        ? ['bdd-chat', 'bdd-vision']
        : url.pathname === '/v1/users/7'
          ? { id: 7, group: 'default', status: 1 }
          : url.pathname === '/v1/users/7/managed-tokens/12'
            ? {
                id: 12,
                user_id: 7,
                name: 'masterlion-managed',
                key: 'bdd-fixture-only',
                status: 1,
                unlimited_quota: true,
              }
            : url.pathname === '/v1/users/7/models' && url.searchParams.get('tokenId') === '12'
              ? { tokenId: 12, models: empty ? [] : accessible }
              : undefined;
    return data === undefined
      ? send(res, { success: false }, 404)
      : send(res, { success: true, data });
  }
  if (url.pathname === '/v1/models') {
    calls.push({ path: url.pathname, method: req.method! });
    return send(res, {
      data: accessible.map((id) => ({ id, type: 'chat', context_window: 128000 })),
    });
  }
  if (url.pathname === '/api/status')
    return send(res, { success: true, data: { quota_per_unit: 500000, usd_exchange_rate: 1 } });
  if (url.pathname === '/api/pricing')
    return send(res, {
      success: true,
      pricing_version: 'fixture-v1',
      group_ratio: { default: 1 },
      data: accessible.map((model_name) => ({
        model_name,
        quota_type: 0,
        model_ratio: 0.4,
        completion_ratio: 3.5,
        cache_ratio: 0,
        enable_groups: ['default'],
      })),
    });
  send(res, { error: 'Not found' }, 404);
});
server.listen(port, '127.0.0.1', () => console.log('Catalog BDD backend ready on 19327'));
