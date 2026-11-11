import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Category from '@/routes/(main)/community/(list)/skill/features/Category';
import type { SkillCategorySummary } from '@/types/discover';

import discover from '../../locales/en-US/discover.json';
import { useSkillCategoryItem } from './useSkillCategory';

const state = vi.hoisted(() => ({
  mutate: vi.fn(),
  summary: {} as { data?: SkillCategorySummary; error?: Error },
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: () => ({ ...state.summary, mutate: state.mutate }),
}));
vi.mock('@/libs/trpc/client', () => ({ lambdaClient: {} }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: keyof typeof discover, options?: { defaultValue?: string }) =>
      discover[key] ?? options?.defaultValue ?? key,
  }),
}));

describe('skill category presentation', () => {
  beforeEach(() => {
    state.mutate.mockClear();
    state.summary = {};
  });

  it('shows the localized skill category while the summary is loading or unavailable', () => {
    const { result, rerender } = renderHook(() => useSkillCategoryItem('coding-agents-ides'));
    expect(result.current).toMatchObject({
      key: 'coding-agents-ides',
      label: 'Coding Agents & IDEs',
    });
    state.summary = { error: new Error('Summary unavailable') };
    rerender();
    expect(result.current).toMatchObject({
      key: 'coding-agents-ides',
      label: 'Coding Agents & IDEs',
    });
  });

  it('distinguishes a missing category from a nonempty unknown category', () => {
    let category: string | undefined = 'unknown-category';
    const { result, rerender } = renderHook(() => useSkillCategoryItem(category));
    expect(result.current).toBeUndefined();
    category = undefined;
    rerender();
    expect(result.current).toMatchObject({ key: 'uncategorized', label: 'Uncategorized' });
  });

  it('uses the registered localized name after the summary arrives', () => {
    const { result, rerender } = renderHook(() => useSkillCategoryItem('design'));
    expect(result.current).toMatchObject({ label: 'Diagrams & Design' });
    state.summary = {
      data: {
        allCount: 1,
        categories: [
          {
            category: 'design',
            count: 1,
            description: 'Updated description',
            key: 'design',
            locale: 'en-US',
            name: 'Updated name',
            registered: true,
            sortOrder: 50,
          },
        ],
        uncategorizedCount: 0,
      },
    };
    rerender();
    expect(result.current).toMatchObject({ label: 'Updated name', title: 'Updated description' });
  });

  it('keeps category navigation and a retry action available after a summary failure', () => {
    state.summary = { error: new Error('Summary unavailable') };
    render(
      <MemoryRouter>
        <Category />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Coding Agents & IDEs' }).getAttribute('href')).toBe(
      '/community/skill?category=coding-agents-ides',
    );
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect(state.mutate).toHaveBeenCalledOnce();
  });
});
