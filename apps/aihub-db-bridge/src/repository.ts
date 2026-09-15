import { createPool as createMySqlPool, type Pool as MySqlPool } from 'mysql2/promise';
import { Pool as PgPool } from 'pg';

import type {
  AihubBridgePage,
  AihubBridgeToken,
  AihubBridgeUsageLog,
  AihubBridgeUser,
  AihubOAuthBindingResult,
  BoundTokenAvailability,
  BoundTokenInspection,
  BoundTokenPatch,
} from './types.js';

export type AihubBridgeDialect = 'mysql' | 'postgres';

export interface QueryClient {
  query: <T = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>;
  transaction?: <T>(callback: (client: QueryClient) => Promise<T>) => Promise<T>;
}

export interface RepositoryOptions {
  client?: QueryClient;
  connectionString?: string;
  dialect?: AihubBridgeDialect;
  queryTimeoutMs?: number;
}

export interface IdentityLookup {
  email?: string;
  username?: string;
}

export interface UsageLogQuery {
  endTimestamp?: number;
  page?: number;
  pageSize?: number;
  startTimestamp?: number;
}

const DEFAULT_PAGE_SIZE = 100;
const LOG_TYPE_CONSUME = 2;
const TOKEN_STATUS_ENABLED = 1;

const inferDialect = (connectionString?: string): AihubBridgeDialect =>
  /^postgres(?:ql)?:\/\//i.test(connectionString || '') ? 'postgres' : 'mysql';

const convertQuestionPlaceholdersToPg = (sql: string) => {
  let index = 0;

  return sql.replaceAll('?', () => `$${++index}`);
};

const buildMySqlPoolConfig = (connectionString: string) => {
  const url = new URL(connectionString);

  return {
    charset: 'utf8mb4',
    connectTimeout: 15_000,
    connectionLimit: 5,
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    host: url.hostname,
    password: decodeURIComponent(url.password),
    port: url.port ? Number(url.port) : 3306,
    timezone: 'Z',
    user: decodeURIComponent(url.username),
    waitForConnections: true,
  };
};

class MySqlQueryClient implements QueryClient {
  private pool: MySqlPool;

  constructor(connectionString: string) {
    this.pool = createMySqlPool(buildMySqlPoolConfig(connectionString));
  }

  async query<T = Record<string, unknown>>(text: string, values: unknown[] = []) {
    const [rows] = await this.pool.execute(text, values);

    return { rows: rows as T[] };
  }

  async transaction<T>(callback: (client: QueryClient) => Promise<T>) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const client: QueryClient = {
        query: async <R = Record<string, unknown>>(text: string, values: unknown[] = []) => {
          const [rows] = await connection.execute(text, values);
          return { rows: rows as R[] };
        },
      };
      const result = await callback(client);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

class PgQueryClient implements QueryClient {
  private pool: PgPool;

  constructor(connectionString: string, queryTimeoutMs: number) {
    this.pool = new PgPool({ connectionString, statement_timeout: queryTimeoutMs });
  }

  async query<T = Record<string, unknown>>(text: string, values: unknown[] = []) {
    const result = await this.pool.query(convertQuestionPlaceholdersToPg(text), values);

    return { rows: result.rows as T[] };
  }

  async transaction<T>(callback: (client: QueryClient) => Promise<T>) {
    const connection = await this.pool.connect();
    try {
      await connection.query('begin');
      const client: QueryClient = {
        query: async <R = Record<string, unknown>>(text: string, values: unknown[] = []) => {
          const result = await connection.query(convertQuestionPlaceholdersToPg(text), values);
          return { rows: result.rows as R[] };
        },
      };
      const result = await callback(client);
      await connection.query('commit');
      return result;
    } catch (error) {
      await connection.query('rollback');
      throw error;
    } finally {
      connection.release();
    }
  }
}

export class AihubBridgeRepository {
  private client?: QueryClient;
  private connectionString?: string;
  private dialect: AihubBridgeDialect;
  private queryTimeoutMs: number;

  constructor(options: RepositoryOptions = {}) {
    this.client = options.client;
    this.connectionString = options.connectionString;
    this.dialect = options.dialect || inferDialect(options.connectionString);
    this.queryTimeoutMs = options.queryTimeoutMs || 15_000;
  }

  private getClient() {
    if (this.client) return this.client;
    if (!this.connectionString) throw new Error('AIHUB_READONLY_DATABASE_URL is not configured');

    this.client =
      this.dialect === 'postgres'
        ? new PgQueryClient(this.connectionString, this.queryTimeoutMs)
        : new MySqlQueryClient(this.connectionString);

    return this.client;
  }

  private groupColumn() {
    return this.dialect === 'postgres' ? '"group"' : '`group`';
  }

  private keyColumn() {
    return this.dialect === 'postgres' ? '"key"' : '`key`';
  }

  private async query<T>(text: string, values: unknown[] = []) {
    const result = await this.getClient().query<T>(text, values);

    return result.rows;
  }

  private async withTransaction<T>(callback: (client: QueryClient) => Promise<T>) {
    const client = this.getClient();
    if (client.transaction) return client.transaction(callback);

    // Test and legacy injected clients may not expose transaction support. The
    // production clients above always do.
    return callback(client);
  }

  private normalizeToken(token?: AihubBridgeToken): AihubBridgeToken | undefined {
    if (!token) return undefined;

    return {
      ...token,
      model_limits_enabled: Boolean(token.model_limits_enabled),
      unlimited_quota: Boolean(token.unlimited_quota),
    };
  }

  async findUserByIdentity({ email, username }: IdentityLookup) {
    if (!email && !username) return undefined;

    const groupColumn = this.groupColumn();
    const rows = await this.query<AihubBridgeUser>(
      `
select id, username, display_name, email, quota, used_quota, request_count, ${groupColumn} as ${groupColumn}, status, role
from users
where deleted_at is null
  and (
    (? <> '' and lower(email) = lower(?))
    or (? <> '' and lower(username) = lower(?))
  )
order by
  case when ? <> '' and lower(username) = lower(?) then 0 else 1 end,
  id desc
limit 1
      `.trim(),
      [email || '', email || '', username || '', username || '', username || '', username || ''],
    );

    return rows[0];
  }

  async findUserById(userId: number) {
    const groupColumn = this.groupColumn();
    const rows = await this.query<AihubBridgeUser>(
      `
select id, username, display_name, email, quota, used_quota, request_count, ${groupColumn} as ${groupColumn}, status, role
from users
where deleted_at is null and id = ?
limit 1
      `.trim(),
      [userId],
    );

    return rows[0];
  }

  async findManagedToken(userId: number, tokenName: string) {
    const groupColumn = this.groupColumn();
    const selectedColumns = `
select id, user_id, name, ${this.keyColumn()} as ${this.keyColumn()}, status, expired_time,
       remain_quota, unlimited_quota, model_limits_enabled, model_limits, used_quota,
       ${groupColumn} as ${groupColumn}
from tokens
    `.trim();

    const namedRows = await this.query<AihubBridgeToken>(
      `
${selectedColumns}
where user_id = ? and name = ? and deleted_at is null
order by id desc
limit 1
      `.trim(),
      [userId, tokenName],
    );

    if (namedRows[0]) return this.normalizeToken(namedRows[0]);

    return undefined;
  }

  async findManagedTokenById(userId: number, tokenId: number) {
    const groupColumn = this.groupColumn();
    const now = Math.floor(Date.now() / 1000);
    const rows = await this.query<AihubBridgeToken>(
      `
select id, user_id, name, ${this.keyColumn()} as ${this.keyColumn()}, status, expired_time,
       remain_quota, unlimited_quota, model_limits_enabled, model_limits, used_quota,
       ${groupColumn} as ${groupColumn}
from tokens
where id = ?
  and user_id = ?
  and deleted_at is null
  and status = ${TOKEN_STATUS_ENABLED}
  and (unlimited_quota = true or remain_quota > 0)
  and (expired_time = -1 or expired_time > ?)
limit 1
      `.trim(),
      [tokenId, userId, now],
    );

    return this.normalizeToken(rows[0]);
  }

  /** Inspect the exact bound token without selecting its API key. */
  async inspectBoundToken(userId: number, tokenId: number): Promise<BoundTokenInspection> {
    const groupColumn = this.groupColumn();
    const rows = await this.query<AihubBridgeToken & { deleted_at?: Date | null }>(
      `select id, user_id, name, status, expired_time, remain_quota, unlimited_quota,
              model_limits_enabled, model_limits, used_quota, allow_ips,
              ${groupColumn} as ${groupColumn}, deleted_at
       from tokens where id = ? limit 1`,
      [tokenId],
    );
    const row = rows[0];
    if (!row) return { availability: 'missing' };
    if (row.user_id !== userId) return { availability: 'owner_mismatch' };

    const { deleted_at, key: _key, ...safeToken } = row;
    const token = this.normalizeToken(safeToken)!;
    const now = Math.floor(Date.now() / 1000);
    const availability: BoundTokenAvailability = deleted_at
      ? 'deleted'
      : token.status !== TOKEN_STATUS_ENABLED
        ? 'disabled'
        : token.expired_time == null || (token.expired_time !== -1 && token.expired_time <= now)
          ? 'expired'
          : !token.unlimited_quota && (token.remain_quota ?? 0) <= 0
            ? 'exhausted'
            : 'active';

    return { availability, token };
  }

  /** Update only approved settings of a token owned by the requested user. */
  async updateBoundToken(
    userId: number,
    tokenId: number,
    patch: BoundTokenPatch,
  ): Promise<BoundTokenInspection> {
    const columns: Record<keyof BoundTokenPatch, string> = {
      allow_ips: 'allow_ips',
      expired_time: 'expired_time',
      group: this.groupColumn(),
      model_limits: 'model_limits',
      model_limits_enabled: 'model_limits_enabled',
      remain_quota: 'remain_quota',
      status: 'status',
      unlimited_quota: 'unlimited_quota',
    };
    const entries = Object.entries(patch) as Array<[keyof BoundTokenPatch, unknown]>;
    if (entries.length === 0) throw new Error('No token settings were supplied');

    const result = await this.withTransaction(async (client) => {
      const rows = await client.query<{ deleted_at?: Date | null; user_id: number }>(
        'select user_id, deleted_at from tokens where id = ? for update',
        [tokenId],
      );
      const row = rows.rows[0];
      if (!row) return { availability: 'missing' as const };
      if (row.user_id !== userId) return { availability: 'owner_mismatch' as const };
      if (row.deleted_at) return { availability: 'deleted' as const };

      await client.query(
        `update tokens set ${entries.map(([field]) => `${columns[field]} = ?`).join(', ')}
         where id = ? and user_id = ? and deleted_at is null`,
        [...entries.map(([, value]) => value), tokenId, userId],
      );
      return { availability: 'active' as const };
    });
    return result.availability === 'active' ? this.inspectBoundToken(userId, tokenId) : result;
  }

  async listManagedTokens(userId: number, tokenName: string) {
    const groupColumn = this.groupColumn();
    const selectedColumns = `
select id, user_id, name, status, expired_time, remain_quota, unlimited_quota,
       model_limits_enabled, model_limits, used_quota, ${groupColumn} as ${groupColumn}
from tokens
    `.trim();

    const namedRows = await this.query<AihubBridgeToken>(
      `
${selectedColumns}
where user_id = ? and name = ? and deleted_at is null
order by id desc
      `.trim(),
      [userId, tokenName],
    );

    return namedRows.map((token) => this.normalizeToken(token)!);
  }

  async listAccessibleModels(group?: string, token?: AihubBridgeToken) {
    const tokenLimits = token?.model_limits_enabled
      ? token.model_limits
          ?.split(',')
          .map((model) => model.trim())
          .filter(Boolean)
      : undefined;

    const groupColumn = this.groupColumn();
    if (token?.user_id) {
      const rows = await this.query<{ model: string }>(
        `
select distinct a.model
from abilities a
join users u on u.${groupColumn} = a.${groupColumn}
where a.enabled = true
  and u.deleted_at is null
  and u.id = ?
order by a.model asc
        `.trim(),
        [token.user_id],
      );

      const userGroupModels = rows.map((row) => row.model).filter(Boolean);
      if (token.model_limits_enabled) {
        const allowedByToken = new Set(tokenLimits || []);
        return userGroupModels.filter((model) => allowedByToken.has(model));
      }

      return userGroupModels;
    }

    const rows = await this.query<{ model: string }>(
      `
select distinct model
from abilities
where enabled = true
  and ${groupColumn} = ?
order by model asc
      `.trim(),
      [group || 'default'],
    );

    const groupModels = rows.map((row) => row.model).filter(Boolean);
    if (token?.model_limits_enabled) {
      const allowedByToken = new Set(tokenLimits || []);
      return groupModels.filter((model) => allowedByToken.has(model));
    }

    return groupModels;
  }

  async getUsageLogs(
    userId: number,
    {
      endTimestamp = Math.floor(Date.now() / 1000),
      page = 1,
      pageSize = DEFAULT_PAGE_SIZE,
      startTimestamp = 0,
    }: UsageLogQuery = {},
  ): Promise<AihubBridgePage<AihubBridgeUsageLog>> {
    const normalizedPageSize = Number.isFinite(pageSize) ? Math.trunc(pageSize) : DEFAULT_PAGE_SIZE;
    const normalizedPage = Number.isFinite(page) ? Math.trunc(page) : 1;
    const limit = Math.max(1, normalizedPageSize);
    const offset = Math.max(0, normalizedPage - 1) * limit;
    const paginationClause =
      this.dialect === 'mysql' ? `limit ${limit} offset ${offset}` : 'limit ? offset ?';
    const paginationParams = this.dialect === 'mysql' ? [] : [limit, offset];
    const rows = await this.query<AihubBridgeUsageLog>(
      `
select id, created_at, model_name, token_name, prompt_tokens, completion_tokens, quota, request_id
from logs
where user_id = ?
  and created_at >= ?
  and created_at <= ?
  and type = ${LOG_TYPE_CONSUME}
order by created_at desc, id desc
${paginationClause}
      `.trim(),
      [userId, startTimestamp, endTimestamp, ...paginationParams],
    );

    return { items: rows, total: rows.length };
  }

  /**
   * Reassign a token to a different Aihub user by updating `user_id`.
   * Requires UPDATE privilege on the `tokens` table.
   * Returns true if the row was updated, false if no matching token was found.
   */
  async reassignToken(tokenId: number, targetUserId: number): Promise<boolean> {
    const rows = await this.query<{ affected: number }>(
      `
update tokens
set user_id = ?
where id = ?
  and deleted_at is null
      `.trim(),
      [targetUserId, tokenId],
    );

    // mysql2 returns affectedRows inside the rows array as a special header;
    // our QueryClient returns the result rows. For UPDATE, we check rowCount.
    // Since the abstraction doesn't expose rowCount uniformly, we re-read to verify.
    const updated = await this.query<{ id: number; user_id: number }>(
      `select id, user_id from tokens where id = ? and deleted_at is null`,
      [tokenId],
    );

    return updated[0]?.user_id === targetUserId;
  }

  /**
   * Update a token's name. Requires UPDATE privilege on the `tokens` table.
   */
  async updateTokenName(tokenId: number, name: string): Promise<boolean> {
    await this.query(
      `
update tokens
set name = ?
where id = ?
  and deleted_at is null
      `.trim(),
      [name, tokenId],
    );

    const updated = await this.query<{ id: number; name: string }>(
      `select id, name from tokens where id = ? and deleted_at is null`,
      [tokenId],
    );

    return updated[0]?.name === name;
  }

  /** Reconcile one OAuth binding without ever overwriting a non-empty value. */
  async inspectOAuthBinding(
    userId: number,
    providerId: number,
    providerUserId: string,
  ): Promise<AihubOAuthBindingResult> {
    const rows = await this.query<{
      provider_user_id?: string | null;
      user_id: number;
    }>(
      `select user_id, provider_user_id from user_oauth_bindings
       where provider_id = ? and (user_id = ? or provider_user_id = ?)`,
      [providerId, userId, providerUserId],
    );
    if (rows.some((row) => row.user_id === userId && row.provider_user_id === providerUserId)) {
      return { status: 'existing' };
    }
    if (rows.some((row) => row.user_id !== userId && row.provider_user_id === providerUserId)) {
      return { reason: 'provider_user_id_in_use', status: 'conflict' };
    }
    if (
      rows.some((row) => row.user_id === userId && String(row.provider_user_id || '').trim() !== '')
    ) {
      return { reason: 'user_already_bound', status: 'conflict' };
    }
    return { status: 'missing' };
  }

  async linkOAuthBinding(
    userId: number,
    providerId: number,
    providerUserId: string,
  ): Promise<AihubOAuthBindingResult> {
    return this.withTransaction(async (client) => {
      const query = async <T>(text: string, values: unknown[] = []) =>
        (await client.query<T>(text, values)).rows;
      const rows = await query<{
        id: number;
        provider_user_id?: string | null;
        user_id: number;
      }>(
        `
select id, user_id, provider_user_id from user_oauth_bindings
where provider_id = ? and (user_id = ? or provider_user_id = ?)
for update
        `.trim(),
        [providerId, userId, providerUserId],
      );

      const exact = rows.find(
        (row) => row.user_id === userId && row.provider_user_id === providerUserId,
      );
      if (exact) return { status: 'existing' };

      const claimedByOtherUser = rows.find(
        (row) => row.user_id !== userId && row.provider_user_id === providerUserId,
      );
      if (claimedByOtherUser) {
        return { reason: 'provider_user_id_in_use', status: 'conflict' };
      }

      const currentUserRows = rows.filter((row) => row.user_id === userId);
      const conflictingCurrentBinding = currentUserRows.find(
        (row) => String(row.provider_user_id || '').trim() !== '',
      );
      if (conflictingCurrentBinding) {
        return { reason: 'user_already_bound', status: 'conflict' };
      }

      const emptyBinding = currentUserRows[0];
      if (emptyBinding) {
        await query(
          `
update user_oauth_bindings set provider_user_id = ?
where id = ? and trim(coalesce(provider_user_id, '')) = ''
          `.trim(),
          [providerUserId, emptyBinding.id],
        );

        const repaired = await query<{ id: number }>(
          `select id from user_oauth_bindings where id = ? and provider_user_id = ?`,
          [emptyBinding.id, providerUserId],
        );
        if (repaired.length > 0) return { status: 'repaired' };

        return { reason: 'user_already_bound', status: 'conflict' };
      }

      const insertSql =
        this.dialect === 'postgres'
          ? `insert into user_oauth_bindings (user_id, provider_id, provider_user_id, created_at)
             values (?, ?, ?, current_timestamp) on conflict do nothing`
          : `insert ignore into user_oauth_bindings (user_id, provider_id, provider_user_id, created_at)
             values (?, ?, ?, now(3))`;
      await query(insertSql, [userId, providerId, providerUserId]);

      const inserted = await query<{ user_id: number }>(
        `select user_id from user_oauth_bindings where provider_id = ? and provider_user_id = ?`,
        [providerId, providerUserId],
      );
      if (inserted[0]?.user_id === userId) return { status: 'created' };

      return { reason: 'provider_user_id_in_use', status: 'conflict' };
    });
  }
}
