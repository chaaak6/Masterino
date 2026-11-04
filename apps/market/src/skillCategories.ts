import type { ResourceType } from './contracts.js';
import type { MarketPool } from './db.js';

interface FilterOptions {
  category?: string;
  identifiers?: readonly string[];
  publishedOriginalsOnly?: boolean;
  q?: string;
}

export const resourceFilters = (
  type: ResourceType,
  options: FilterOptions,
  account: { id: number },
  workspaceId?: string,
) => {
  const values: unknown[] = [type, account.id, workspaceId || null];
  const filters = [
    `r.type=$1`,
    `(r.status='published' OR r.owner_account_id=$2 OR ($3::text IS NOT NULL AND r.workspace_id=$3))`,
  ];
  if (options.publishedOriginalsOnly)
    filters.push(`r.status='published'`, 'r.forked_from_id IS NULL');
  if (options.identifiers) {
    values.push(options.identifiers);
    filters.push(`r.identifier=ANY($${values.length}::text[])`);
  }
  if (options.category === 'uncategorized') filters.push(`NULLIF(BTRIM(r.category),'') IS NULL`);
  else if (options.category && options.category !== 'all') {
    values.push(options.category);
    filters.push(`NULLIF(BTRIM(r.category),'')=$${values.length}`);
  }
  if (options.q) {
    values.push(`%${options.q.replaceAll(/[!%_]/g, '!$&')}%`);
    filters.push(
      `(r.name ILIKE $${values.length} ESCAPE '!' OR r.description ILIKE $${values.length} ESCAPE '!' OR r.identifier ILIKE $${values.length} ESCAPE '!')`,
    );
  }
  return { values, filters };
};

export async function readSkillCategorySummary(
  pool: MarketPool,
  conditions: { values: unknown[]; filters: string[] },
  locale = 'zh-CN',
) {
  const { values, filters } = conditions;
  const [counts, dictionary] = await Promise.all([
    pool.query(
      `SELECT NULLIF(BTRIM(r.category),'') AS category, count(*)::int AS count
        FROM market_resources r WHERE ${filters.join(' AND ')} GROUP BY NULLIF(BTRIM(r.category),'')`,
      values,
    ),
    pool.query(
      `SELECT slug, sort_order, localizations FROM market_categories WHERE resource_type='skill' ORDER BY sort_order,slug`,
    ),
  ]);
  const byCategory = new Map<string, number>(
    counts.rows.filter((r) => r.category).map((r) => [r.category, Number(r.count)]),
  );
  const categories = dictionary.rows.map((row) => {
    const text =
      row.localizations?.[locale] ??
      (locale.startsWith('zh') ? row.localizations?.['zh-CN'] : undefined) ??
      row.localizations?.['en-US'] ??
      row.localizations?.['zh-CN'] ??
      {};
    const count = byCategory.get(row.slug) ?? 0;
    byCategory.delete(row.slug);
    return {
      category: row.slug as string,
      key: row.slug as string,
      name: text.name || row.slug,
      description: text.description || '',
      sortOrder: Number(row.sort_order),
      count,
      registered: true,
    };
  });
  for (const [category, count] of byCategory)
    categories.push({
      category,
      key: category,
      name: category,
      description: '',
      sortOrder: 999,
      count,
      registered: false,
    });
  return {
    allCount: counts.rows.reduce((sum, row) => sum + Number(row.count), 0),
    uncategorizedCount: Number(counts.rows.find((r) => r.category === null)?.count || 0),
    categories,
  };
}
