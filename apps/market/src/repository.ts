import type { ResourceType, TrustedClientPayload, WorkflowState } from './contracts.js';
import type { MarketPool } from './db.js';

export interface Account {
  email?: string;
  externalUserId: string;
  id: number;
  name?: string;
  role: 'submitter' | 'reviewer' | 'admin';
}

export interface ListOptions {
  /** Restrict discovery to published originals, excluding personal forks and drafts. */
  publishedOriginalsOnly?: boolean;
  category?: string;
  identifiers?: readonly string[];
  locale?: string;
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: string;
}

const asNumber = (value: unknown): number => Number(value);
const versionFrom = (data: Record<string, any>): string | undefined => {
  const value = data.version;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return undefined;
};

const itemFromRow = (row: Record<string, any>) => ({
  author: { avatar: null, name: row.owner_name || row.owner_email || 'Masterino' },
  avatar: row.avatar,
  category: row.category,
  config: row.config || {},
  createdAt: row.created_at,
  description: row.description,
  editorData: row.editor_data || {},
  favoriteCount: asNumber(row.favorite_count || 0),
  forksCount: asNumber(row.forks_count || 0),
  identifier: row.identifier,
  id: asNumber(row.id),
  installCount: asNumber(row.install_count || 0),
  isFeatured: Boolean(row.metadata?.isFeatured),
  isOfficial: Boolean(row.metadata?.isOfficial),
  likeCount: asNumber(row.like_count || 0),
  manifest: row.manifest || {},
  metadata: row.metadata || {},
  name: row.name,
  ownerId: asNumber(row.owner_account_id),
  status: row.status,
  tags: row.tags || [],
  updatedAt: row.updated_at,
  version: row.version,
  visibility: row.visibility,
  workflowState: row.workflow_state,
});

export class MarketRepository {
  constructor(private readonly pool: MarketPool) {}

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async syncAccount(actor: TrustedClientPayload, adminIds: Set<string>): Promise<Account> {
    const requestedRole = adminIds.has(actor.userId) ? 'admin' : 'submitter';
    const result = await this.pool.query(
      `INSERT INTO market_accounts(external_user_id, email, name, role)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (external_user_id) DO UPDATE SET
         email=excluded.email, name=excluded.name,
         role=CASE WHEN excluded.role='admin' THEN 'admin' ELSE market_accounts.role END,
         updated_at=now()
       RETURNING *`,
      [actor.userId, actor.email || null, actor.name || null, requestedRole],
    );
    const row = result.rows[0];
    return {
      email: row.email,
      externalUserId: row.external_user_id,
      id: asNumber(row.id),
      name: row.name,
      role: row.role,
    };
  }

  async list(type: ResourceType, options: ListOptions, account: Account, workspaceId?: string) {
    const page = Math.max(1, Number(options.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 20));
    const values: unknown[] = [type, account.id, workspaceId || null];
    const filters = [
      `r.type=$1`,
      `(r.status='published' OR r.owner_account_id=$2 OR ($3::text IS NOT NULL AND r.workspace_id=$3))`,
    ];
    if (options.publishedOriginalsOnly) {
      filters.push(`r.status='published'`, 'r.forked_from_id IS NULL');
    }
    if (options.identifiers) {
      values.push(options.identifiers);
      filters.push(`r.identifier=ANY($${values.length}::text[])`);
    }
    if (options.category && options.category !== 'all') {
      values.push(options.category);
      filters.push(`r.category=$${values.length}`);
    }
    if (options.q) {
      values.push(`%${options.q}%`);
      filters.push(
        `(r.name ILIKE $${values.length} OR r.description ILIKE $${values.length} OR r.identifier ILIKE $${values.length})`,
      );
    }
    values.push(pageSize, (page - 1) * pageSize);
    const order =
      options.sort === 'installCount' || options.sort === 'mostUsage'
        ? 'r.install_count DESC'
        : options.sort === 'likes'
          ? 'r.like_count DESC'
          : options.sort === 'recommended'
            ? `(r.metadata->>'isOfficial' = 'true') DESC,
               (r.metadata->>'isFeatured' = 'true') DESC,
               CASE WHEN r.metadata->>'curatedRank' ~ '^[0-9]+$'
                 THEN (r.metadata->>'curatedRank')::int ELSE 2147483647 END ASC`
            : 'r.updated_at DESC';
    const result = await this.pool.query(
      `SELECT r.*, v.version, v.workflow_state, v.config, v.editor_data, v.manifest,
        a.name owner_name, a.email owner_email,
        (SELECT count(*) FROM market_resources f WHERE f.forked_from_id=r.id AND f.status='published') forks_count,
        count(*) OVER() total_count
       FROM market_resources r
       LEFT JOIN market_versions v ON v.id=r.current_version_id
       JOIN market_accounts a ON a.id=r.owner_account_id
       WHERE ${filters.join(' AND ')} ORDER BY ${order}, r.id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    const totalCount = asNumber(result.rows[0]?.total_count || 0);
    return {
      currentPage: page,
      items: result.rows.map(itemFromRow),
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
    };
  }

  async detail(
    type: ResourceType,
    identifier: string,
    account: Account,
    workspaceId?: string,
    version?: string,
  ) {
    const values: unknown[] = [type, identifier, account.id, workspaceId || null];
    const versionJoin = version
      ? `JOIN market_versions v ON v.resource_id=r.id AND v.version=$5`
      : 'LEFT JOIN market_versions v ON v.id=r.current_version_id';
    if (version) values.push(version);
    const result = await this.pool.query(
      `SELECT r.*, v.version, v.workflow_state, v.config, v.editor_data, v.manifest,
        v.localizations, v.changelog, v.scan_result,
        a.name owner_name, a.email owner_email,
        (SELECT count(*) FROM market_resources f WHERE f.forked_from_id=r.id AND f.status='published') forks_count
       FROM market_resources r ${versionJoin}
       JOIN market_accounts a ON a.id=r.owner_account_id
       WHERE r.type=$1 AND r.identifier=$2
         AND (r.status='published' OR r.owner_account_id=$3 OR ($4::text IS NOT NULL AND r.workspace_id=$4))`,
      values,
    );
    if (!result.rowCount) return null;
    return itemFromRow(result.rows[0]);
  }

  async categories(type: ResourceType) {
    const result = await this.pool.query(
      `SELECT category, category AS key, category AS name, count(*)::int AS count
       FROM market_resources WHERE type=$1 AND status='published' AND category IS NOT NULL
       GROUP BY category ORDER BY count(*) DESC, category`,
      [type],
    );
    return result.rows;
  }

  async createResource(
    type: ResourceType,
    data: Record<string, any>,
    account: Account,
    workspaceId?: string,
  ) {
    const result = await this.pool.query(
      `INSERT INTO market_resources(type, identifier, owner_account_id, workspace_id, name, description, avatar, category, tags, visibility, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'internal',$10)
       ON CONFLICT(type, identifier) DO NOTHING RETURNING *`,
      [
        type,
        data.identifier,
        account.id,
        workspaceId || null,
        data.name || data.identifier,
        data.description || null,
        data.avatar || null,
        data.category || null,
        JSON.stringify(data.tags || []),
        JSON.stringify(data.metadata || {}),
      ],
    );
    if (!result.rowCount) throw new Error(`Resource already exists: ${data.identifier}`);
    await this.audit(account, workspaceId, 'resource.create', type, data.identifier, {
      name: data.name,
    });
    return {
      id: asNumber(result.rows[0].id),
      identifier: data.identifier,
      status: result.rows[0].status,
    };
  }

  async createVersion(
    type: ResourceType,
    data: Record<string, any>,
    account: Account,
    workspaceId?: string,
  ) {
    const resource = await this.pool.query(
      `SELECT * FROM market_resources WHERE type=$1 AND identifier=$2 AND owner_account_id=$3`,
      [type, data.identifier, account.id],
    );
    if (!resource.rowCount) throw new Error('Resource not found or not owned by caller');
    const resourceId = resource.rows[0].id;
    let version = versionFrom(data);
    if (!version) {
      const count = await this.pool.query(
        'SELECT count(*)::int AS count FROM market_versions WHERE resource_id=$1',
        [resourceId],
      );
      version = `1.0.${count.rows[0].count}`;
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO market_versions(resource_id, version, config, editor_data, manifest, localizations, changelog, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          resourceId,
          version,
          JSON.stringify(data.config || {}),
          JSON.stringify(data.editorData || {}),
          JSON.stringify(data.manifest || {}),
          JSON.stringify(data.localizations || {}),
          data.changelog || null,
          account.id,
        ],
      );
      await client.query(
        `UPDATE market_resources SET current_version_id=$1, name=coalesce($2,name), description=coalesce($3,description),
          avatar=coalesce($4,avatar), category=coalesce($5,category), tags=coalesce($6,tags), updated_at=now() WHERE id=$7`,
        [
          inserted.rows[0].id,
          data.name || null,
          data.description || null,
          data.avatar || null,
          data.category || null,
          data.tags ? JSON.stringify(data.tags) : null,
          resourceId,
        ],
      );
      await client.query('COMMIT');
      await this.audit(account, workspaceId, 'version.create', type, data.identifier, { version });
      return {
        id: asNumber(inserted.rows[0].id),
        identifier: data.identifier,
        version,
        workflowState: 'draft',
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateResource(
    type: ResourceType,
    data: Record<string, any>,
    account: Account,
    workspaceId?: string,
  ) {
    if (data.status)
      return this.requestStatus(type, data.identifier, data.status, account, workspaceId);
    const result = await this.pool.query(
      `UPDATE market_resources SET name=coalesce($1,name), description=coalesce($2,description), avatar=coalesce($3,avatar),
       category=coalesce($4,category), tags=coalesce($5,tags), updated_at=now()
       WHERE type=$6 AND identifier=$7 AND owner_account_id=$8 RETURNING *`,
      [
        data.name || null,
        data.description || null,
        data.avatar || null,
        data.category || null,
        data.tags ? JSON.stringify(data.tags) : null,
        type,
        data.identifier,
        account.id,
      ],
    );
    if (!result.rowCount) throw new Error('Resource not found or not owned by caller');
    await this.audit(account, workspaceId, 'resource.update', type, data.identifier, {});
    return { identifier: data.identifier, status: result.rows[0].status };
  }

  async requestStatus(
    type: ResourceType,
    identifier: string,
    status: string,
    account: Account,
    workspaceId?: string,
  ) {
    const resource = await this.pool.query(
      `SELECT r.*, v.workflow_state FROM market_resources r LEFT JOIN market_versions v ON v.id=r.current_version_id
       WHERE r.type=$1 AND r.identifier=$2 AND r.owner_account_id=$3`,
      [type, identifier, account.id],
    );
    if (!resource.rowCount) throw new Error('Resource not found or not owned by caller');
    if (status === 'published') {
      await this.pool.query(
        `UPDATE market_versions SET workflow_state='submitted', submitted_at=now() WHERE id=$1 AND workflow_state IN ('draft','rejected')`,
        [resource.rows[0].current_version_id],
      );
      await this.audit(account, workspaceId, 'review.submit', type, identifier, {});
      return { identifier, status: 'review', success: true };
    }
    if (!['unpublished', 'archived', 'deprecated'].includes(status))
      throw new Error('Unsupported status');
    await this.pool.query(`UPDATE market_resources SET status=$1, updated_at=now() WHERE id=$2`, [
      status,
      resource.rows[0].id,
    ]);
    if (status === 'deprecated')
      await this.pool.query(`UPDATE market_versions SET workflow_state='deprecated' WHERE id=$1`, [
        resource.rows[0].current_version_id,
      ]);
    await this.audit(account, workspaceId, `resource.${status}`, type, identifier, {});
    return { identifier, status, success: true };
  }

  async review(
    type: ResourceType,
    identifier: string,
    action: string,
    reason: string | undefined,
    reviewer: Account,
    scanResult?: Record<string, unknown>,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const resource = await client.query(
        `SELECT r.*, v.workflow_state FROM market_resources r JOIN market_versions v ON v.id=r.current_version_id
         WHERE r.type=$1 AND r.identifier=$2 FOR UPDATE`,
        [type, identifier],
      );
      if (!resource.rowCount) throw new Error('Resource not found');
      const transitions: Record<string, { from: string[]; to: WorkflowState }> = {
        'approve': { from: ['in_review'], to: 'approved' },
        'deprecate': { from: ['published'], to: 'deprecated' },
        'publish': { from: ['approved'], to: 'published' },
        'reject': { from: ['in_review'], to: 'rejected' },
        'scan-failed': { from: ['scanning'], to: 'rejected' },
        'scan-passed': { from: ['scanning'], to: 'in_review' },
        'scan-start': { from: ['submitted'], to: 'scanning' },
        'submit': { from: ['draft', 'rejected'], to: 'submitted' },
      };
      const transition = transitions[action];
      if (!transition || !transition.from.includes(resource.rows[0].workflow_state)) {
        throw new Error(
          `Invalid workflow transition: ${resource.rows[0].workflow_state} -> ${action}`,
        );
      }
      const effectiveScanResult =
        scanResult ||
        (action === 'scan-passed'
          ? { checkedAt: new Date().toISOString(), source: 'manual', status: 'passed' }
          : action === 'scan-failed'
            ? { checkedAt: new Date().toISOString(), source: 'manual', status: 'failed' }
            : null);
      await client.query(
        `UPDATE market_versions SET workflow_state=$1, review_reason=$2, reviewer_account_id=$3,
          scan_result=CASE WHEN $5::jsonb IS NOT NULL THEN $5 ELSE scan_result END,
          reviewed_at=CASE WHEN $1 IN ('approved','rejected') THEN now() ELSE reviewed_at END,
          submitted_at=CASE WHEN $1='submitted' THEN now() ELSE submitted_at END
         WHERE id=$4`,
        [
          transition.to,
          reason || null,
          reviewer.id,
          resource.rows[0].current_version_id,
          effectiveScanResult ? JSON.stringify(effectiveScanResult) : null,
        ],
      );
      if (transition.to === 'published')
        await client.query(
          `UPDATE market_resources SET status='published', updated_at=now() WHERE id=$1`,
          [resource.rows[0].id],
        );
      if (transition.to === 'deprecated')
        await client.query(
          `UPDATE market_resources SET status='deprecated', updated_at=now() WHERE id=$1`,
          [resource.rows[0].id],
        );
      await client.query('COMMIT');
      await this.audit(reviewer, undefined, `review.${action}`, type, identifier, { reason });
      return { identifier, success: true, workflowState: transition.to };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async fork(
    type: ResourceType,
    sourceIdentifier: string,
    data: Record<string, any>,
    account: Account,
    workspaceId?: string,
  ) {
    const source = await this.pool.query(
      `SELECT r.id AS source_resource_id, r.identifier AS source_identifier, r.name AS source_name,
        r.description, r.avatar, r.category, r.tags, r.metadata, v.id AS source_version_id,
        v.version AS source_version, v.config, v.editor_data, v.manifest
       FROM market_resources r JOIN market_versions v ON v.id=r.current_version_id
       WHERE r.type=$1 AND r.identifier=$2 AND r.status='published'`,
      [type, sourceIdentifier],
    );
    if (!source.rowCount) throw new Error('Published source not found');
    const prior = await this.pool.query(
      `SELECT fork.identifier FROM market_forks f JOIN market_resources fork ON fork.id=f.fork_resource_id
       WHERE f.account_id=$1 AND f.workspace_id IS NOT DISTINCT FROM $2 AND f.source_resource_id=$3 AND f.source_version_id=$4`,
      [
        account.id,
        workspaceId || null,
        source.rows[0].source_resource_id,
        source.rows[0].source_version_id,
      ],
    );
    if (prior.rowCount) {
      const existing = await this.detail(type, prior.rows[0].identifier, account, workspaceId);
      if (type === 'agent')
        return {
          agent: {
            createdAt: (existing as any)?.createdAt,
            forkedFromAgentId: asNumber(source.rows[0].source_resource_id),
            id: (existing as any)?.id,
            identifier: (existing as any)?.identifier,
            name: (existing as any)?.name,
            ownerId: account.id,
            updatedAt: (existing as any)?.updatedAt,
          },
          source: {
            agentId: asNumber(source.rows[0].source_resource_id),
            identifier: sourceIdentifier,
            versionNumber: Number.parseInt(source.rows[0].source_version, 10) || 1,
          },
          version: {
            agentId: (existing as any)?.id,
            createdAt: (existing as any)?.createdAt,
            id: (existing as any)?.id,
            versionNumber: 1,
          },
        };
      return { agent: existing, idempotent: true, sourceIdentifier, success: true };
    }
    const created = await this.createResource(
      type,
      { ...source.rows[0], ...data },
      account,
      workspaceId,
    );
    await this.pool.query(`UPDATE market_resources SET forked_from_id=$1 WHERE id=$2`, [
      source.rows[0].source_resource_id,
      created.id,
    ]);
    const createdVersion = await this.createVersion(
      type,
      {
        ...data,
        config: source.rows[0].config,
        editorData: source.rows[0].editor_data,
        identifier: data.identifier,
        manifest: source.rows[0].manifest,
        version: '1.0.0',
      },
      account,
      workspaceId,
    );
    await this.pool.query(
      `INSERT INTO market_forks(account_id,workspace_id,source_resource_id,source_version_id,fork_resource_id)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT(account_id, coalesce(workspace_id, ''), source_resource_id, source_version_id) DO NOTHING`,
      [
        account.id,
        workspaceId || null,
        source.rows[0].source_resource_id,
        source.rows[0].source_version_id,
        created.id,
      ],
    );
    const agent = await this.detail(type, data.identifier, account, workspaceId);
    if (type === 'agent') {
      return {
        agent: {
          createdAt: (agent as any).createdAt,
          forkedFromAgentId: asNumber(source.rows[0].source_resource_id),
          id: created.id,
          identifier: data.identifier,
          name: (agent as any).name,
          ownerId: account.id,
          updatedAt: (agent as any).updatedAt,
        },
        source: {
          agentId: asNumber(source.rows[0].source_resource_id),
          identifier: sourceIdentifier,
          versionNumber: Number.parseInt(source.rows[0].source_version, 10) || 1,
        },
        version: {
          agentId: created.id,
          createdAt: new Date().toISOString(),
          id: createdVersion.id,
          versionNumber: 1,
        },
      };
    }
    return { agent, sourceIdentifier, success: true, version: createdVersion };
  }

  async forks(type: ResourceType, identifier: string) {
    const result = await this.pool.query(
      `SELECT f.*, v.version, v.workflow_state, v.config, v.editor_data, v.manifest, a.name owner_name, a.email owner_email
       FROM market_resources src JOIN market_resources f ON f.forked_from_id=src.id
       LEFT JOIN market_versions v ON v.id=f.current_version_id JOIN market_accounts a ON a.id=f.owner_account_id
       WHERE src.type=$1 AND src.identifier=$2 AND f.status='published'`,
      [type, identifier],
    );
    return { forks: result.rows.map(itemFromRow), totalCount: result.rowCount || 0 };
  }

  async forkSource(type: ResourceType, identifier: string) {
    const result = await this.pool.query(
      `SELECT src.*, v.version, v.workflow_state, v.config, v.editor_data, v.manifest, a.name owner_name, a.email owner_email
       FROM market_resources f JOIN market_resources src ON src.id=f.forked_from_id
       LEFT JOIN market_versions v ON v.id=src.current_version_id JOIN market_accounts a ON a.id=src.owner_account_id
       WHERE f.type=$1 AND f.identifier=$2`,
      [type, identifier],
    );
    return { source: result.rowCount ? itemFromRow(result.rows[0]) : null };
  }

  async install(
    identifier: string,
    account: Account,
    workspaceId?: string,
    localResourceId?: string,
  ) {
    const result = await this.pool.query(
      `INSERT INTO market_installs(account_id, workspace_id, resource_id, version_id, local_resource_id)
       SELECT $1,$2,r.id,r.current_version_id,$3 FROM market_resources r JOIN market_versions v ON v.id=r.current_version_id
       WHERE r.identifier=$4 AND r.status='published' AND v.workflow_state='published'
       ON CONFLICT(account_id, coalesce(workspace_id, ''), resource_id, version_id)
       DO UPDATE SET local_resource_id=coalesce(excluded.local_resource_id, market_installs.local_resource_id), updated_at=now()
       RETURNING id, (xmax=0) AS inserted`,
      [account.id, workspaceId || null, localResourceId || null, identifier],
    );
    if (!result.rowCount) throw new Error('Approved published version not found');
    if (result.rows[0].inserted)
      await this.pool.query(
        `UPDATE market_resources SET install_count=install_count+1 WHERE identifier=$1`,
        [identifier],
      );
    return { id: asNumber(result.rows[0].id), identifier, success: true };
  }

  async social(
    relation: 'follow' | 'favorite' | 'like',
    action: 'add' | 'remove' | 'toggle' | 'check',
    targetType: string,
    targetValue: string,
    account: Account,
  ) {
    const exists = await this.pool.query(
      `SELECT 1 FROM market_social WHERE account_id=$1 AND relation=$2 AND target_type=$3 AND target_value=$4`,
      [account.id, relation, targetType, targetValue],
    );
    const shouldAdd = action === 'add' || (action === 'toggle' && !exists.rowCount);
    if (shouldAdd)
      await this.pool.query(
        `INSERT INTO market_social(account_id,relation,target_type,target_value) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [account.id, relation, targetType, targetValue],
      );
    if (action === 'remove' || (action === 'toggle' && exists.rowCount))
      await this.pool.query(
        `DELETE FROM market_social WHERE account_id=$1 AND relation=$2 AND target_type=$3 AND target_value=$4`,
        [account.id, relation, targetType, targetValue],
      );
    const active = action === 'check' ? Boolean(exists.rowCount) : shouldAdd;
    if (action !== 'check' && ['favorite', 'like'].includes(relation)) {
      const column = relation === 'favorite' ? 'favorite_count' : 'like_count';
      await this.pool.query(
        `UPDATE market_resources r SET ${column}=(SELECT count(*)::int FROM market_social s WHERE s.relation=$1 AND s.target_value=r.identifier) WHERE r.identifier=$2`,
        [relation, targetValue],
      );
    }
    if (relation === 'follow') {
      const mutual =
        active &&
        Boolean(
          (
            await this.pool.query(
              `SELECT 1 FROM market_social WHERE account_id=$1 AND relation='follow' AND target_type='user' AND target_value=$2`,
              [Number(targetValue), String(account.id)],
            )
          ).rowCount,
        );
      return { isFollowing: active, isMutual: mutual, success: true };
    }
    return relation === 'favorite'
      ? { isFavorited: active, success: true }
      : { isLiked: active, liked: active, success: true };
  }

  async listSocial(relation: string, accountId: number, targetType?: string) {
    const values: unknown[] = [accountId, relation];
    const typeFilter = targetType ? (values.push(targetType), `AND target_type=$3`) : '';
    const result = await this.pool.query(
      `SELECT target_type AS "targetType", target_value AS "targetValue", created_at AS "createdAt" FROM market_social WHERE account_id=$1 AND relation=$2 ${typeFilter} ORDER BY created_at DESC`,
      values,
    );
    return { data: result.rows, totalCount: result.rowCount || 0 };
  }

  async listFollowers(accountId: number) {
    const result = await this.pool.query(
      `SELECT a.id, a.name AS "displayName", a.external_user_id AS "userName", null::text AS "avatarUrl", s.created_at AS "createdAt"
       FROM market_social s JOIN market_accounts a ON a.id=s.account_id
       WHERE s.relation='follow' AND s.target_type='user' AND s.target_value=$1 ORDER BY s.created_at DESC`,
      [String(accountId)],
    );
    return { data: result.rows, totalCount: result.rowCount || 0 };
  }

  async listFollowing(accountId: number) {
    const result = await this.pool.query(
      `SELECT a.id, a.name AS "displayName", a.external_user_id AS "userName", null::text AS "avatarUrl", s.created_at AS "createdAt"
       FROM market_social s JOIN market_accounts a ON a.id::text=s.target_value
       WHERE s.relation='follow' AND s.target_type='user' AND s.account_id=$1 ORDER BY s.created_at DESC`,
      [accountId],
    );
    return { data: result.rows, totalCount: result.rowCount || 0 };
  }

  async audit(
    account: Account,
    workspaceId: string | undefined,
    action: string,
    targetType?: string,
    targetId?: string,
    details: unknown = {},
  ) {
    await this.pool.query(
      `INSERT INTO market_audit_logs(actor_account_id, workspace_id, action, target_type, target_id, details) VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        account.id,
        workspaceId || null,
        action,
        targetType || null,
        targetId || null,
        JSON.stringify(details),
      ],
    );
  }

  getPool() {
    return this.pool;
  }
}
