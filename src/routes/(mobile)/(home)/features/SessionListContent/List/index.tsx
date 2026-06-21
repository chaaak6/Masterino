import { useAnalytics } from '@lobehub/analytics/react';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import LazyLoad from 'react-lazy-load';
import { Link } from 'react-router-dom';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useNavigateToAgent } from '@/hooks/useNavigateToAgent';
import { getSessionStoreState, useSessionStore } from '@/store/session';
import { sessionGroupSelectors, sessionSelectors } from '@/store/session/selectors';
import { getUserStoreState } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { type LobeSessions } from '@/types/session';

import SkeletonList from '../../SkeletonList';
import AddButton from './AddButton';
import SessionItem from './Item';
import { getSessionNavigationTarget } from './navigation';

const styles = createStaticStyles(
  ({ css }) => css`
    min-height: 70px;
  `,
);
interface SessionListProps {
  dataSource?: LobeSessions;
  groupId?: string;
  showAddButton?: boolean;
}
const SessionList = memo<SessionListProps>(({ dataSource, groupId, showAddButton = true }) => {
  const { analytics } = useAnalytics();

  const isInit = useSessionStore(sessionSelectors.isSessionListInit);

  const navigateToAgent = useNavigateToAgent();
  const navigate = useWorkspaceAwareNavigate();

  const isEmpty = !dataSource || dataSource.length === 0;
  return !isInit ? (
    <SkeletonList />
  ) : !isEmpty ? (
    dataSource.map((session) => {
      const { id } = session;
      const navigationTarget = getSessionNavigationTarget(session);

      return (
        <LazyLoad className={styles} key={id}>
          <Link
            aria-label={id}
            to={navigationTarget.href}
            onClick={(e) => {
              e.preventDefault();
              if (navigationTarget.type === 'group') {
                navigate(navigationTarget.href);
              } else {
                navigateToAgent(navigationTarget.targetId);
              }

              // Enhanced analytics tracking
              if (analytics) {
                const userStore = getUserStoreState();
                const sessionStore = getSessionStoreState();

                const userId = userProfileSelectors.userId(userStore);
                const session = sessionSelectors.getSessionById(id)(sessionStore);

                if (session) {
                  const sessionGroupId = session.group || 'default';
                  const group = sessionGroupSelectors.getGroupById(sessionGroupId)(sessionStore);
                  const groupName =
                    group?.name || (sessionGroupId === 'default' ? 'Default' : 'Unknown');

                  analytics?.track({
                    name: 'switch_session',
                    properties: {
                      assistant_name: session.meta?.title || 'Untitled Agent',
                      assistant_tags: session.meta?.tags || [],
                      group_id: sessionGroupId,
                      group_name: groupName,
                      session_id: id,
                      spm: 'homepage.chat.session_list_item.click',
                      user_id: userId || 'anonymous',
                    },
                  });
                }
              }
            }}
          >
            <SessionItem id={id} />
          </Link>
        </LazyLoad>
      );
    })
  ) : (
    showAddButton && <AddButton groupId={groupId} />
  );
});

export default SessionList;
