'use client';

import { isDesktop } from '@lobechat/const';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import EmptyNavItem from '@/features/NavPanel/components/EmptyNavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useDeviceTopics } from '@/hooks/useDeviceTopics';
import { useFetchChatTopics } from '@/hooks/useFetchChatTopics';
import { usePermission } from '@/hooks/usePermission';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useElectronStore } from '@/store/electron';

import AllTopicsDrawer from '../AllTopicsDrawer';
import { useAgentTopicGroupMode } from '../hooks/useAgentTopicGroupMode';
import ByProjectMode from '../TopicListContent/ByProjectMode';
import ByTimeMode from '../TopicListContent/ByTimeMode';
import FlatMode from '../TopicListContent/FlatMode';

const TopicList = memo(() => {
  const { t } = useTranslation('topic');
  const router = useQueryRoute();
  const { allowed: canCreateTopic } = usePermission('create_content');
  const topicLength = useDeviceTopics((s) => topicSelectors.currentTopicLength(s));
  const deviceReady = useElectronStore((s) => !isDesktop || !!s.gatewayDeviceInfo?.deviceId);
  const isUndefinedTopics = useChatStore((s) => topicSelectors.isUndefinedTopics(s));

  const [agentId, allTopicsDrawerOpen, closeAllTopicsDrawer] = useChatStore((s) => [
    s.activeAgentId,
    s.allTopicsDrawerOpen,
    s.closeAllTopicsDrawer,
  ]);

  const { topicGroupMode } = useAgentTopicGroupMode();

  useFetchChatTopics();

  // Device identity must be ready before an empty filtered list means no topics.
  if (!deviceReady || isUndefinedTopics) return <SkeletonList />;

  return (
    <>
      {topicLength === 0 && (
        <EmptyNavItem
          disabled={!canCreateTopic}
          title={t('actions.addNewTopic')}
          onClick={() => {
            if (!canCreateTopic) return;
            router.push(urlJoin('/agent', agentId));
          }}
        />
      )}
      {isDesktop ? (
        <ByProjectMode />
      ) : topicGroupMode === 'flat' ? (
        <FlatMode />
      ) : topicGroupMode === 'byProject' ? (
        <ByProjectMode />
      ) : (
        <ByTimeMode />
      )}
      <AllTopicsDrawer open={allTopicsDrawerOpen} onClose={closeAllTopicsDrawer} />
    </>
  );
});

export default TopicList;
