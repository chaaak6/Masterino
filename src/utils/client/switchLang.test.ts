import { setCookie } from '@lobechat/utils';
import { changeLanguage } from 'i18next';
import { describe, expect, it, vi } from 'vitest';

import { LOBE_LOCALE_COOKIE } from '@/const/locale';
import { type LocaleMode } from '@/types/locale';

import { switchLang } from './switchLang';

vi.mock('i18next', () => ({
  changeLanguage: vi.fn(),
}));

vi.mock('@lobechat/utils', () => ({
  setCookie: vi.fn(),
}));

describe('switchLang', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('should change language to the specified locale', () => {
    const locale: LocaleMode = 'en-US';
    switchLang(locale);

    expect(localStorage.getItem('masterino.localeMode')).toBe(locale);
    expect(changeLanguage).toHaveBeenCalledWith(locale);
    expect(document.documentElement.lang).toBe(locale);
    expect(setCookie).toHaveBeenCalledWith(LOBE_LOCALE_COOKIE, locale, 365);
  });

  it('should change language based on navigator.language when locale is "auto"', () => {
    const navigatorLanguage = 'fr';
    vi.spyOn(navigator, 'language', 'get').mockReturnValue(navigatorLanguage);

    switchLang('auto');

    expect(localStorage.getItem('masterino.localeMode')).toBe('auto');
    expect(changeLanguage).toHaveBeenCalledWith('fr-FR');
    expect(document.documentElement.lang).toBe('fr-FR');
    expect(setCookie).toHaveBeenCalledWith(LOBE_LOCALE_COOKIE, undefined, 365);
  });
});
