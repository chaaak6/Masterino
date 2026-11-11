import type { TFunction } from 'i18next';
import {
  BarChart2Icon,
  CheckSquareIcon,
  FileTextIcon,
  LayoutPanelTopIcon,
  MessageCircleIcon,
  PaletteIcon,
  ShapesIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';
import { SkillCategory, type SkillCategorySummary } from '@/types/discover';

export const useSkillCategorySummary = (params: { q?: string } = {}, enabled = true) => {
  const { i18n } = useTranslation('discover');
  const locale = i18n.language || 'zh-CN';
  return useClientDataSWR(
    enabled ? ['discover:skillCategorySummary', locale, params] : null,
    () => lambdaClient.market.skill.getSkillCategorySummary.query({ ...params, locale }),
    { revalidateOnFocus: true },
  );
};

const icons = {
  'data-analytics': BarChart2Icon,
  'pdf-documents': FileTextIcon,
  'productivity-tasks': CheckSquareIcon,
  'communication': MessageCircleIcon,
  'design': PaletteIcon,
};

const fallbackCategories = [
  ...Object.values(SkillCategory).filter((category) => category !== SkillCategory.All),
  'design',
] as const;

const getCategoryIcon = (category: string) => icons[category as keyof typeof icons] || ShapesIcon;

const getFallbackCategory = (
  category: (typeof fallbackCategories)[number] | 'all' | 'uncategorized',
  t: TFunction<'discover'>,
) => ({
  count: undefined,
  icon: getCategoryIcon(category),
  key: category,
  label: t(`skills.categories.${category}.name`),
  title: t(`skills.categories.${category}.description`),
});

const getSummaryCategory = (
  item: SkillCategorySummary['categories'][number],
  t: TFunction<'discover'>,
  locale: string,
) => {
  const hasServerTranslation =
    item.registered &&
    item.locale?.split('-')[0].toLowerCase() === locale.split('-')[0].toLowerCase();
  return {
    count: item.count,
    icon: getCategoryIcon(item.category),
    key: item.category,
    label: hasServerTranslation
      ? item.name
      : t(`skills.categories.${item.category}.name`, { defaultValue: item.name }),
    title: hasServerTranslation
      ? item.description
      : t(`skills.categories.${item.category}.description`, { defaultValue: item.description }),
  };
};

export const useSkillCategory = (params: { q?: string } = {}) => {
  const { t, i18n } = useTranslation('discover');
  const locale = i18n.language || 'zh-CN';
  const result = useSkillCategorySummary(params);
  const categories =
    result.data?.categories.map((item) => getSummaryCategory(item, t, locale)) ??
    fallbackCategories.map((category) => getFallbackCategory(category, t));
  const items = [
    {
      key: 'all',
      label: t('skills.categories.all.name'),
      title: t('skills.categories.all.description'),
      icon: LayoutPanelTopIcon,
      count: result.data?.allCount,
    },
    ...categories,
    {
      key: 'uncategorized',
      label: t('skills.categories.uncategorized.name'),
      title: t('skills.categories.uncategorized.description'),
      icon: ShapesIcon,
      count: result.data?.uncategorizedCount,
    },
  ];
  return { ...result, items };
};

export const useSkillCategoryItem = (key?: string) => {
  const { t, i18n } = useTranslation('discover');
  const { data } = useSkillCategorySummary();
  const category = key || 'uncategorized';
  const summaryCategory = data?.categories.find((item) => item.category === category);
  if (summaryCategory) return getSummaryCategory(summaryCategory, t, i18n.language || 'zh-CN');
  if (category === 'all' || category === 'uncategorized') return getFallbackCategory(category, t);
  const fallback = fallbackCategories.find((item) => item === category);
  if (fallback) return getFallbackCategory(fallback, t);
};
