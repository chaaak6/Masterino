import { trpc } from '@admin/lib/trpc';
import { Button, Flexbox } from '@lobehub/ui';
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
  const options: Array<{ value: string; label: string; disabled?: boolean }> = (
    (categories.data?.items ?? []) as CategoryDefinition[]
  )
    .filter((item) => item.resource_type === 'skill')
    .map((item) => ({
      value: item.slug,
      label:
        item.localizations?.['zh-CN']?.name || item.localizations?.['en-US']?.name || item.slug,
    }));
  const validValue = options.some((item) => item.value === value);
  if (value && !validValue)
    options.push({
      value,
      label: `${value}（${categories.isLoading ? '分类加载中' : categories.error ? '分类未加载' : '未注册，请重新选择'}）`,
      disabled: true,
    });
  return (
    <Flexbox gap={8}>
      <Select
        disabled={categories.isLoading}
        options={options}
        style={{ minWidth: 170 }}
        value={value}
        placeholder={
          categories.error
            ? '分类加载失败，请刷新重试'
            : categories.isLoading
              ? '正在加载分类…'
              : options.length
                ? '选择技能分类'
                : '暂无技能分类，请先在分类与角色中添加'
        }
        onChange={(next) => {
          if (typeof next === 'string') onChange?.(next);
        }}
      />
      {categories.error && (
        <Button size={'small'} onClick={() => void categories.refetch()}>
          分类加载失败，重试
        </Button>
      )}
    </Flexbox>
  );
}
