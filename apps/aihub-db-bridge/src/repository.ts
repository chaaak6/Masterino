import { createPool as createMySqlPool, type Pool as MySqlPool } from 'mysql2/promise';
import { Pool as PgPool } from 'pg';

import type {
  AihubBridgePage,
  AihubBridgeToken,
  AihubBridgeUsageLog,
  AihubBridgeUser,
} from './types.js';

export type AihubBridgeDialect = 'mysql' | 'postgres';

export interface QueryClient {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
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
  /^postgres(ql)?:\/\//i.test(connectionString || '') ? 'postgres' : 'mysql';

const convertQuestionPlaceholdersToPg = (sql: string) => {
  let index = 0;

  return sql.replace(/\?/g, () => `$${++index}`);
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
  case when ? <> '' and lower(email) = lower(?) then 0 else 1 end,
  id desc
limit 1
      `.trim(),
      [email || '', email || '', username || '', username || '', email || '', email || ''],
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

    const now = Math.floor(Date.now() / 1000);
    const fallbackRows = await this.query<AihubBridgeToken>(
      `
${selectedColumns}
where user_id = ?
  and deleted_at is null
  and status = ${TOKEN_STATUS_ENABLED}
  and (unlimited_quota = true or remain_quota > 0)
  and (expired_time = -1 or expired_time > ?)
order by accessed_time desc, id desc
limit 1
      `.trim(),
      [userId, now],
    );

    return this.normalizeToken(fallbackRows[0]);
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

    if (namedRows.length > 0) return namedRows.map((token) => this.normalizeToken(token)!);

    const now = Math.floor(Date.now() / 1000);
    const fallbackRows = await this.query<AihubBridgeToken>(
      `
${selectedColumns}
where user_id = ?
  and deleted_at is null
  and status = ${TOKEN_STATUS_ENABLED}
  and (unlimited_quota = true or remain_quota > 0)
  and (expired_time = -1 or expired_time > ?)
order by accessed_time desc, id desc
      `.trim(),
      [userId, now],
    );

    return fallbackRows.map((token) => this.normalizeToken(token)!);
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
}
