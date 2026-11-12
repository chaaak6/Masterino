'use client';

import { APP_WINDOW_MIN_SIZE } from '@lobechat/desktop-bridge';
import { Flexbox, Skeleton } from '@lobehub/ui';
import { memo, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import Loading from '@/components/Loading/BrandTextLoading';
import AgentPickerStep from '@/routes/onboarding/features/AgentPickerStep';
import { electronSystemService } from '@/services/electron/system';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import OnboardingContainer from './_layout';
import DataModeStep from './features/DataModeStep';
import LoginStep from './features/LoginStep';
import PermissionsStep from './features/PermissionsStep';
import WelcomeStep from './features/WelcomeStep';
import { resolveInitialScreen } from './resolveInitialScreen';
import {
  clearDesktopOnboardingScreen,
  getDesktopOnboardingEverCompleted,
  getDesktopOnboardingScreen,
  setDesktopOnboardingCompleted,
  setDesktopOnboardingEverCompleted,
  setDesktopOnboardingScreen,
} from './storage';
import { DesktopOnboardingScreen, isDesktopOnboardingScreen } from './types';

const DesktopOnboardingPage = memo(() => {
  const [searchParams, setSearchParams] = useSearchParams();
  const isLogin = useUserStore(authSelectors.isLogin);
  const [isMac, setIsMac] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  const flow = useMemo(
    () =>
      isMac
        ? [
            DesktopOnboardingScreen.Welcome,
            DesktopOnboardingScreen.Permissions,
            DesktopOnboardingScreen.DataMode,
            DesktopOnboardingScreen.Login,
            DesktopOnboardingScreen.Agents,
          ]
        : [
            DesktopOnboardingScreen.Welcome,
            DesktopOnboardingScreen.DataMode,
            DesktopOnboardingScreen.Login,
            DesktopOnboardingScreen.Agents,
          ],
    [isMac],
  );

  const resolveScreenForPlatform = useCallback(
    (screen: DesktopOnboardingScreen) =>
      resolveInitialScreen({
        everCompleted: false,
        isMac,
        requested: screen,
        saved: null,
      }),
    [isMac],
  );

  const getRequestedScreenFromUrl = useCallback((): DesktopOnboardingScreen | null => {
    const screenParam = searchParams.get('screen');
    if (isDesktopOnboardingScreen(screenParam)) return screenParam;

    return null;
  }, [searchParams]);

  const [currentScreen, setCurrentScreen] = useState<DesktopOnboardingScreen>(
    DesktopOnboardingScreen.Welcome,
  );

  useEffect(() => {
    if (isLoading) return;

    const initial = resolveInitialScreen({
      everCompleted: getDesktopOnboardingEverCompleted(),
      isMac,
      requested: getRequestedScreenFromUrl(),
      saved: getDesktopOnboardingScreen(),
    });

    setCurrentScreen(initial);

    // Canonicalize URL to `?screen=...`
    const currentUrlScreen = searchParams.get('screen');
    if (currentUrlScreen !== initial) {
      setSearchParams({ screen: initial });
    }
  }, [getRequestedScreenFromUrl, isLoading, isMac, searchParams, setSearchParams]);

  // Persist current screen to localStorage.
  useEffect(() => {
    if (isLoading) return;
    setDesktopOnboardingScreen(currentScreen);
  }, [currentScreen, isLoading]);

  // Set window size and resizability
  useEffect(() => {
    const minimumSize = { height: 900, width: 1200 };

    const applyWindowSettings = async () => {
      try {
        await electronSystemService.setWindowMinimumSize(minimumSize);
      } catch (error) {
        console.error('[DesktopOnboarding] Failed to apply window settings:', error);
      }
    };

    applyWindowSettings();

    return () => {
      // Restore to app-level default minimum size preset
      electronSystemService.setWindowMinimumSize(APP_WINDOW_MIN_SIZE).catch((error) => {
        console.error('[DesktopOnboarding] Failed to restore window settings:', error);
      });
    };
  }, []);

  // Detect platform: skip permissions page on non-macOS
  useEffect(() => {
    let mounted = true;
    const detectPlatform = async () => {
      try {
        const state = await electronSystemService.getAppState();
        if (!mounted) return;
        setIsMac(state.platform === 'darwin');
      } catch {
        // Fallback: keep default (true)
      } finally {
        setIsLoading(false);
      }
    };
    void detectPlatform();
    return () => {
      mounted = false;
    };
  }, []);

  // Listen URL changes: allow deep-linking between screens.
  useEffect(() => {
    if (isLoading) return;
    const requested = getRequestedScreenFromUrl();
    if (!requested) return;
    const resolved = resolveScreenForPlatform(requested);
    if (resolved !== currentScreen) setCurrentScreen(resolved);
  }, [currentScreen, getRequestedScreenFromUrl, isLoading, resolveScreenForPlatform]);

  const finishDesktopOnboarding = useCallback(async () => {
    setDesktopOnboardingCompleted();
    setDesktopOnboardingEverCompleted();
    clearDesktopOnboardingScreen();
    await electronSystemService.setWindowMinimumSize(APP_WINDOW_MIN_SIZE).catch(console.error);
    window.location.replace('/');
  }, []);

  useEffect(() => {
    if (currentScreen === DesktopOnboardingScreen.Agents && isLogin === false) {
      setSearchParams({ screen: DesktopOnboardingScreen.Login });
    }
  }, [currentScreen, isLogin, setSearchParams]);

  const goToNextStep = useCallback(() => {
    setCurrentScreen((prev) => {
      const idx = flow.indexOf(prev);
      const next =
        prev === DesktopOnboardingScreen.Login && getDesktopOnboardingEverCompleted()
          ? undefined
          : flow[idx + 1];

      if (!next) {
        void finishDesktopOnboarding();

        return prev;
      }

      setSearchParams({ screen: next });
      return next;
    });
  }, [finishDesktopOnboarding, flow, setSearchParams]);

  const goToPreviousStep = useCallback(() => {
    setCurrentScreen((prev) => {
      const idx = flow.indexOf(prev);
      const prevScreen = flow[Math.max(0, idx - 1)] ?? DesktopOnboardingScreen.Welcome;
      setSearchParams({ screen: prevScreen });
      return prevScreen;
    });
  }, [flow, setSearchParams]);

  if (isLoading) {
    return <Loading debugId="DesktopOnboarding" />;
  }

  const renderStep = () => {
    switch (currentScreen) {
      case DesktopOnboardingScreen.Welcome: {
        return <WelcomeStep onNext={goToNextStep} />;
      }
      case DesktopOnboardingScreen.Permissions: {
        // macOS-only screen; fallback to DataMode if platform doesn't support.
        if (!isMac) {
          setCurrentScreen(DesktopOnboardingScreen.DataMode);
          return null;
        }
        return <PermissionsStep onBack={goToPreviousStep} onNext={goToNextStep} />;
      }
      case DesktopOnboardingScreen.DataMode: {
        return <DataModeStep onBack={goToPreviousStep} onNext={goToNextStep} />;
      }
      case DesktopOnboardingScreen.Agents: {
        if (!isLogin) return <Loading debugId="DesktopOnboarding/agents" />;
        return <AgentPickerStep onBack={goToPreviousStep} onFinish={finishDesktopOnboarding} />;
      }
      case DesktopOnboardingScreen.Login: {
        return <LoginStep onBack={goToPreviousStep} onNext={goToNextStep} />;
      }
      default: {
        return null;
      }
    }
  };

  return (
    <OnboardingContainer>
      <Flexbox
        gap={24}
        style={{
          maxWidth: currentScreen === DesktopOnboardingScreen.Agents ? 780 : 560,
          minHeight: '100%',
          width: '100%',
        }}
      >
        <Suspense
          fallback={
            <Flexbox gap={8}>
              <Skeleton.Avatar size={48} />
              <Skeleton
                paragraph={{
                  rows: 8,
                }}
                title={{
                  fontSize: 24,
                }}
              />
            </Flexbox>
          }
        >
          {renderStep()}
        </Suspense>
      </Flexbox>
    </OnboardingContainer>
  );
});

DesktopOnboardingPage.displayName = 'DesktopOnboardingPage';

export default DesktopOnboardingPage;
