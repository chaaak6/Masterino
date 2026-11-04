import { trpc } from '@admin/lib/trpc';
import { Select } from '@lobehub/ui/base-ui';

interface CategoryDefinition {
  localizations?: Record<string, { name?: string }>;
  resource_type: string;
  slug: string;
}

export default function SkillCategorySelect({
  value,
  onChange,
}: {
  value?: string;
  onChange?: (value: string) => void;
}) {
  const categories = trpc.admin.listMarketCategories.useQuery();
  return (
    <Select
      disabled={categories.isLoading}
      placeholder={categories.error ? '分类加载失败，请刷新重试' : '选择技能分类'}
      style={{ minWidth: 170 }}
      value={value}
      options={((categories.data?.items ?? []) as CategoryDefinition[])
        .filter((item) => item.resource_type === 'skill')
        .map((item) => ({
          value: item.slug,
          label: item.localizations?.['zh-CN']?.name || item.slug,
        }))}
      onChange={(next) => {
        if (typeof next === 'string') onChange?.(next);
      }}
    />
  );
}
