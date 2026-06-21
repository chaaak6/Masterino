'use client';

import { type SidebarAgentItem, type SidebarGroup } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import MobileAgentListItem from './MobileAgentListItem';
import MobileInboxItem from './MobileInboxItem';

interface SectionProps {
  items: SidebarAgentItem[];
  title?: string;
}

const Section = memo<SectionProps>(({ title, items }) => {
  if (items.length === 0) return null;

  return (
    <Flexbox gap={2}>
      {title && (
        <Text fontSize={12} style={{ paddingInline: 12 }} type={'secondary'} weight={500}>
          {title}
        </Text>
      )}
      {items.map((item) => (
        <MobileAgentListItem item={item} key={`${item.type}-${item.id}`} />
      ))}
    </Flexbox>
  );
});

Section.displayName = 'MobileAgentListSection';

const MobileAgentList = memo(() => {
  const { t } = useTranslation(['chat', 'common']);
  useFetchAgentList();

  const isInit = useHomeStore(homeAgentListSelectors.isAgentListInit);
  const agentPageSize = useGlobalStore(systemStatusSelectors.agentPageSize);
  const pinnedAgents = useHomeStore(homeAgentListSelectors.pinnedAgents, isEqual);
  const agentGroups = useHomeStore(homeAgentListSelectors.agentGroups, isEqual);
  const defaultAgents = useHomeStore(
    homeAgentListSelectors.ungroupedAgentsLimited(agentPageSize),
    isEqual,
  );

  return (
    <Flexbox data-testid="mobile-agent-list" gap={12} paddingBlock={8} paddingInline={0}>
      <Flexbox gap={2}>
        <MobileInboxItem />
      </Flexbox>
      {!isInit && <SkeletonList rows={6} />}
      {isInit && (
        <>
          <Section items={pinnedAgents} title={t('pin', { ns: 'chat' })} />
          {agentGroups.map((group: SidebarGroup) => (
            <Section items={group.items} key={group.id} title={group.name} />
          ))}
          <Section items={defaultAgents} title={t('defaultList', { ns: 'chat' })} />
        </>
      )}
    </Flexbox>
  );
});

MobileAgentList.displayName = 'MobileAgentList';

export default MobileAgentList;
