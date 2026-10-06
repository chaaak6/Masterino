import { setCookie } from '@lobechat/utils';
import { changeLanguage } from 'i18next';

import { LOBE_LOCALE_COOKIE } from '@/const/locale';
import { normalizeLocale } from '@/locales/localeCodes';
import { type LocaleMode } from '@/types/locale';

export const switchLang = (locale: LocaleMode) => {
  const lang = normalizeLocale(locale === 'auto' ? navigator.language : locale);

  // app:// cookies are not a durable preference store. Preserve the mode as
  // well as the resolved language, so 'auto' follows a changed system locale.
  try {
    localStorage.setItem('masterino.localeMode', locale);
  } catch {
    // Storage may be unavailable in a restricted browser.
  }

  changeLanguage(lang);
  document.documentElement.lang = lang;

  setCookie(LOBE_LOCALE_COOKIE, locale === 'auto' ? undefined : locale, 365);
};
