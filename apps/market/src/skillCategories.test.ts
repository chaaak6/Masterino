import { describe, expect, it, vi } from 'vitest';

import { MarketRepository } from './repository.js';

const account = { id: 7, externalUserId: 'author', role: 'admin' as const };

describe('Skill category rules', () => {
  it('counts empty/legacy categories and shares visibility and search conditions with the list', async () => {
    const query = vi.fn(async (sql: string, _values?: unknown[]) => {
      if (sql.includes('FROM market_categories'))
        return {
          rows: [
            { slug: 'design', sort_order: 10, localizations: { 'zh-CN': { name: '图解与设计' } } },
          ],
        };
      if (sql.includes('GROUP BY'))
        return {
          rows: [
            { category: null, count: 1 },
            { category: 'design', count: 2 },
            { category: 'legacy', count: 1 },
          ],
        };
      return { rows: [] };
    });
    const repo = new MarketRepository({ query } as any);
    expect(
      await repo.skillCategorySummary({ q: 'QA', category: 'design' }, account, 'workspace-a'),
    ).toMatchObject({
      allCount: 4,
      uncategorizedCount: 1,
      categories: [
        { category: 'design', name: '图解与设计', count: 2 },
        { category: 'legacy', name: 'legacy', count: 1, registered: false },
      ],
    });
    const summary = query.mock.calls.find(([sql]) => sql.includes('GROUP BY'))!;
    await repo.list('skill', { q: 'QA' }, account, 'workspace-a');
    const list = query.mock.calls.at(-1)!;
    expect(summary[1]).toEqual(['skill', 7, 'workspace-a', '%QA%']);
    expect(list[1]?.slice(0, 4)).toEqual(summary[1]);
    const where = (sql: string, end: string) =>
      sql.slice(sql.indexOf('WHERE r.type'), sql.indexOf(end, sql.indexOf('WHERE r.type')));
    expect(where(summary[0], ' GROUP BY')).toBe(where(list[0], ' ORDER BY'));
  });

  it('retains zero-count definitions for selectors and supports uncategorized filtering', async () => {
    const query = vi.fn(async (sql: string, _values?: unknown[]) => ({
      rows: sql.includes('FROM market_categories')
        ? [{ slug: 'design', sort_order: 10, localizations: { 'en-US': { name: 'Design' } } }]
        : [],
    }));
    const repo = new MarketRepository({ query } as any);
    expect(await repo.skillCategorySummary({ locale: 'en-US' }, account)).toMatchObject({
      allCount: 0,
      uncategorizedCount: 0,
      categories: [{ name: 'Design', count: 0 }],
    });
    await repo.list('skill', { category: 'uncategorized' }, account);
    expect(query.mock.calls.at(-1)?.[0]).toContain("NULLIF(BTRIM(r.category),'') IS NULL");
  });

  it('refuses publication without a category before writing workflow state', async () => {
    const query = vi.fn(async (sql: string, _values?: unknown[]) => ({
      rowCount: 1,
      rows: sql.includes('review_version_id')
        ? [{ id: 1, review_version_id: 3, workflow_state: 'approved', category: null }]
        : [],
    }));
    const repo = new MarketRepository({
      connect: async () => ({ query, release: vi.fn() }),
    } as any);
    await expect(
      repo.review('skill', 'QA', 'publish', undefined, account, undefined, { versionId: 3 }),
    ).rejects.toThrow('发布前请选择技能分类');
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE market_versions'))).toBe(false);
  });

  it('publishes the reviewer-selected category together with the selected version', async () => {
    const query = vi.fn(async (sql: string, _values?: unknown[]) => ({
      rowCount: 1,
      rows: sql.includes('review_version_id')
        ? [
            {
              id: 1,
              current_version_id: 2,
              review_version_id: 3,
              workflow_state: 'approved',
              category: 'design',
              review_editor_data: { catalogCategory: 'design' },
            },
          ]
        : [],
    }));
    const repo = new MarketRepository({
      connect: async () => ({ query, release: vi.fn() }),
      query,
    } as any);
    await repo.review(
      'skill',
      'QA',
      'publish',
      undefined,
      account,
      undefined,
      { versionId: 3 },
      'data-analytics',
    );
    expect(
      query.mock.calls.find(([sql]) => sql.includes('UPDATE market_resources r'))?.[1],
    ).toEqual([1, 3, 'data-analytics']);
  });
});
