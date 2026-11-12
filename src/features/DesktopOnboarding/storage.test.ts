import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearDesktopOnboardingCompleted,
  DESKTOP_ONBOARDING_EVER_COMPLETED_KEY,
  getDesktopOnboardingCompleted,
  getDesktopOnboardingEverCompleted,
  setDesktopOnboardingCompleted,
  setDesktopOnboardingEverCompleted,
} from './storage';

describe('desktop-onboarding storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('clears only this session completion on sign-out, preserving the first-install history', () => {
    setDesktopOnboardingCompleted();
    setDesktopOnboardingEverCompleted();
    expect(clearDesktopOnboardingCompleted()).toBe(true);
    expect(getDesktopOnboardingCompleted()).toBe(false);
    expect(getDesktopOnboardingEverCompleted()).toBe(true);
  });

  describe('ever-completed flag', () => {
    it('returns false by default', () => {
      expect(getDesktopOnboardingEverCompleted()).toBe(false);
    });

    it('persists set-and-read across calls', () => {
      expect(setDesktopOnboardingEverCompleted()).toBe(true);
      expect(getDesktopOnboardingEverCompleted()).toBe(true);
      expect(window.localStorage.getItem(DESKTOP_ONBOARDING_EVER_COMPLETED_KEY)).toBe('1');
    });

    it('returns false when localStorage holds an unrelated value', () => {
      window.localStorage.setItem(DESKTOP_ONBOARDING_EVER_COMPLETED_KEY, '0');
      expect(getDesktopOnboardingEverCompleted()).toBe(false);
    });
  });
});
