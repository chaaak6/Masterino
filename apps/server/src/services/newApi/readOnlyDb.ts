import { createPool as createMySqlPool, type Pool as MySqlPool } from 'mysql2/promise';
import { Pool as PgPool } from 'pg';

import type { NewApiLogItem, NewApiPage, NewApiToken, NewApiUser } from './client';

export type AihubReadOnlyDialect = 'mysql' | 'postgres';

export interface NewApiReadOnlyQueryClient {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

export interface NewApiReadOnlyDbOptions {
  client?: NewApiReadOnlyQueryClient;
  connectionString?: string;
  dialect?: AihubReadOnlyDialect;
}

export interface NewApiIdentityLookup {
  email?: string;
  username?: string;
}

export interface NewApiUsageLogQuery {
  endTimestamp?: number;
  page?: number;
  pageSize?: number;
  startTimestamp?: number;
}

const DEFAULT_PAGE_SIZE = 100;
const LOG_TYPE_CONSUME = 2;
const TOKEN_STATUS_ENABLED = 1;

const inferDialect = (connectionString?: string): AihubReadOnlyDialect => {
  if (!connectionString) return 'mysql';
  if (/^postgres(ql)?:\/\//i.test(connectionString)) return 'postgres';

  return 'mysql';
};

const convertQuestionPlaceholdersToPg = (sql: string) => {
  let index = 0;

  return sql.replace(/\?/g, () => `$${++index}`);
};

const buildMySqlPoolConfig = (connectionString: string) => {
  if (!/^mysql:\/\//i.test(connectionString)) return connectionString;

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

class PgReadOnlyQueryClient implements NewApiReadOnlyQueryClient {
  private pool: PgPool;

  constructor(connectionString: string) {
    this.pool = new PgPool({
      connectionString,
      statement_timeout: 15_000,
    });
  }

  async query<T = Record<string, unknown>>(text: string, values: unknown[] = []) {
    const result = await this.pool.query(convertQuestionPlaceholdersToPg(text), values);

    return { rows: result.rows as T[] };
  }
}

class MySqlReadOnlyQueryClient implements NewApiReadOnlyQueryClient {
  private pool: MySqlPool;

  constructor(connectionString: string) {
    const config = buildMySqlPoolConfig(connectionString);

    this.pool = typeof config === 'string' ? createMySqlPool(config) : createMySqlPool(config);
  }

  async query<T = Record<string, unknown>>(text: string, values: unknown[] = []) {
    const [rows] = await this.pool.execute(text, values);

    return { rows: rows as T[] };
  }
}

export class NewApiReadOnlyDb {
  private client?: NewApiReadOnlyQueryClient;
  private connectionString?: string;
  private dialect: AihubReadOnlyDialect;

  constructor(options: NewApiReadOnlyDbOptions = {}) {
    this.client = options.client;
    this.connectionString = options.connectionString || process.env.AIHUB_READONLY_DATABASE_URL;
    this.dialect = options.dialect || inferDialect(this.connectionString);
  }

  isEnabled() {
    return Boolean(this.client || this.connectionString);
  }

  getDialect() {
    return this.dialect;
  }

  private getClient() {
    if (this.client) return this.client;
    if (!this.connectionString) throw new Error('AIHUB_READONLY_DATABASE_URL is not configured');

    this.client =
      this.dialect === 'postgres'
        ? new PgReadOnlyQueryClient(this.connectionString)
        : new MySqlReadOnlyQueryClient(this.connectionString);

    return this.client;
  }

  private async query<T>(text: string, values: unknown[] = []) {
    const result = (await this.getClient().query(text, values)) as { rows: T[] };
    return result.rows;
  }

  private groupColumn() {
    return this.dialect === 'postgres' ? '"group"' : '`group`';
  }

  private normalizeToken(token?: NewApiToken): NewApiToken | undefined {
    if (!token) return undefined;

    return {
      ...token,
      model_limits_enabled: Boolean(token.model_limits_enabled),
      unlimited_quota: Boolean(token.unlimited_quota),
    };
  }

  async findUserByIdentity({ email, username }: NewApiIdentityLookup): Promise<NewApiUser | undefined> {
    if (!email && !username) return undefined;

    const groupColumn = this.groupColumn();
    const rows = await this.query<NewApiUser>(
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

  async findUserById(userId: number): Promise<NewApiUser | undefined> {
    const groupColumn = this.groupColumn();
    const rows = await this.query<NewApiUser>(
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

  async findManagedToken(userId: number, tokenName: string): Promise<NewApiToken | undefined> {
    const groupColumn = this.groupColumn();
    const selectedColumns = `
select id, user_id, name, \`key\`, status, expired_time, remain_quota, unlimited_quota,
       model_limits_enabled, model_limits, used_quota, ${groupColumn} as ${groupColumn}
from tokens
    `.trim();
    const safeSelectedColumns =
      this.dialect === 'postgres' ? selectedColumns.replace('`key`', '"key"') : selectedColumns;

    const namedRows = await this.query<NewApiToken>(
      `
${safeSelectedColumns}
where user_id = ? and name = ? and deleted_at is null
order by id desc
limit 1
      `.trim(),
      [userId, tokenName],
    );

    if (namedRows[0]) return this.normalizeToken(namedRows[0]);

    const now = Math.floor(Date.now() / 1000);
    const fallbackRows = await this.query<NewApiToken>(
      `
${safeSelectedColumns}
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

  async listAccessibleModels(group?: string, token?: NewApiToken): Promise<string[]> {
    const tokenLimits = token?.model_limits_enabled
      ? token.model_limits
          ?.split(',')
          .map((model) => model.trim())
          .filter(Boolean)
      : undefined;

    const groupColumn = this.groupColumn();
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
    }: NewApiUsageLogQuery = {},
  ): Promise<NewApiPage<NewApiLogItem>> {
    const normalizedPageSize = Number.isFinite(pageSize) ? Math.trunc(pageSize) : DEFAULT_PAGE_SIZE;
    const normalizedPage = Number.isFinite(page) ? Math.trunc(page) : 1;
    const limit = Math.max(1, normalizedPageSize);
    const offset = Math.max(0, normalizedPage - 1) * limit;
    const paginationClause =
      this.dialect === 'mysql' ? `limit ${limit} offset ${offset}` : 'limit ? offset ?';
    const paginationParams = this.dialect === 'mysql' ? [] : [limit, offset];
    const rows = await this.query<NewApiLogItem>(
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

    return {
      items: rows,
      total: rows.length,
    };
  }
}
