import { describe, expect, it, vi } from 'vitest';

import { MarketRepository } from './repository.js';

const account = { externalUserId: 'user-1', id: 1, role: 'admin' as const };

describe('MarketRepository invariants', () => {
  it('keeps repeated installs idempotent without inflating install count', async () => {
    const query = vi.fn(async (..._args: any[]) => ({
      rowCount: 1,
      rows: [{ id: 9, inserted: false }],
    }));
    const repository = new MarketRepository({ query } as any);

    await expect(repository.install('assistant', account, 'workspace-1')).resolves.toMatchObject({
      id: 9,
      success: true,
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual([1, 'workspace-1', null, 'assistant']);
  });

  it('enforces the submitted to scanning workflow transition', async () => {
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ current_version_id: 3, id: 2, workflow_state: 'submitted' }],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const client = { query: clientQuery, release: vi.fn() };
    const pool = {
      connect: vi.fn(async () => client),
      query: vi.fn(async () => ({ rowCount: 1, rows: [] })),
    };
    const repository = new MarketRepository(pool as any);

    await expect(
      repository.review('agent', 'assistant', 'scan-start', undefined, account),
    ).resolves.toMatchObject({ workflowState: 'scanning' });

    expect(clientQuery.mock.calls[2][1][0]).toBe('scanning');
    expect(clientQuery).toHaveBeenLastCalledWith('COMMIT');
  });
});

describe('onboarding catalog visibility', () => {
  it.each([1, 7])('filters originals before pagination for account %s', async (id) => {
    const query = vi.fn(async (..._args: any[]) => ({ rows: [] }));
    const repository = new MarketRepository({ query } as any);
    await repository.list(
      'agent',
      { pageSize: 100, publishedOriginalsOnly: true },
      { ...account, id },
    );
    const sql = query.mock.calls[0][0];
    expect(sql).toContain("AND r.status='published' AND r.forked_from_id IS NULL");
    expect(sql.indexOf('r.forked_from_id IS NULL')).toBeLessThan(sql.indexOf('LIMIT'));
  });

  it('applies the onboarding identifier allowlist before pagination', async () => {
    const query = vi.fn(async (..._args: any[]) => ({ rows: [] }));
    const repository = new MarketRepository({ query } as any);
    await repository.list('agent', { identifiers: ['assistant-a', 'assistant-b'] }, account);

    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain('r.identifier=ANY($4::text[])');
    expect(sql.indexOf('r.identifier=ANY')).toBeLessThan(sql.indexOf('LIMIT'));
    expect(values[3]).toEqual(['assistant-a', 'assistant-b']);
  });

  it('preserves personal drafts and forks in ordinary lists', async () => {
    const query = vi.fn(async (..._args: any[]) => ({ rows: [] }));
    const repository = new MarketRepository({ query } as any);
    await repository.list('agent', {}, account);
    expect(query.mock.calls[0][0]).not.toContain('r.forked_from_id IS NULL');
    expect(query.mock.calls[0][0]).toContain('r.owner_account_id=$2');
  });
});
