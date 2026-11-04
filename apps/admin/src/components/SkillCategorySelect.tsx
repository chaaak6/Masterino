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
  const options = ((categories.data?.items ?? []) as CategoryDefinition[])
    .filter((item) => item.resource_type === 'skill')
    .map((item) => ({
      value: item.slug,
      label:
        item.localizations?.['zh-CN']?.name || item.localizations?.['en-US']?.name || item.slug,
    }));
  const validValue = options.some((item) => item.value === value);
  return (
    <Select
      disabled={categories.isLoading}
      options={options}
      style={{ minWidth: 170 }}
      value={validValue ? value : undefined}
      placeholder={
        categories.error
          ? '分类加载失败，请刷新重试'
          : value && !validValue
            ? '原分类未注册，请选择'
            : '选择技能分类'
      }
      onChange={(next) => {
        if (typeof next === 'string') onChange?.(next);
      }}
    />
  );
}
