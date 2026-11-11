'use client';

import { Button, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import qs from 'query-string';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { withSuspense } from '@/components/withSuspense';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useQuery } from '@/hooks/useQuery';
import { useSkillCategory } from '@/hooks/useSkillCategory';
import { SCROLL_PARENT_ID } from '@/routes/(main)/community/features/const';
import { SkillCategory, SkillSorts } from '@/types/discover';

import CategoryMenu from '../../../../components/CategoryMenu';

const Category = memo(() => {
  const { t } = useTranslation('discover');
  const { category = SkillCategory.All, q } = useQuery() as {
    category?: SkillCategory;
    q?: string;
  };
  const navigate = useWorkspaceAwareNavigate();
  const { items: cates, data, error, mutate } = useSkillCategory({ q });

  const genUrl = (key: string) =>
    qs.stringifyUrl(
      {
        query: {
          category: key === SkillCategory.All ? null : key,
          q,
          sort: key === SkillCategory.All ? SkillSorts.InstallCount : null,
        },
        url: '/community/skill',
      },
      { skipNull: true },
    );

  const handleClick = (key: string) => {
    navigate(genUrl(key));
    const scrollableElement = document?.querySelector(`#${SCROLL_PARENT_ID}`);
    if (!scrollableElement) return;
    scrollableElement.scrollTo({ behavior: 'smooth', top: 0 });
  };

  return (
    <Flexbox gap={8}>
      {error && (
        <Flexbox gap={4}>
          <Text type={'danger'}>{t('skills.categories.loadError')}</Text>
          <Button onClick={() => void mutate()}>{t('retry', { ns: 'common' })}</Button>
        </Flexbox>
      )}
      <CategoryMenu
        mode={'inline'}
        selectedKeys={[category]}
        items={cates
          .filter(
            (item) => !data || item.key === 'all' || (item.count || 0) > 0 || item.key === category,
          )
          .map((item) => ({
            extra: item.count !== undefined && <Tag size={'small'}>{item.count}</Tag>,
            ...item,
            icon: <Icon icon={item.icon} size={18} />,
            label: <WorkspaceLink to={genUrl(item.key)}>{item.label}</WorkspaceLink>,
          }))}
        onClick={(v) => handleClick(v.key)}
      />
    </Flexbox>
  );
});

export default withSuspense(Category);
