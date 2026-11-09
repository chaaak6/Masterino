import { describe, expect, it } from 'vitest';

import { DesktopOnboardingScreen } from '@/features/DesktopOnboarding/types';

import {
  shouldDeferOnboardingRedirect,
  shouldResumeDesktopRecommendations,
} from './useUserStateRedirect';

describe('shouldResumeDesktopRecommendations', () => {
  it.each([DesktopOnboardingScreen.Login, DesktopOnboardingScreen.Agents])(
    'resumes an authenticated first install saved at %s',
    (screen) => expect(shouldResumeDesktopRecommendations('/', false, screen)).toBe(true),
  );

  it('does not interrupt an existing onboarding page or a returning install', () => {
    expect(
      shouldResumeDesktopRecommendations(
        '/desktop-onboarding',
        false,
        DesktopOnboardingScreen.Login,
      ),
    ).toBe(false);
    expect(shouldResumeDesktopRecommendations('/', true, DesktopOnboardingScreen.Login)).toBe(
      false,
    );
    expect(shouldResumeDesktopRecommendations('/', false, null)).toBe(false);
    expect(shouldResumeDesktopRecommendations('/', false, DesktopOnboardingScreen.Welcome)).toBe(
      false,
    );
  });
});

describe('shouldDeferOnboardingRedirect', () => {
  it('defers on invite routes so invited users can accept before onboarding', () => {
    expect(shouldDeferOnboardingRedirect('/invite/abc')).toBe(true);
    expect(shouldDeferOnboardingRedirect('/invite/abc/')).toBe(true);
  });

  it('defers on possible workspace slug routes', () => {
    expect(shouldDeferOnboardingRedirect('/acme')).toBe(true);
    expect(shouldDeferOnboardingRedirect('/acme/settings/members')).toBe(true);
  });

  it('does not defer on personal app routes', () => {
    expect(shouldDeferOnboardingRedirect('/')).toBe(false);
    expect(shouldDeferOnboardingRedirect('/agent')).toBe(false);
    expect(shouldDeferOnboardingRedirect('/settings/profile')).toBe(false);
  });
});
