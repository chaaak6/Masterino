'use client';

import { memo, type PropsWithChildren, useEffect } from 'react';
import { Outlet } from 'react-router-dom';

import Loading from '@/components/Loading/BrandTextLoading';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const MobileAuthGuard = memo<PropsWithChildren>(({ children }) => {
  const [isLoaded, isLoginWithAuth, openLogin] = useUserStore((s) => [
    authSelectors.isLoaded(s),
    authSelectors.isLoginWithAuth(s),
    s.openLogin,
  ]);

  useEffect(() => {
    if (!isLoaded || isLoginWithAuth) return;

    void openLogin();
  }, [isLoaded, isLoginWithAuth, openLogin]);

  if (!isLoaded || !isLoginWithAuth) return <Loading debugId="MobileAuthGuard" />;

  return <>{children ?? <Outlet />}</>;
});

MobileAuthGuard.displayName = 'MobileAuthGuard';

export default MobileAuthGuard;
