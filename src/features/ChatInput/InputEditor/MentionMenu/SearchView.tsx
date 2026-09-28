import type { ISlashMenuOption } from '@lobehub/editor';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import MenuItem from './MenuItem';
import { styles } from './style';

interface SearchViewProps {
  activeKey: string | null;
  onSelectItem: (item: ISlashMenuOption) => void;
  options: ISlashMenuOption[];
}

const getSearchResultCategoryLabel = (
  item: ISlashMenuOption,
  labels: Record<string, string>,
): string | undefined => {
  const metadata = item.metadata as Record<string, unknown> | undefined;
  const type = metadata?.type;

  if (type === 'localFile') {
    if (typeof metadata?.relativePath === 'string') return metadata.relativePath;
    if (typeof metadata?.path === 'string') return metadata.path;
  }

  return typeof type === 'string' ? labels[type] : undefined;
};

const SearchView = memo<SearchViewProps>(({ options, activeKey, onSelectItem }) => {
  const { t } = useTranslation('components');
  if (options.length === 0) {
    return <div className={styles.empty}>{t('mention.noResults')}</div>;
  }

  return (
    <div className={styles.scrollArea}>
      {options.map((item) => {
        const categoryLabel = getSearchResultCategoryLabel(item, {
          agent: t('mention.agent'),
          localFile: t('mention.localFile'),
          member: t('mention.member'),
          skill: t('mention.skill'),
          tool: t('mention.tool'),
          topic: t('mention.topic'),
        });
        const isLocalFile = item.metadata?.type === 'localFile';

        return (
          <MenuItem
            active={String(item.key) === activeKey}
            item={item}
            key={item.key}
            extra={
              categoryLabel && !isLocalFile ? (
                <span className={styles.categoryExtra}>{categoryLabel}</span>
              ) : undefined
            }
            onClick={onSelectItem}
          />
        );
      })}
    </div>
  );
});

SearchView.displayName = 'SearchView';

export default SearchView;
