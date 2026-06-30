'use client';

import type { PropsWithChildren } from 'react';
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';

import { BrandTextLoading as Loading } from '@/components/Loading';
import { cacheHydration, isCacheHydrationBlocked } from '@/libs/swr/cacheHydration';
import { useCacheScope } from '@/libs/swr/useCacheScope';
import { useAiInfraStore } from '@/store/aiInfra';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const HYDRATION_TIMEOUT = 1500;

const CacheHydrationGate = ({ children }: PropsWithChildren) => {
  const scope = useCacheScope();

  return (
    <CacheHydrationGateInner key={scope} scope={scope}>
      {children}
    </CacheHydrationGateInner>
  );
};

interface CacheHydrationGateInnerProps extends PropsWithChildren {
  scope: string;
}

const CacheHydrationGateInner = ({ children, scope }: CacheHydrationGateInnerProps) => {
  const isAuthLoaded = Boolean(useUserStore(authSelectors.isLoaded));
  const isSignedIn = Boolean(useUserStore(authSelectors.isLogin));
  const isUserStateInit = useUserStore((s) => s.isUserStateInit);
  const isInitAiProviderRuntimeState = useAiInfraStore((s) => s.isInitAiProviderRuntimeState);

  const ready = useSyncExternalStore(
    cacheHydration.subscribe,
    () => cacheHydration.isReady(scope),
    () => true,
  );

  const [released, setReleased] = useState(false);
  const [timedOutScope, setTimedOutScope] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOutScope(scope), HYDRATION_TIMEOUT);
    return () => clearTimeout(timer);
  }, [scope]);

  useEffect(() => {
    if (!isAuthLoaded) return;
    if (!cacheHydration.isReady(scope) && timedOutScope !== scope) return;

    setReleased(true);
  }, [isAuthLoaded, ready, scope, timedOutScope]);

  const booting = isCacheHydrationBlocked({
    isAuthLoaded,
    ready,
    released,
    scope,
    timedOutScope,
  });

  // 已登录用户必须等 aihub 运行时态就绪后再进入功能页，否则会话因
  // agentMap 未水合而报错（getAgentConfigById 返回 undefined → 解构抛错）。
  // 1500ms 超时仅作用于缓存水合，不短路 aihub 就绪。
  const aihubReady = !isSignedIn || (isUserStateInit && isInitAiProviderRuntimeState);

  useLayoutEffect(() => {
    if (booting || !aihubReady) return;

    document.getElementById('loading-screen')?.remove();
  }, [booting, aihubReady]);

  if (booting) return null;

  if (!aihubReady) return <Loading debugId="CacheHydrationGate/aihubReady" />;

  return <>{children}</>;
};

export default CacheHydrationGate;
