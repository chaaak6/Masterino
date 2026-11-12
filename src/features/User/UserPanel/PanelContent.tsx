import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { useNavigate } from 'react-router-dom';

import BusinessPanelContent from '@/business/client/features/User/BusinessPanelContent';
import UserPanelWorkspaceSection from '@/business/client/features/User/UserPanelWorkspaceSection';
import Menu from '@/components/Menu';
import { isDesktop } from '@/const/version';
import { getDesktopOnboardingPath } from '@/features/DesktopOnboarding/navigation';
import { clearDesktopOnboardingCompleted } from '@/features/DesktopOnboarding/storage';
import { DesktopOnboardingScreen } from '@/features/DesktopOnboarding/types';
import UserInfo from '@/features/User/UserInfo';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { setDesktopAutoOidcFirstOpenHandled } from '@/utils/electron/autoOidc';

import DataStatistics from '../DataStatistics';
import NewApiBalance from '../NewApiBalance';
import UserLoginOrSignup from '../UserLoginOrSignup';
import LangButton from './LangButton';
import { useMenu } from './useMenu';

const PanelContent: FC<{ closePopover: () => void }> = ({ closePopover }) => {
  const navigate = useNavigate();
  const isLoginWithAuth = useUserStore(authSelectors.isLoginWithAuth);
  const [openSignIn, signOut] = useUserStore((s) => [s.openLogin, s.logout]);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const { mainItems, logoutItems } = useMenu();

  const handleSignIn = () => {
    openSignIn();
    closePopover();
  };

  const handleSignOut = async () => {
    if (isDesktop) {
      closePopover();
      // Explicit sign-out must never trigger the first-open authorization again.
      setDesktopAutoOidcFirstOpenHandled();
      clearDesktopOnboardingCompleted();
      const loginPath = getDesktopOnboardingPath(DesktopOnboardingScreen.Login);
      // Unmount main-route listeners and editor beforeunload guards before changing auth.
      navigate(loginPath, { flushSync: true, replace: true });

      try {
        // Keep the authenticated transport alive until server sessions have been cleared.
        await signOut({ redirect: false });
      } catch (error) {
        console.error(error);
      }
      try {
        const { remoteServerService } = await import('@/services/electron/remoteServer');
        await remoteServerService.cancelAuthorization();
        await remoteServerService.clearRemoteServerConfig();
      } catch (error) {
        console.error(error);
      } finally {
        window.location.replace(loginPath);
      }
      return;
    }

    signOut();
    closePopover();
  };

  return (
    <Flexbox gap={2} style={{ minWidth: 300 }}>
      {isDesktop || isLoginWithAuth ? (
        <>
          <UserInfo avatarProps={{ clickable: false }} />
          <WorkspaceLink style={{ color: 'inherit' }} to={'/settings/stats'}>
            <DataStatistics />
          </WorkspaceLink>
          <NewApiBalance onNavigate={closePopover} />
          {enableBusinessFeatures && <BusinessPanelContent />}
          <UserPanelWorkspaceSection onSwitch={closePopover} />
        </>
      ) : (
        <UserLoginOrSignup onClick={handleSignIn} />
      )}

      <Menu items={mainItems} onClick={closePopover} />
      <LangButton placement={'right' as any} />
      <Menu items={logoutItems} onClick={handleSignOut} />
    </Flexbox>
  );
};

export default PanelContent;
