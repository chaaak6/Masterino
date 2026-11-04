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

export const useSkillCategory = (params: { q?: string } = {}) => {
  const { t, i18n } = useTranslation('discover');
  const locale = i18n.language || 'zh-CN';
  const result = useSkillCategorySummary(params);
  const items = [
    {
      key: 'all',
      label: t('skills.categories.all.name'),
      title: t('skills.categories.all.description'),
      icon: LayoutPanelTopIcon,
      count: result.data?.allCount,
    },
    ...(result.data?.categories ?? []).map((item) => {
      const useDictionary =
        item.registered && (item.locale === locale || /^(?:en|zh)(?:-|$)/i.test(locale));
      return {
        key: item.category,
        label: useDictionary
          ? item.name
          : t(`skills.categories.${item.category}.name`, { defaultValue: item.name }),
        title: useDictionary
          ? item.description
          : t(`skills.categories.${item.category}.description`, { defaultValue: item.description }),
        icon: icons[item.category as keyof typeof icons] || ShapesIcon,
        count: item.count,
      };
    }),
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
  const { items } = useSkillCategory();
  return items.find((item) => item.key === (key || 'uncategorized'));
};
