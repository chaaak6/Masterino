// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MarketPage from './MarketPage';

afterEach(cleanup);

vi.mock('../components/SkillCategorySelect', () => ({ default: () => null }));

const state = vi.hoisted(() => ({
  categories: {} as {
    data?: { items: Array<{ resource_type: string; slug: string }> };
    error?: Error;
    isLoading?: boolean;
    isSuccess?: boolean;
  },
  review: vi.fn(),
}));

vi.mock('@admin/lib/trpc', () => {
  const emptyQuery = { useQuery: () => ({}) };
  const emptyMutation = { useMutation: () => ({}) };
  return {
    trpc: {
      admin: {
        importMarketPackage: emptyMutation,
        listCatalogResources: emptyQuery,
        listMarketAccounts: emptyQuery,
        listMarketAudit: emptyQuery,
        listMarketCategories: { useQuery: () => state.categories },
        listMarketConnectorAllowlist: emptyQuery,
        listMarketReviews: {
          useQuery: () => ({
            data: {
              items: [
                {
                  category: 'design',
                  identifier: 'test-skill',
                  name: 'Test Skill',
                  type: 'skill',
                  version: '1.0.0',
                  versionId: 7,
                  workflowState: 'approved',
                },
              ],
              totalCount: 1,
            },
          }),
        },
        reviewMarketResource: { useMutation: () => ({ mutate: state.review }) },
        rollbackMarketResource: emptyMutation,
        updateMarketAccountRole: emptyMutation,
        updateMarketConnectorAllowlist: emptyMutation,
        upsertMarketCategory: emptyMutation,
        upsertMarketConnectorAllowlist: emptyMutation,
      },
      useUtils: () => ({}),
    },
  };
});

const openReviewTab = () => {
  render(<MarketPage />);
  fireEvent.click(screen.getByRole('tab', { name: /投稿审核/ }));
  return screen.getByRole('button', { name: /^发\s*布$/ });
};

describe('Market skill publication', () => {
  beforeEach(() => {
    state.review.mockClear();
  });

  it.each([{ isLoading: true }, { error: new Error('Categories unavailable') }])(
    'allows Market to validate an approved skill while the category query is unsettled',
    (query) => {
      state.categories = query;
      const publish = openReviewTab();
      expect(publish.hasAttribute('disabled')).toBe(false);
      expect(screen.queryByText('发布前请选择有效技能分类')).toBeNull();
      fireEvent.click(publish);
      expect(state.review).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'publish', category: 'design', versionId: 7 }),
      );
    },
  );

  it('blocks publication when the loaded registry lacks the skill category', () => {
    state.categories = {
      data: { items: [{ resource_type: 'agent', slug: 'design' }] },
      isSuccess: true,
    };
    const publish = openReviewTab();
    expect(publish.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('发布前请选择有效技能分类')).toBeTruthy();
  });
});
